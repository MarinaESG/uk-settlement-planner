import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../src/server.js";
import { emptyWorkspace } from "../src/domain.js";
const REVISION = "11111111-1111-4111-8111-111111111111";
const ID = "00000000-0000-4000-8000-000000000001";
const config = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fictional_test",
  SUPABASE_SECRET_KEY: "sb_secret_fictional_test",
  STRIPE_SECRET_KEY: "fictional_stripe",
  STRIPE_MONTHLY_PRICE_ID: "price_monthly",
  STRIPE_DOWNLOAD_PRICE_ID: "price_download",
  OPERATOR_NAME: "Fictional test operator",
  SUPPORT_EMAIL: "support@example.test",
  COMMERCE_ENABLED: "true",
};
async function setup(t, overrides = {}) {
  const state = {
    status: "active",
    refunded: false,
    paid: false,
    amount: 100,
    saved: null,
    deleted: false,
    checkoutCalls: 0,
    checkoutBody: null,
    livePrice: false,
    liveSession: false,
  };
  const mock = async (raw, options = {}) => {
    const url = new URL(raw),
      path = url.pathname;
    if (path === "/auth/v1/user") {
      assert.equal(options.headers.apikey, config.SUPABASE_PUBLISHABLE_KEY);
      assert.equal(options.headers.Authorization, "Bearer fictional_token");
      return Response.json({ id: ID });
    }
    if (path.startsWith("/rest/v1/")) {
      assert.equal(options.headers.apikey, config.SUPABASE_SECRET_KEY);
      assert.equal(options.headers.Authorization, undefined);
    }
    if (path === "/rest/v1/customers")
      return Response.json([{ stripe_customer_id: "cus_own" }]);
    if (path === "/rest/v1/workspaces") {
      if (options.method === "POST") {
        assert.equal(options.headers.Prefer, "resolution=ignore-duplicates,return=representation");
        state.saved = { ...JSON.parse(options.body), revision: REVISION, updated_at: new Date().toISOString() };
        return Response.json([state.saved], { status: 201 });
      }
      if (options.method === "DELETE") {
        assert.equal(url.searchParams.get("revision"), "eq." + REVISION);
        state.deleted = true;
        const row = state.saved;
        state.saved = null;
        return Response.json([row]);
      }
      return Response.json(state.saved ? [state.saved] : []);
    }
    if (path === "/v1/subscriptions")
      return Response.json({
        has_more: false,
        data: [
          {
            status: state.status,
            items: { data: [{ price: { id: "price_monthly" }, quantity: 1 }] },
          },
        ],
      });
    if (path === "/v1/checkout/sessions" && options.method === "POST") {
      state.checkoutCalls++;
      state.checkoutBody = new URLSearchParams(options.body);
      assert.equal(state.checkoutBody.has("payment_method_types[0]"), false,
        "Checkout must use Stripe's Dashboard-managed payment methods");
      return Response.json({
        url: "https://checkout.stripe.com/test_fictional",
        livemode: state.liveSession,
      });
    }
    if (path === "/v1/checkout/sessions")
      return Response.json({
        has_more: false,
        data: state.paid
          ? [
              {
                id: "cs_own",
                mode: "payment",
                payment_status: "paid",
                client_reference_id: ID,
              },
            ]
          : [],
      });
    if (path === "/v1/checkout/sessions/cs_own")
      return Response.json({
        status: "complete",
        mode: "payment",
        payment_status: "paid",
        client_reference_id: ID,
        customer: "cus_own",
        metadata: { product: "download" },
        line_items: {
          data: [{ price: { id: "price_download" }, quantity: 1 }],
        },
        amount_total: 500,
        currency: "gbp",
        payment_intent: {
          latest_charge: {
            paid: true,
            refunded: state.refunded,
            amount_refunded: state.refunded ? 500 : 0,
            disputed: false,
          },
        },
      });
    if (path === "/v1/prices/price_monthly")
      return Response.json({
        active: true,
        livemode: state.livePrice,
        currency: "gbp",
        unit_amount: state.amount,
        billing_scheme: "per_unit",
        type: "recurring",
        recurring: { interval: "month", interval_count: 1 },
      });
    throw Error("Unexpected provider request: " + path);
  };
  const server = createApp({ ...config, ...overrides }, mock);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((r) => server.close(r)));
  const root = "http://127.0.0.1:" + server.address().port;
  const call = (path, body, headers = {}) =>
    fetch(root + "/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer fictional_token",
        Origin: "http://localhost:8780",
        "Content-Type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { state, call };
}
test("active subscriber saves with a revision; cancellation stops save but allows export and guarded deletion", async (t) => {
  const { state, call } = await setup(t),
    data = emptyWorkspace();
  data.checks[0].note = "FICTIONAL owner reference";
  assert.equal((await call("workspace", data, { "If-None-Match": "*" })).status, 200);
  assert.equal(state.saved.user_id, ID);
  assert.equal(state.saved.data.checks[0].note, data.checks[0].note);
  state.status = "canceled";
  assert.equal((await call("workspace", data)).status, 402);
  const exported = await call("workspace");
  assert.equal(exported.status, 200);
  assert.equal(
    (await exported.json()).data.checks[0].note,
    data.checks[0].note,
  );
  assert.equal((await call("workspace/delete", {}, { "If-Match": `"${REVISION}"` })).status, 200);
  assert.ok(state.deleted);
});
test("successful redirect and query parameters alone cannot unlock a download; refunded charge is denied", async (t) => {
  const { state, call } = await setup(t);
  assert.equal(
    (await call("download?checkout=returned&paid=true")).status,
    402,
  );
  state.paid = true;
  assert.equal((await (await call("account")).json()).download, true);
  state.refunded = true;
  assert.equal((await (await call("account")).json()).download, false);
  assert.equal((await call("download")).status, 402);
});
test("checkout enforces consent, correct configured price and a single active subscription", async (t) => {
  const { state, call } = await setup(t);
  assert.equal((await call("checkout", { product: "monthly" })).status, 400);
  assert.equal(
    (await call("checkout", { product: "monthly", acceptTerms: true })).status,
    409,
  );
  state.status = "canceled";
  state.amount = 500;
  assert.equal(
    (await call("checkout", { product: "monthly", acceptTerms: true })).status,
    503,
  );
  assert.equal(state.checkoutCalls, 0);
  state.amount = 100;
  assert.equal(
    (await call("checkout", { product: "monthly", acceptTerms: true })).status,
    200,
  );
  assert.equal(state.checkoutCalls, 1);
  assert.equal(state.checkoutBody.get("client_reference_id"), ID);
  assert.equal(state.checkoutBody.get("line_items[0][price]"), "price_monthly");
  assert.equal(state.checkoutBody.get("mode"), "subscription");
  assert.equal(state.checkoutBody.get("consent_collection[terms_of_service]"), "required");
});

