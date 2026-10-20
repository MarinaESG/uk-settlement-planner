import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createApp } from "../src/server.js";
import { emptyWorkspace } from "../src/domain.js";

const origin = "http://localhost:8780";
const settings = {
  SUPABASE_URL: "https://preview.example.test",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fictional",
  SUPABASE_SECRET_KEY: "sb_secret_fictional",
  COMMERCE_ENABLED: "false",
  PRIVATE_PREVIEW_ENABLED: "true",
  PREVIEW_ALLOWED_EMAILS: "owner@example.com,tester@example.com",
};
const owner = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "owner@example.com",
  email_confirmed_at: "2026-10-20T09:00:00Z",
};
const tester = {
  ...owner,
  id: "00000000-0000-4000-8000-000000000002",
  email: "tester@example.com",
};
async function running(t, mock, env = settings) {
  const server = createApp(env, mock);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = "http://127.0.0.1:" + server.address().port;
  return (path, token = "owner_token", data, headers = {}) => fetch(base + "/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      ...(token ? { Authorization: "Bearer " + token } : {}),
      "Content-Type": "application/json",
      ...headers,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}

test("private preview fails closed on missing accounts, missing invite list or payment flags", () => {
  for (const override of [
    { SUPABASE_SECRET_KEY: "" },
    { PREVIEW_ALLOWED_EMAILS: "" },
    { PREVIEW_ALLOWED_EMAILS: " , " },
    { PREVIEW_ALLOWED_EMAILS: "owner@example.com,invalid" },
    { COMMERCE_ENABLED: "true" },
    { STRIPE_SANDBOX_CHECKOUT: "true", STRIPE_SECRET_KEY: "sk_test_fictional" },
  ]) assert.throws(() => createApp({ ...settings, ...override }), /Private preview/);
});

test("preview is opt-in and never publishes invite addresses or credentials", async (t) => {
  const api = await running(t, () => { throw Error("No external calls expected"); });
  const response = await api("config", "");
  const text = await response.text();
  const config = JSON.parse(text);
  assert.equal(config.privatePreview, true);
  assert.equal(config.authReady, true);
  assert.equal(config.commerce, false);
  assert.equal(config.sandboxCheckout, false);
  for (const value of [settings.SUPABASE_URL, settings.SUPABASE_SECRET_KEY,
    settings.SUPABASE_PUBLISHABLE_KEY, owner.email, tester.email])
    assert.equal(text.includes(value), false);
  const defaultApi = await running(t, undefined, {});
  assert.equal((await (await defaultApi("config", "")).json()).privatePreview, false);
});

test("only invited addresses can request or verify codes; matching is case-insensitive", async (t) => {
  const calls = [];
  const api = await running(t, async (url, options) => {
    calls.push(url);
    const data = JSON.parse(options.body);
    assert.equal(data.email, owner.email);
    if (url.endsWith("/otp")) return Response.json({});
    if (url.endsWith("/verify")) return Response.json({ access_token: "owner_token", user: owner });
    throw Error("Unexpected request");
  });
  for (const data of [
    { email: "outsider@example.com" },
    { email: "outsider@example.com", token: "123456" },
  ]) assert.equal((await api("auth/otp", "", data)).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await api("auth/otp", "", { email: " Owner@Example.COM " })).status, 200);
  const verified = await api("auth/otp", "", { email: owner.email, token: "123456" });
  assert.equal(verified.status, 200);
  assert.equal((await verified.json()).token, "owner_token");
  assert.equal(calls.length, 2);
});

test("provider verification cannot return a session for an uninvited or unconfirmed identity", async (t) => {
  let identity = { ...owner, email: "outsider@example.com" };
  const api = await running(t, async () => Response.json({
    access_token: "must_not_return", user: identity,
  }));
  for (const invalid of [identity, { ...owner, email_confirmed_at: null }]) {
    identity = invalid;
    const response = await api("auth/otp", "", { email: owner.email, token: "123456" });
    assert.equal(response.status, 403);
    assert.equal((await response.text()).includes("must_not_return"), false);
  }
});

test("uninvited and unconfirmed sessions cannot read, save or delete; browser email cannot grant access", async (t) => {
  let identity = { ...owner, email: "outsider@example.com" };
  const calls = [];
  const api = await running(t, async (url) => {
    calls.push(url);
    assert.ok(url.endsWith("/auth/v1/user"));
    return Response.json(identity);
  });
  assert.equal((await api("workspace", "")).status, 401);
  assert.equal(calls.length, 0);
  for (const invalid of [identity, { ...owner, email_confirmed_at: null }, { id: owner.id }]) {
    identity = invalid;
    assert.equal((await api("workspace?email=owner%40example.com")).status, 403);
    assert.equal((await api("workspace", "owner_token", { ...emptyWorkspace(), email: owner.email })).status, 403);
    assert.equal((await api("workspace/delete", "owner_token", {})).status, 403);
  }
  assert.equal(calls.length, 9);
});

