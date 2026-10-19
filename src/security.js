import { createHmac, timingSafeEqual } from "node:crypto";
export function validSignature(raw, header, secret, now = Date.now() / 1000) {
  if (!secret || !header) return false;
  const pairs = header.split(",").map((x) => x.split("=")),
    t = pairs.find((x) => x[0] === "t")?.[1];
  if (!t || !/^\d+$/.test(t) || Math.abs(now - Number(t)) > 300) return false;
  const expected = createHmac("sha256", secret)
    .update(t + ".")
    .update(raw)
    .digest();
  return pairs.some(
    ([k, v]) =>
      k === "v1" &&
      /^[a-f0-9]{64}$/.test(v || "") &&
      timingSafeEqual(Buffer.from(v, "hex"), expected),
  );
}
export function priceMatches(p, kind) {
  return (
    p.active === true &&
    p.currency === "gbp" &&
    p.unit_amount === (kind === "monthly" ? 100 : 500) &&
    p.billing_scheme === "per_unit" &&
    (kind === "monthly"
      ? p.type === "recurring" &&
        p.recurring?.interval === "month" &&
        p.recurring?.interval_count === 1
      : p.type === "one_time")
  );
}
export function hasSubscription(list, price) {
  return list.some(
    (s) =>
      s.status === "active" &&
      s.items?.data?.some((i) => i.price?.id === price && i.quantity === 1),
  );
}
export function ownsSession(s, user, customer, price) {
  return (
    s.status === "complete" &&
    s.mode === "payment" &&
    s.payment_status === "paid" &&
    s.client_reference_id === user &&
    s.customer === customer &&
    s.metadata?.product === "download" &&
    s.line_items?.data?.length === 1 &&
    s.line_items.data[0].price?.id === price &&
    s.line_items.data[0].quantity === 1 &&
    s.amount_total === 500 &&
    s.currency === "gbp"
  );
}