test("local sandbox checkout requires acknowledgement, test prices and test sessions", async (t) => {
  const { state, call } = await setup(t, {
    STRIPE_SECRET_KEY: "sk_test_fictional",
    STRIPE_SANDBOX_CHECKOUT: "true",
  });
  state.status = "canceled";
  assert.equal((await call("checkout", { product: "monthly" })).status, 400);
  state.livePrice = true;
  assert.equal((await call("checkout", { product: "monthly", acceptTerms: true })).status, 503);
  assert.equal(state.checkoutCalls, 0);
  state.livePrice = false;
  assert.equal((await call("checkout", { product: "monthly", acceptTerms: true })).status, 200);
  assert.equal(state.checkoutBody.has("consent_collection[terms_of_service]"), false);
  assert.equal(state.checkoutBody.get("metadata[sandbox_checkout]"), "true");
  assert.match(state.checkoutBody.get("custom_text[submit][message]"), /SANDBOX TEST ONLY/);
  state.liveSession = true;
  assert.equal((await call("checkout", { product: "monthly", acceptTerms: true })).status, 502);
});

test("sandbox exception cannot start with live keys, production or public hosts", () => {
  const sandbox = { ...config, STRIPE_SECRET_KEY: "sk_test_fictional", STRIPE_SANDBOX_CHECKOUT: "true" };
  for (const override of [
    { STRIPE_SECRET_KEY: "sk_live_fictional" },
    { STRIPE_SECRET_KEY: "" },
    { NODE_ENV: "production", APP_ORIGIN: "https://example.test" },
    { APP_ORIGIN: "http://example.test" },
    { APP_ORIGIN: "http://localhost.example.test" },
    { APP_ORIGIN: "http://localhost:8780/path" },
    { HOST: "0.0.0.0" },
  ]) assert.throws(() => createApp({ ...sandbox, ...override }), /Sandbox checkout/);
});
