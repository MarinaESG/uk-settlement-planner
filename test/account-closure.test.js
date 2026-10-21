import test from "node:test";
import assert from "node:assert/strict";
import { reviewAccountClosure } from "../src/account-closure.js";

// All provider calls are fixtures. No live accounts, credentials or network.
const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const email = "owner@example.com";
const project = "aaaaaaaaaaaaaaaaaaaa";
const config = {
  PRIVATE_PREVIEW_ENABLED: "true", COMMERCE_ENABLED: "false", STRIPE_SANDBOX_CHECKOUT: "false",
  SUPABASE_URL: `https://${project}.supabase.co`, SUPABASE_SECRET_KEY: "sb_secret_fictional",
  PREVIEW_CLOSED_EMAILS: email,
};
const options = { userId: id, email, expectedProject: project };
const apply = { ...options, apply: true, confirmId: id, accessBlockVerified: true };
function fixture({ cascade = true, present = true, failure = null } = {}) {
  let identityPresent = present;
  const rows = { workspaces: new Set(present ? [id, other] : [other]), customers: new Set(present ? [id, other] : [other]) };
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url, method: init.method });
    const u = new URL(url);
    assert.equal(u.origin, config.SUPABASE_URL);
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.apikey, config.SUPABASE_SECRET_KEY);
    assert.equal(init.headers.Authorization, undefined);
    assert.ok(init.signal instanceof AbortSignal);
    if (init.method === "DELETE") {
      assert.equal(u.pathname, `/auth/v1/admin/users/${id}`);
      assert.deepEqual(JSON.parse(init.body), { should_soft_delete: false });
      if (failure === "network") throw Error("Sensitive provider error sb_secret_fictional");
      if (failure === "http") return Response.json({ secret: "sb_secret_fictional" }, { status: 500 });
      identityPresent = false;
      if (cascade) for (const set of Object.values(rows)) set.delete(id);
      return Response.json({ id });
    }
    assert.equal(init.method, "GET");
    if (u.pathname === `/auth/v1/admin/users/${id}`)
      return identityPresent ? Response.json({ id, email, metadata: { secret: "not-output" } }) : Response.json({}, { status: 404 });
    const table = u.pathname.split("/").at(-1);
    assert.ok(Object.hasOwn(rows, table));
    assert.equal(u.searchParams.get("user_id"), `eq.${id}`);
    assert.equal(u.searchParams.get("select"), "user_id");
    return Response.json(rows[table].has(id) ? [{ user_id: id }] : []);
  };
  return { request, calls, rows };
}
test("account review defaults to read-only, scoped IDs and content-free output", async () => {
  const f = fixture();
  const result = await reviewAccountClosure(options, config, f.request);
  assert.equal(result.changed, false);
  assert.equal(result.status, "review_only");
  assert.deepEqual(result.before, { authAccount: true, workspaces: 1, customers: 1 });
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every((c) => c.method === "GET"));
  for (const text of [email, config.SUPABASE_SECRET_KEY, "not-output"])
    assert.equal(JSON.stringify(result).includes(text), false);
  assert.equal(f.rows.workspaces.size, 2);
});
test("invalid destination, identity or safeguards stop before transmitting credentials", async () => {
  let calls = 0;
  const request = async () => { calls++; throw Error("Must not call"); };
  for (const change of [
    { SUPABASE_URL: "https://different.example.test" },
    { SUPABASE_URL: `${config.SUPABASE_URL}/unexpected` },
    { SUPABASE_URL: `${config.SUPABASE_URL}?next=elsewhere` },
    { SUPABASE_URL: "http://" + project + ".supabase.co" },
    { SUPABASE_SECRET_KEY: "" }, { PRIVATE_PREVIEW_ENABLED: "false" },
    { COMMERCE_ENABLED: "true" }, { STRIPE_SANDBOX_CHECKOUT: "true" },
    { PREVIEW_CLOSED_EMAILS: "not-an-email" },
  ]) await assert.rejects(reviewAccountClosure(options, { ...config, ...change }, request));
  for (const change of [
    { userId: "invalid" }, { email: "invalid" }, { expectedProject: "different" },
    { apply: true }, { ...apply, confirmId: other }, { ...apply, accessBlockVerified: false },
  ]) await assert.rejects(reviewAccountClosure({ ...options, ...change }, config, request));
  await assert.rejects(reviewAccountClosure(apply, { ...config, PREVIEW_CLOSED_EMAILS: "" }, request));
  assert.equal(calls, 0);
});
test("a mismatched account identity cannot be deleted", async () => {
  const calls = [];
  await assert.rejects(reviewAccountClosure(apply, config, async (url, init) => {
    calls.push(init.method);
    return Response.json({ id, email: "someone-else@example.com" });
  }), /do not match/);
  assert.deepEqual(calls, ["GET"]);
});
test("confirmed closure removes only the fixture account and verifies all active records", async () => {
  const f = fixture();
  const result = await reviewAccountClosure(apply, config, f.request);
  assert.equal(result.status, "active_account_records_absent");
  assert.equal(result.changed, true);
  assert.deepEqual(result.after, { authAccount: false, workspaces: 0, customers: 0 });
  assert.ok(result.outstanding.includes("device and exported backup guidance"));
  assert.equal(f.calls.filter((c) => c.method === "DELETE").length, 1);
  for (const rows of Object.values(f.rows)) assert.deepEqual([...rows], [other]);
  const retry = await reviewAccountClosure(apply, config, f.request);
  assert.equal(retry.changed, false);
  assert.equal(f.calls.filter((c) => c.method === "DELETE").length, 1);
});
test("missing cascades are reported incomplete and a retry does not issue broad deletion", async () => {
  const f = fixture({ cascade: false });
  await assert.rejects(reviewAccountClosure(apply, config, f.request), /Closure is incomplete/);
  await assert.rejects(reviewAccountClosure(apply, config, f.request), /identity is absent but linked records remain/);
  assert.equal(f.calls.filter((c) => c.method === "DELETE").length, 1);
  assert.equal(f.rows.workspaces.size, 2);
});
test("provider failures neither leak errors nor claim completion or retry automatically", async () => {
  for (const failure of ["network", "http"]) {
    const f = fixture({ failure });
    await assert.rejects(reviewAccountClosure(apply, config, f.request), (error) => {
      assert.match(error.message, /Provider request failed/);
      assert.equal(error.message.includes("sb_secret_fictional"), false);
      return true;
    });
    assert.equal(f.calls.filter((c) => c.method === "DELETE").length, 1);
    assert.equal(f.rows.workspaces.size, 2);
  }
});
test("unexpected row scope aborts before deletion", async () => {
  const calls = [];
  await assert.rejects(reviewAccountClosure(apply, config, async (url, init) => {
    calls.push(init.method);
    return url.includes("/admin/users/") ? Response.json({ id, email }) : Response.json([{ user_id: other }]);
  }), /Unexpected linked-record/);
  assert.deepEqual(calls, ["GET", "GET"]);
});
