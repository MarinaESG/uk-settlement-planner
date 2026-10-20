import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createApp } from "../src/server.js";
import { emptyWorkspace } from "../src/domain.js";

const id = "00000000-0000-4000-8000-000000000001";
const settings = {
  SUPABASE_URL: "https://conflict.example.test",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fictional",
  SUPABASE_SECRET_KEY: "sb_secret_fictional",
  PRIVATE_PREVIEW_ENABLED: "true",
  PREVIEW_ALLOWED_EMAILS: "owner@example.test",
  COMMERCE_ENABLED: "false",
  STRIPE_SANDBOX_CHECKOUT: "false",
};
const draft = (note) => {
  const data = emptyWorkspace();
  data.checks[0].note = note;
  return data;
};
const precondition = (revision) =>
  revision === null
    ? { "If-None-Match": "*" }
    : { "If-Match": `"${revision}"` };

// A single shared provider models atomic database operations across app servers.
// It deliberately rejects any unconditional update or delete.
async function setup(t, initial = draft("baseline")) {
  let row = initial && {
    user_id: id,
    data: initial,
    revision: randomUUID(),
    updated_at: new Date().toISOString(),
  };
  let writes = 0,
    unavailable = false;
  const provider = async (raw, options) => {
    const url = new URL(raw);
    assert.equal(
      url.origin,
      settings.SUPABASE_URL,
      "No Stripe or other external calls",
    );
    if (url.pathname === "/auth/v1/user")
      return Response.json({
        id,
        email: "owner@example.test",
        email_confirmed_at: "2026-10-20T00:00:00Z",
      });
    assert.equal(url.pathname, "/rest/v1/workspaces");
    assert.equal(options.headers.apikey, settings.SUPABASE_SECRET_KEY);
    if (unavailable) return Response.json({}, { status: 503 });
    if (options.method === "POST") {
      assert.equal(url.searchParams.get("on_conflict"), "user_id");
      assert.equal(
        options.headers.Prefer,
        "resolution=ignore-duplicates,return=representation",
      );
      const input = JSON.parse(options.body);
      assert.equal(input.user_id, id);
      assert.deepEqual(Object.keys(input).sort(), ["data", "user_id"]);
      if (row) return Response.json([]);
      row = {
        ...input,
        revision: randomUUID(),
        updated_at: new Date().toISOString(),
      };
      writes++;
      return Response.json([row], { status: 201 });
    }
    assert.equal(url.searchParams.get("user_id"), "eq." + id);
    if (options.method === "GET") return Response.json(row ? [row] : []);
    assert.match(url.searchParams.get("revision"), /^eq\.[a-f0-9-]{36}$/);
    assert.equal(options.headers.Prefer, "return=representation");
    if (!row || url.searchParams.get("revision") !== "eq." + row.revision)
      return Response.json([]);
    if (options.method === "DELETE") {
      const deleted = row;
      row = null;
      writes++;
      return Response.json([deleted]);
    }
    assert.equal(options.method, "PATCH");
    const input = JSON.parse(options.body);
    assert.deepEqual(Object.keys(input), ["data"]);
    row = {
      ...row,
      data: input.data,
      revision: randomUUID(),
      updated_at: new Date().toISOString(),
    };
    writes++;
    return Response.json([row]);
  };
  const client = async () => {
    const app = createApp(settings, provider);
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    t.after(() => new Promise((resolve) => app.close(resolve)));
    return (path = "workspace", data, headers = {}) =>
      fetch(`http://127.0.0.1:${app.address().port}/api/${path}`, {
        method: data === undefined ? "GET" : "POST",
        headers: {
          Origin: "http://localhost:8780",
          Authorization: "Bearer fictional",
          "Content-Type": "application/json",
          ...headers,
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
  };
  return {
    api: await client(),
    client,
    row: () => structuredClone(row),
    writes: () => writes,
    setUnavailable: (value) => {
      unavailable = value;
    },
    removeRevision: () => {
      delete row.revision;
    },
  };
}

test("stale tab cannot overwrite newer records; reload and a deliberate edit can save", async (t) => {
  const { api, row, writes } = await setup(t);
  const a = await (await api()).json(),
    b = await (await api()).json();
  assert.equal(a.revision, b.revision);
  const saved = await api(
    "workspace",
    draft("newer A"),
    precondition(a.revision),
  );
  assert.equal(saved.status, 200);
  const next = await saved.json();
  assert.notEqual(next.revision, a.revision);
  const before = row();
  const rejected = await api(
    "workspace",
    draft("unsaved B"),
    precondition(b.revision),
  );
  assert.equal(rejected.status, 409);
  assert.match((await rejected.json()).error, /another tab or session/);
  assert.deepEqual(row(), before);
  assert.equal(writes(), 1);
  const reloaded = await (await api()).json();
  assert.equal(reloaded.data.checks[0].note, "newer A");
  assert.equal(
    (
      await api(
        "workspace",
        draft("reviewed B"),
        precondition(reloaded.revision),
      )
    ).status,
    200,
  );
  assert.equal(row().data.checks[0].note, "reviewed B");
});

test("simultaneous saves through separate app instances have exactly one winner", async (t) => {
  const { api, client, row, writes } = await setup(t);
  const second = await client();
  const { revision } = await (await api()).json();
  const responses = await Promise.all([
    api("workspace", draft("A"), precondition(revision)),
    second("workspace", draft("B"), precondition(revision)),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const winner = responses[0].status === 200 ? "A" : "B";
  assert.equal(row().data.checks[0].note, winner);
  assert.equal(writes(), 1);
});

test("simultaneous first saves cannot replace a newly created workspace", async (t) => {
  const { api, client, row, writes } = await setup(t, null);
  assert.equal((await (await api()).json()).revision, null);
  const second = await client();
  const responses = await Promise.all([
    api("workspace", draft("A"), precondition(null)),
    second("workspace", draft("B"), precondition(null)),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    row().data.checks[0].note,
    responses[0].status === 200 ? "A" : "B",
  );
  assert.equal(writes(), 1);
});

test("old clients and invalid preconditions cannot make unconditional writes or deletes", async (t) => {
  const { api, row, writes } = await setup(t);
  const before = row();
  for (const path of ["workspace", "workspace/delete"]) {
    const response = await api(path, draft("stale"));
    assert.equal(response.status, 428);
    assert.match(
      (await response.json()).error,
      /Export your unsaved changes first/,
    );
    for (const headers of [
      { "If-Match": "*" },
      { "If-Match": `"${before.revision}"`, "If-None-Match": "*" },
      { "If-Match": before.revision },
      { "If-None-Match": "invalid" },
      { "If-Match": '"or=(user_id.not.is.null)"' },
    ])
      assert.equal((await api(path, draft("stale"), headers)).status, 400);
  }
  assert.deepEqual(row(), before);
  assert.equal(writes(), 0);
});

test("stale deletes cannot remove newer data; deleted or recreated data cannot be resurrected by a stale save", async (t) => {
  const { api, row } = await setup(t);
  const old = row().revision;
  const saved = await (
    await api("workspace", draft("newer"), precondition(old))
  ).json();
  const before = row();
  assert.equal(
    (await api("workspace/delete", {}, precondition(old))).status,
    409,
  );
  assert.equal(
    (await api("workspace/delete", {}, precondition(null))).status,
    409,
  );
  assert.deepEqual(row(), before);
  assert.equal(
    (await api("workspace/delete", {}, precondition(saved.revision))).status,
    200,
  );
  assert.equal(row(), null);
  assert.equal(
    (await api("workspace", draft("stale"), precondition(saved.revision)))
      .status,
    409,
  );
  assert.equal(row(), null);
  assert.equal(
    (await api("workspace", draft("recreated"), precondition(null))).status,
    200,
  );
  assert.notEqual(row().revision, saved.revision);
  assert.equal(
    (await api("workspace", draft("stale"), precondition(saved.revision)))
      .status,
    409,
  );
  assert.equal(row().data.checks[0].note, "recreated");
});

test("a lost save acknowledgement is safe to retry: unchanged old revision cannot overwrite", async (t) => {
  const { api, row, writes } = await setup(t);
  const revision = row().revision;
  // The first response is deliberately not consumed by the caller.
  assert.equal(
    (await api("workspace", draft("committed"), precondition(revision))).status,
    200,
  );
  const committed = row();
  assert.equal(
    (await api("workspace", draft("retry"), precondition(revision))).status,
    409,
  );
  assert.deepEqual(row(), committed);
  assert.equal(writes(), 1);
});

test("provider failure and missing migration fail closed; retry after an outage remains possible", async (t) => {
  const { api, row, setUnavailable, removeRevision } = await setup(t);
  const before = row();
  setUnavailable(true);
  assert.equal(
    (
      await api(
        "workspace",
        draft("retry later"),
        precondition(before.revision),
      )
    ).status,
    502,
  );
  assert.deepEqual(row(), before);
  setUnavailable(false);
  assert.equal(
    (
      await api(
        "workspace",
        draft("retry later"),
        precondition(before.revision),
      )
    ).status,
    200,
  );
  removeRevision();
  const response = await api();
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Saving protection is not ready/);
});

test("known foreign revision and spoofed user ID cannot choose another record; payments remain blocked", async (t) => {
  const { api, row, writes } = await setup(t);
  const before = row();
  assert.equal(
    (
      await api(
        "workspace?user_id=somebody-else",
        {
          ...draft("spoof"),
          user_id: "somebody-else",
          revision: before.revision,
        },
        precondition(randomUUID()),
      )
    ).status,
    409,
  );
  assert.deepEqual(row(), before);
  assert.equal(writes(), 0);
  const config = await (await api("config")).json();
  assert.equal(config.commerce, false);
  assert.equal(config.sandboxCheckout, false);
  for (const path of ["checkout", "portal", "download"])
    assert.equal(
      (await api(path, path === "download" ? undefined : {})).status,
      503,
    );
});