test("two invited accounts save, reload and delete only their own records without Stripe", async (t) => {
  const records = new Map();
  const api = await running(t, async (url, options) => {
    const u = new URL(url);
    assert.equal(u.origin, settings.SUPABASE_URL);
    if (u.pathname === "/auth/v1/user")
      return Response.json(options.headers.Authorization === "Bearer tester_token" ? tester : owner);
    assert.equal(u.pathname, "/rest/v1/workspaces");
    assert.equal(options.headers.apikey, settings.SUPABASE_SECRET_KEY);
    if (options.method === "POST") {
      const row = JSON.parse(options.body);
      assert.equal(options.headers.Prefer, "resolution=ignore-duplicates,return=representation");
      if (records.has(row.user_id)) return Response.json([]);
      row.revision = randomUUID();
      row.updated_at = new Date().toISOString();
      records.set(row.user_id, row);
      return Response.json([row], { status: 201 });
    }
    const id = u.searchParams.get("user_id").replace(/^eq\./, "");
    if (options.method === "DELETE") {
      const row = records.get(id);
      assert.equal(u.searchParams.get("revision"), "eq." + row.revision);
      records.delete(id);
      return Response.json([row]);
    }
    return Response.json(records.has(id) ? [records.get(id)] : []);
  });
  const workspace = { ...emptyWorkspace(), trips: [{
    departure: "2025-06-01", arrival: "2025-06-08",
    evidence: "FICTIONAL preview backup test", status: "User-reported",
  }] };
  // A browser-supplied user_id must never choose the database owner.
  assert.equal((await api("workspace", "owner_token", { ...workspace, user_id: tester.id }, { "If-None-Match": "*" })).status, 200);
  assert.equal(records.has(tester.id), false);
  const loaded = await (await api("workspace?user_id=" + tester.id)).json();
  assert.deepEqual(loaded.data.trips, workspace.trips);
  assert.ok(loaded.updated);
  assert.deepEqual((await (await api("workspace", "tester_token")).json()).data, emptyWorkspace());
  assert.equal((await api("workspace", "tester_token", emptyWorkspace(), { "If-None-Match": "*" })).status, 200);
  assert.equal(records.size, 2);
  assert.equal((await api("workspace/delete?user_id=" + owner.id, "tester_token", {}, { "If-Match": `"${records.get(tester.id).revision}"` })).status, 200);
  assert.equal(records.has(owner.id), true);
  assert.equal(records.has(tester.id), false);
  // Invalid edits must not overwrite the existing valid record.
  assert.equal((await api("workspace", "owner_token", { version: 999 })).status, 400);
  assert.deepEqual(records.get(owner.id).data.trips, workspace.trips);
});

test("preview checkout, billing portal and purchased downloads stay disabled even with Stripe settings", async (t) => {
  let authCalls = 0;
  const api = await running(t, async (url) => {
    assert.ok(url.endsWith("/auth/v1/user"));
    authCalls++;
    return Response.json(owner);
  }, {
    ...settings,
    STRIPE_SECRET_KEY: "sk_live_fictional_unused",
    STRIPE_MONTHLY_PRICE_ID: "price_monthly",
    STRIPE_DOWNLOAD_PRICE_ID: "price_download",
    OPERATOR_NAME: "Fictional preview operator",
    SUPPORT_EMAIL: "support@example.com",
  });
  for (const product of ["monthly", "download"])
    assert.equal((await api("checkout", "owner_token", { product, acceptTerms: true })).status, 503);
  assert.equal((await api("portal", "owner_token", {})).status, 503);
  assert.equal((await api("download")).status, 503);
  assert.equal(authCalls, 4);
});

test("removing an invitation blocks an existing session on its next request", async (t) => {
  const api = await running(t, async (url) => {
    assert.ok(url.endsWith("/auth/v1/user"));
    return Response.json(owner);
  }, { ...settings, PREVIEW_ALLOWED_EMAILS: tester.email });
  assert.equal((await api("workspace")).status, 403);
  assert.equal((await api("workspace", "owner_token", emptyWorkspace())).status, 403);
});
