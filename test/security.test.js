import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  validSignature,
  priceMatches,
  hasSubscription,
  ownsSession,
} from "../src/security.js";
test("webhook authenticates exact raw payload and rejects forgery and stale replay", () => {
  const raw = Buffer.from('{"id":"evt_example"}'),
    t = 123456,
    secret = "fictional_test_secret",
    sig = createHmac("sha256", secret)
      .update(t + ".")
      .update(raw)
      .digest("hex"),
    h = `t=${t},v1=${sig}`;
  assert.ok(validSignature(raw, h, secret, t));
  assert.ok(!validSignature(Buffer.from("{}"), h, secret, t));
  assert.ok(!validSignature(raw, h, secret, t + 301));
  assert.ok(!validSignature(raw, h, "", t));
});
test("price gate rejects wrong amount, currency, frequency and inactive prices", () => {
  const p = {
    active: true,
    currency: "gbp",
    unit_amount: 100,
    billing_scheme: "per_unit",
    type: "recurring",
    recurring: { interval: "month", interval_count: 1 },
  };
  assert.ok(priceMatches(p, "monthly"));
  for (const patch of [
    { unit_amount: 1000 },
    { currency: "usd" },
    { active: false },
    { recurring: { interval: "year", interval_count: 1 } },
  ])
    assert.ok(!priceMatches({ ...p, ...patch }, "monthly"));
  assert.ok(
    priceMatches({ ...p, unit_amount: 500, type: "one_time" }, "download"),
  );
});
test("subscription status is authoritative and must include configured price", () => {
  const s = {
    status: "active",
    items: { data: [{ price: { id: "price_monthly" }, quantity: 1 }] },
  };
  assert.ok(hasSubscription([s], "price_monthly"));
  assert.ok(!hasSubscription([{ ...s, status: "past_due" }], "price_monthly"));
  assert.ok(!hasSubscription([s], "price_other"));
});
test("one-off purchase must belong to the signed-in account and match product and amount", () => {
  const s = {
    status: "complete",
    mode: "payment",
    payment_status: "paid",
    client_reference_id: "user_a",
    customer: "cus_a",
    metadata: { product: "download" },
    line_items: { data: [{ price: { id: "price_download" }, quantity: 1 }] },
    amount_total: 500,
    currency: "gbp",
  };
  assert.ok(ownsSession(s, "user_a", "cus_a", "price_download"));
  assert.ok(!ownsSession(s, "user_b", "cus_a", "price_download"));
  assert.ok(
    !ownsSession(
      { ...s, payment_status: "unpaid" },
      "user_a",
      "cus_a",
      "price_download",
    ),
  );
  assert.ok(
    !ownsSession(
      { ...s, amount_total: 100 },
      "user_a",
      "cus_a",
      "price_download",
    ),
  );
});
