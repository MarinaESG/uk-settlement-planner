import { closedPreviewEmails, normaliseEmail } from "./preview-closure.js";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const validEmail = (s) => s.length <= 254 && /^\S+@\S+\.\S+$/.test(s);

// Operator-only utility. It is not imported by the web server or served publicly.
// No .env file is loaded here, no retries are automatic, and output omits content.
export async function reviewAccountClosure(options, env = process.env, request = fetch) {
  const { userId, expectedProject, apply = false, confirmId, accessBlockVerified = false } = options;
  const email = normaliseEmail(options.email);
  if (!uuid.test(userId || "") || !validEmail(email))
    throw Error("Provide a valid account ID and its verified email address.");
  if (env.PRIVATE_PREVIEW_ENABLED !== "true" || env.COMMERCE_ENABLED !== "false" || env.STRIPE_SANDBOX_CHECKOUT !== "false")
    throw Error("Account closure requires private preview and explicitly disabled live and sandbox payments.");
  const closed = closedPreviewEmails(env.PREVIEW_CLOSED_EMAILS);
  let url;
  try { url = new URL(env.SUPABASE_URL); } catch { throw Error("Invalid Supabase project URL."); }
  // Pin the destination before transmitting an administrative key.
  if (!/^[a-z0-9]{20}$/.test(expectedProject || "") ||
      url.origin !== `https://${expectedProject}.supabase.co` ||
      !["", "/"].includes(url.pathname) || url.search || url.hash || url.username || url.password)
    throw Error("The explicit project reference must match the Supabase project URL.");
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw Error("The administrative key must be supplied securely through the environment.");
  if (apply && (confirmId !== userId || accessBlockVerified !== true || !closed.has(email)))
    throw Error("Deletion requires a matching confirmation ID, a configured closure block and prior verification that the deployed app blocks this account.");
  const headers = {
    apikey: key,
    ...(key.startsWith("sb_secret_") ? {} : { Authorization: "Bearer " + key }),
    "Content-Type": "application/json",
  };
  async function call(path, method = "GET", body, allowMissing = false) {
    let r;
    try {
      r = await request(url.origin + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000), redirect: "error",
      });
    } catch {
      throw Error("Provider request failed. Do not assume deletion succeeded; review the account before retrying.");
    }
    if (allowMissing && r.status === 404) return null;
    if (!r.ok) throw Error("Provider request failed. Check the administrative result securely; no deletion completion is confirmed.");
    // Never echo provider bodies or errors: they may contain identity or secrets.
    try { return r.status === 204 ? null : await r.json(); }
    catch { throw Error("Provider returned an unreadable result. Deletion completion is not confirmed."); }
  }
  async function identity() {
    const result = await call(`/auth/v1/admin/users/${userId}`, "GET", undefined, true);
    if (result === null) return null;
    const u = result.user || result;
    if (u.id !== userId || normaliseEmail(u.email) !== email)
      throw Error("The account ID and verified email do not match. No deletion is authorised.");
    return u;
  }
  async function rowCount(table) {
    const rows = await call(`/rest/v1/${table}?user_id=eq.${userId}&select=user_id`);
    if (!Array.isArray(rows) || rows.length > 1 || rows.some((row) => row.user_id !== userId))
      throw Error("Unexpected linked-record result. Stop and investigate the account scope.");
    return rows.length;
  }
  const user = await identity();
  const before = { authAccount: user !== null, workspaces: await rowCount("workspaces"), customers: await rowCount("customers") };
  const result = { mode: apply ? "apply" : "review", project: expectedProject, userId, before, accountBlockConfigured: closed.has(email) };
  if (!apply) return { ...result, status: "review_only", changed: false };
  // An absent identity with remaining rows needs investigation, never a broad
  // cleanup. This also makes interrupted runs safe to review and repeat.
  if (!user && (before.workspaces || before.customers))
    throw Error("The identity is absent but linked records remain. Closure is incomplete; investigate without broad deletion.");
  if (user) await call(`/auth/v1/admin/users/${userId}`, "DELETE", { should_soft_delete: false });
  const remaining = await identity();
  const after = { authAccount: remaining !== null, workspaces: await rowCount("workspaces"), customers: await rowCount("customers") };
  if (after.authAccount || after.workspaces || after.customers)
    throw Error("Closure is incomplete: account or linked records remain. Keep access blocked and investigate.");
  return {
    ...result, after, changed: !!user, status: "active_account_records_absent",
    outstanding: ["verify old-session denial", "support correspondence and provider retention", "operator copies and justified exceptions", "device and exported backup guidance"],
  };
}
