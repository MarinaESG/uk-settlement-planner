import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../src/server.js";
import { emptyWorkspace } from "../src/domain.js";
async function running(t, env = {}, mock) {
  const server = createApp(env, mock);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: "http://127.0.0.1:" + server.address().port };
}
test("unconfigured deployment cannot charge or expose private assets", async (t) => {
  const { url } = await running(t);
  for (const p of [
    "/.env",
    "/src/server.js",
    "/supabase/schema.sql",
    "/dist/Settlement-Planner-UK.html",
    "/../.env",
  ])
    assert.equal((await fetch(url + p)).status, 404);
  assert.equal((await fetch(url + "/api/config")).status, 200);
  assert.equal(
    (
      await fetch(url + "/api/checkout", {
        method: "POST",
        headers: {
          Origin: "http://localhost:8780",
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
    503,
  );
  assert.equal(
    (
      await fetch(url + "/api/workspace", {
        method: "POST",
        headers: { Origin: "https://wrong.example" },
      })
    ).status,
    403,
  );
});
test("unauthenticated requests fail before database access; configured accounts are scoped by validated identity", async (t) => {
  const id = "00000000-0000-4000-8000-000000000001",
    seen = [];
  const env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "fictional_anon",
    SUPABASE_SERVICE_ROLE_KEY: "fictional_service",
  };
  const mock = async (url, options) => {
    seen.push(url);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id });
    if (url.includes("/rest/v1/workspaces?user_id=eq." + id))
      return Response.json([{ data: emptyWorkspace() }]);
    throw Error("Unexpected external request");
  };
  const { url } = await running(t, env, mock);
  assert.equal((await fetch(url + "/api/workspace")).status, 401);
  assert.equal(seen.length, 0);
  const r = await fetch(url + "/api/workspace?user_id=someone_else", {
    headers: { Authorization: "Bearer fictional_token" },
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).data.version, 1);
  assert.ok(seen[1].includes(id));
  assert.ok(!seen.some((x) => x.includes("someone_else")));
  const save = await fetch(url + "/api/workspace", {
    method: "POST",
    headers: {
      Authorization: "Bearer fictional_token",
      Origin: "http://localhost:8780",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(emptyWorkspace()),
  });
  assert.equal(save.status, 402);
});
test("production rejects HTTP origin", () =>
  assert.throws(
    () =>
      createApp({ NODE_ENV: "production", APP_ORIGIN: "http://example.test" }),
    /HTTPS/,
  ));
