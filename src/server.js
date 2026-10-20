import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { catalogue, sources } from "./catalogue.js";
import { validateWorkspace, emptyWorkspace } from "./domain.js";
import {
  validSignature,
  priceMatches,
  hasSubscription,
  ownsSession,
} from "./security.js";

export function createApp(env = process.env, request = fetch) {
  const origin = env.APP_ORIGIN || "http://localhost:8780";
  if (env.NODE_ENV === "production" && !origin.startsWith("https://"))
    throw Error("Production requires an HTTPS APP_ORIGIN.");
  const sandboxCheckout = env.STRIPE_SANDBOX_CHECKOUT === "true";
  if (
    sandboxCheckout &&
    (env.NODE_ENV === "production" ||
      !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
      !["127.0.0.1", "localhost", "::1"].includes(env.HOST || "127.0.0.1") ||
      !env.STRIPE_SECRET_KEY?.startsWith("sk_test_"))
  )
    throw Error("Sandbox checkout requires a test key and a non-production, loopback-only server.");
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
  const secretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  const authReady = !!(env.SUPABASE_URL && publishableKey && secretKey);
  // Opaque secret keys use apikey; only legacy JWT keys belong in Bearer.
  const databaseHeaders = {
    apikey: secretKey,
    ...(secretKey?.startsWith("sb_secret_")
      ? {}
      : { Authorization: "Bearer " + secretKey }),
    "Content-Type": "application/json",
  };
  const commerce =
    authReady &&
    env.COMMERCE_ENABLED === "true" &&
    !!(
      env.STRIPE_SECRET_KEY &&
      env.STRIPE_MONTHLY_PRICE_ID &&
      env.STRIPE_DOWNLOAD_PRICE_ID &&
      env.OPERATOR_NAME &&
      env.SUPPORT_EMAIL
    );
  const rates = new Map();
  function fail(status, message) {
    const e = Error(message);
    e.status = status;
    throw e;
  }
  async function remote(url, options = {}) {
    const r = await request(url, {
      ...options,
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok)
      fail(
        502,
        "An account or payment service is unavailable. Please try again.",
      );
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  }
  async function db(path, method = "GET", data) {
    return remote(env.SUPABASE_URL + "/rest/v1/" + path, {
      method,
      headers: {
        ...databaseHeaders,
        Prefer: "return=representation",
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  }
  async function stripe(path, method = "GET", data, key) {
    return remote("https://api.stripe.com/v1/" + path, {
      method,
      headers: {
        Authorization: "Bearer " + env.STRIPE_SECRET_KEY,
        ...(method === "POST"
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: data ? new URLSearchParams(data).toString() : undefined,
    });
  }
  async function user(req) {
    if (!authReady)
      fail(503, "Accounts are not connected yet. Use the fictional demo.");
    const h = req.headers.authorization || "";
    if (!/^Bearer [A-Za-z0-9._-]+$/.test(h)) fail(401, "Please sign in.");
    const r = await request(env.SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: publishableKey, Authorization: h },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) fail(401, "Your session has expired. Sign in again.");
    const u = await r.json();
    if (!/^[a-f0-9-]{36}$/.test(u.id || "")) fail(401, "Invalid account.");
    return u;
  }
  async function customer(u, create = false) {
    const rows = await db(
      "customers?user_id=eq." + u.id + "&select=stripe_customer_id",
    );
    if (rows.length) return rows[0].stripe_customer_id;
    if (!create) return null;
    const c = await stripe(
      "customers",
      "POST",
      { "metadata[user_id]": u.id },
      "customer-" + u.id,
    );
    await remote(env.SUPABASE_URL + "/rest/v1/customers?on_conflict=user_id", {
      method: "POST",
      headers: {
        ...databaseHeaders,
        Prefer: "resolution=ignore-duplicates",
      },
      body: JSON.stringify({ user_id: u.id, stripe_customer_id: c.id }),
    });
    const saved = await db(
      "customers?user_id=eq." + u.id + "&select=stripe_customer_id",
    );
    return saved[0].stripe_customer_id;
  }
  async function list(path) {
    let data = [],
      after = "";
    for (let i = 0; i < 20; i++) {
      const r = await stripe(
        path +
          "&limit=100" +
          (after ? "&starting_after=" + encodeURIComponent(after) : ""),
      );
      data.push(...r.data);
      if (!r.has_more) return data;
      after = r.data.at(-1).id;
    }
    fail(503, "Payment history requires support review.");
  }
  async function monthly(c) {
    return (
      !!c &&
      hasSubscription(
        await list(
          "subscriptions?customer=" + encodeURIComponent(c) + "&status=all",
        ),
        env.STRIPE_MONTHLY_PRICE_ID,
      )
    );
  }
  async function downloadSession(u, c) {
    if (!c) return null;
    const sessions = await list(
      "checkout/sessions?customer=" + encodeURIComponent(c),
    );
    for (const item of sessions.filter(
      (s) =>
        s.mode === "payment" &&
        s.payment_status === "paid" &&
        s.client_reference_id === u.id,
    )) {
      const s = await stripe(
        "checkout/sessions/" +
          encodeURIComponent(item.id) +
          "?expand[]=line_items&expand[]=payment_intent.latest_charge",
      );
      const charge = s.payment_intent?.latest_charge;
      if (
        ownsSession(s, u.id, c, env.STRIPE_DOWNLOAD_PRICE_ID) &&
        charge?.paid &&
        !charge.refunded &&
        charge.amount_refunded === 0 &&
        !charge.disputed
      )
        return s;
    }
    return null;
  }
  async function body(req) {
    let n = 0,
      parts = [];
    for await (const p of req) {
      n += p.length;
      if (n > 180000) fail(413, "Request exceeds 180 KB.");
      parts.push(p);
    }
    return Buffer.concat(parts);
  }
  function limited(req, key) {
    const now = Date.now(),
      id = req.socket.remoteAddress + ":" + key;
    for (const [k, v] of rates) if (v.until < now) rates.delete(k);
    const v = rates.get(id) || { n: 0, until: now + 600000 };
    if (++v.n > 20) fail(429, "Please wait a few minutes before trying again.");
    rates.set(id, v);
  }
  return http.createServer(async (req, res) => {
    const headers = {
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    };
    function send(status, data, type = "application/json") {
      res.writeHead(status, { ...headers, "Content-Type": type });
      res.end(type === "application/json" ? JSON.stringify(data) : data);
    }
    try {
      const url = new URL(req.url, origin),
        path = url.pathname;
      if (
        req.method === "POST" &&
        path !== "/api/webhook" &&
        req.headers.origin !== origin
      )
        fail(403, "Unrecognised request origin.");
      if (path === "/api/config" && req.method === "GET")
        return send(200, {
          authReady,
          commerce,
          sandboxCheckout,
          operator: env.OPERATOR_NAME || "Operator not configured",
          support: env.SUPPORT_EMAIL || "",
          catalogue,
          sources,
        });
      if (path === "/api/webhook" && req.method === "POST") {
        const raw = await body(req);
        if (
          !validSignature(
            raw,
            req.headers["stripe-signature"],
            env.STRIPE_WEBHOOK_SECRET,
          )
        )
          fail(400, "Invalid webhook signature.");
        // No entitlement mutations. Every protected request reads Stripe's canonical state.
        return send(200, { received: true });
      }
      if (path === "/api/auth/otp" && req.method === "POST") {
        if (!authReady) fail(503, "Accounts are not connected yet.");
        limited(req, "otp");
        const d = JSON.parse((await body(req)).toString());
        if (
          typeof d.email !== "string" ||
          d.email.length > 254 ||
          !/^\S+@\S+\.\S+$/.test(d.email)
        )
          fail(400, "Enter a valid email address.");
        const verifying = typeof d.token === "string";
        if (verifying && !/^\d{6,10}$/.test(d.token))
          fail(400, "Enter the code from your email.");
        const r = await remote(
          env.SUPABASE_URL + "/auth/v1/" + (verifying ? "verify" : "otp"),
          {
            method: "POST",
            headers: {
              apikey: publishableKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(
              verifying
                ? { email: d.email, token: d.token, type: "email" }
                : { email: d.email, create_user: true },
            ),
          },
        );
        return send(
          200,
          verifying
            ? { token: r.access_token, email: r.user?.email }
            : { sent: true },
        );
      }
      if (path.startsWith("/api/")) {
        const u = await user(req);
        if (path === "/api/workspace" && req.method === "GET") {
          const rows = await db(
            "workspaces?user_id=eq." + u.id + "&select=data,updated_at",
          );
          return send(200, {
            data: rows[0]?.data || emptyWorkspace(),
            updated: rows[0]?.updated_at || null,
          });
        }
        if (path === "/api/workspace" && req.method === "POST") {
          if (!commerce || !(await monthly(await customer(u))))
            fail(
              402,
              "An active £1 monthly subscription is required to save the hosted workspace.",
            );
          const data = validateWorkspace(
            JSON.parse((await body(req)).toString()),
          );
          await remote(
            env.SUPABASE_URL + "/rest/v1/workspaces?on_conflict=user_id",
            {
              method: "POST",
              headers: {
                ...databaseHeaders,
                Prefer: "resolution=merge-duplicates",
              },
              body: JSON.stringify({
                user_id: u.id,
                data,
                updated_at: new Date().toISOString(),
              }),
            },
          );
          return send(200, { saved: true });
        }
        if (path === "/api/workspace/delete" && req.method === "POST") {
          await db("workspaces?user_id=eq." + u.id, "DELETE");
          return send(200, { deleted: true });
        }
        if (!commerce)
          fail(503, "Payments are not activated. No charge has been made.");
        if (path === "/api/account" && req.method === "GET") {
          const c = await customer(u);
          return send(200, {
            monthly: await monthly(c),
            download: !!(await downloadSession(u, c)),
          });
        }
        if (path === "/api/checkout" && req.method === "POST") {
          limited(req, "checkout");
          const d = JSON.parse((await body(req)).toString());
          if (!["monthly", "download"].includes(d.product))
            fail(400, "Choose a product.");
          if (d.acceptTerms !== true)
            fail(400, "Review and accept the purchase terms first.");
          const price =
            d.product === "monthly"
              ? env.STRIPE_MONTHLY_PRICE_ID
              : env.STRIPE_DOWNLOAD_PRICE_ID;
          const configuredPrice = await stripe("prices/" + encodeURIComponent(price));
          if (
            !priceMatches(configuredPrice, d.product) ||
            (sandboxCheckout && configuredPrice.livemode !== false)
          )
            fail(
              503,
              "Price configuration does not match the advertised price.",
            );
          const c = await customer(u, true);
          if (d.product === "monthly" && (await monthly(c)))
            fail(
              409,
              "You already have an active subscription. Use Manage subscription.",
            );
          if (d.product === "download" && (await downloadSession(u, c)))
            fail(
              409,
              "You already own the download. Use Download purchased planner.",
            );
          const open = (
            await list("checkout/sessions?customer=" + encodeURIComponent(c))
          ).find(
            (s) =>
              s.status === "open" &&
              s.client_reference_id === u.id &&
              s.metadata?.product === d.product &&
              s.metadata?.price === price &&
              (sandboxCheckout
                ? s.livemode === false && s.metadata?.sandbox_checkout === "true"
                : s.metadata?.sandbox_checkout !== "true"),
          );
          if (open) return send(200, { url: open.url });
          const session = await stripe(
            "checkout/sessions",
            "POST",
            {
              customer: c,
              client_reference_id: u.id,
              mode: d.product === "monthly" ? "subscription" : "payment",
              "line_items[0][price]": price,
              "line_items[0][quantity]": "1",
              "metadata[product]": d.product,
              "metadata[price]": price,
              "metadata[sandbox_checkout]": String(sandboxCheckout),
              success_url: origin + "/?checkout=returned",
              cancel_url: origin + "/?checkout=cancelled",
              ...(sandboxCheckout
                ? { "custom_text[submit][message]": "SANDBOX TEST ONLY. Use a Stripe test card. No real payment or purchase contract is created." }
                : { "consent_collection[terms_of_service]": "required" }),
            },
            "checkout-v2-" +
              u.id +
              "-" +
              d.product +
              "-" +
              (sandboxCheckout ? "sandbox-" : "standard-") +
              Math.floor(Date.now() / 1800000),
          );
          if (sandboxCheckout && session.livemode !== false)
            fail(502, "Stripe did not return a sandbox checkout session.");
          return send(200, { url: session.url });
        }
        if (path === "/api/portal" && req.method === "POST") {
          const c = await customer(u);
          if (!c) fail(404, "No payment account exists.");
          return send(
            200,
            await stripe("billing_portal/sessions", "POST", {
              customer: c,
              return_url: origin + "/",
            }),
          );
        }
        if (path === "/api/download" && req.method === "GET") {
          if (!(await downloadSession(u, await customer(u))))
            fail(402, "A completed £5 download purchase is required.");
          res.setHeader(
            "Content-Disposition",
            'attachment; filename="My-Settlement-Record.html"',
          );
          return send(
            200,
            await readFile(
              new URL("../dist/Settlement-Planner-UK.html", import.meta.url),
            ),
            "text/html; charset=utf-8",
          );
        }
        fail(404, "Unknown operation.");
      }
      if (req.method !== "GET") fail(405, "Method not allowed.");
      // Explicit allowlist: secrets, source, database schema and the paid download are never static assets.
      const assets = {
        "/": "index.html",
        "/app.js": "app.js",
        "/style.css": "style.css",
        "/domain.js": "../src/domain.js",
        "/catalogue.js": "../src/catalogue.js",
        "/planner.js": "planner.js",
      };
      if (!assets[path]) fail(404, "Page not found.");
      const ext = assets[path].split(".").at(-1),
        type = { html: "text/html", js: "text/javascript", css: "text/css" }[
          ext
        ];
      return send(
        200,
        await readFile(new URL("../public/" + assets[path], import.meta.url)),
        type + "; charset=utf-8",
      );
    } catch (e) {
      const status = e.status || (e instanceof SyntaxError ? 400 : 500);
      send(status, {
        error:
          status === 500
            ? "An unexpected error occurred. Please try again."
            : e.message,
      });
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8780);
  createApp().listen(port, process.env.HOST || "127.0.0.1", () =>
    console.log(
      "Local: " + (process.env.APP_ORIGIN || "http://localhost:" + port),
    ),
  );
}
