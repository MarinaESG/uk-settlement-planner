# Operator launch guide

This is a deployable starter, not an activated paid service. The repository contains no real keys, operator contact details or customer records.

## 1. Establish the public service

Choose the domain and Node-compatible hosting account. Supply the real business/operator name, service address, support contact, applicable tax treatment, cancellation/refund procedure, privacy notice, retention policy and account-deletion process. The current page contains pre-launch disclosure text, not completed production terms.

The code licence permits commercial operation. It does not establish compliance with immigration-advice regulation, consumer law or data-protection obligations. Obtain appropriate review for the actual service and claims before charging. Do not market it as an eligibility decision or guaranteed coverage of all ILR provisions.

Named release responsibilities to assign:

| Area              | Required owner and evidence                                                               |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Route content     | Maintainer plus qualified reviewer; date, official source, coverage decision and approval |
| Customer service  | Operator; published contact and tested cancellation/refund/account-deletion process       |
| Data protection   | Operator; processor arrangements, retention, access/deletion handling and backup policy   |
| Billing           | Operator; confirmed GBP prices, tax treatment, test receipts and cancellation evidence    |
| Technical release | Maintainer; test report, deployment configuration, recovery and monitoring checks         |

## 2. Supabase

1. Create your own project and run `supabase/schema.sql` in its SQL editor.
2. Enable email authentication and keep email confirmation enabled. Include the one-time `{{ .Token }}` code in both **Magic link or OTP** and **Confirm sign up** email templates, so new and existing accounts can enter a code in the planner.
3. Configure production email delivery, authorised site URL, provider rate limits and abuse protection. The in-process IP limiter is only a baseline; behind a proxy, use a platform-level limiter with its trusted client-IP handling.
4. In Supabase **Settings > API Keys**, obtain a publishable key (`sb_publishable_...`) and a **server-only** secret key (`sb_secret_...`). Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` in hosting secrets, or in a local ignored `.env` for testing. Never put the secret key in browser code, a screenshot, a chat, a GitHub issue or a committed file. Legacy `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` remain supported as fallbacks; the new variable names take precedence. See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).
5. Test two accounts. Verify that each can only read, save and delete its own workspace, including attempts to pass another user ID in query parameters.

Direct table access for `anon` and `authenticated` is revoked. RLS is enabled without client policies. Only this server’s privileged calls can access the tables, after validating the user with Supabase. Secret keys map to the `service_role` database role and use the `apikey` header; user access tokens continue to use `Authorization: Bearer`. Audit any database changes that weaken those restrictions.

For initial local email tests, set Site URL and `APP_ORIGIN` to `http://localhost:8780`, keep `COMMERCE_ENABLED=false`, and connect a separate test project to Mailtrap **Email Sandbox** SMTP. The sandbox captures authentication messages for inspection and requires no verified sending domain. Read the code from its inbox; this does not test delivery to a customer's real mailbox. Use a verified production sender before enabling real customer sign-ups. Never use the static `file://` preview for connected account tests; run the Node server.

Sessions are stored in browser session storage. There is no automatic refresh: an expired session requires a new email code. The app never sends workspace records to Stripe. Deleting a workspace does not delete the Supabase identity or legally required payment records; the operator must provide a separate full-account request process.

## 3. Stripe in test mode

Create two active GBP prices:

| Environment variable       | Amount    | Type                                 |
| -------------------------- | --------- | ------------------------------------ |
| `STRIPE_DOWNLOAD_PRICE_ID` | 500 pence | One-time, per-unit                   |
| `STRIPE_MONTHLY_PRICE_ID`  | 100 pence | Recurring, every one month, per-unit |

Configure inclusive tax treatment where required so the displayed total agrees with the advertised price. The current app does not add Stripe Tax or discounts. Do not enable extra surcharges without changing the product and entitlement checks.

Set a published Terms of Service URL in Stripe Checkout settings, because Checkout requires acceptance. Configure the customer portal to permit cancellation at the end of the current billing period and payment-method updates; disable plan switching and quantity changes for this initial release. Configure receipts and support information.

For local sandbox testing before business onboarding, `STRIPE_SANDBOX_CHECKOUT=true` explicitly enables a simulated checkout without Stripe's Terms of Service checkbox. It requires a `sk_test_` key, a localhost/127.0.0.1 HTTP origin, a loopback bind address and a non-production environment; invalid combinations stop the server. The planner shows a test acknowledgement and Stripe shows a simulation notice. Test prices and returned sessions must have `livemode=false`. Default checkout continues to require the published terms. This option tests payment, return and entitlement behaviour only: it does not validate terms acceptance, business verification or production readiness. Use fictional account details, Stripe test cards and a separate test Supabase project. Remove or set this flag to false before deployment.

Set the Stripe secret key and price IDs as server secrets. `STRIPE_WEBHOOK_SECRET` is optional unless registering `/api/webhook`. That endpoint verifies the raw signature but performs **no entitlement mutation**. Every protected access checks canonical Stripe records, so webhook duplicates or out-of-order delivery cannot create access.

Access policy:

- Hosted saving requires an `active` subscription containing the configured monthly price and quantity one. `past_due`, `unpaid`, `incomplete`, `trialing` and cancelled subscriptions do not qualify. An end-of-period cancellation remains active until Stripe changes its status.
- Downloads require a completed, paid session belonging to the signed-in user/customer, with the configured one-time item, quantity one and total exactly £5. A refund or disputed charge removes future download access. It cannot recall an already downloaded file.
- Existing open checkout sessions are reused. Provider idempotency keys reduce duplicate checkout creation; test parallel requests and retries on your deployment before launch.
- Reads/export/delete remain available to authenticated users after subscription expiry. There is no paid-only read lock on the user’s existing data.
- The history lookup is bounded at 2,000 Stripe records per list and then fails closed for support review. This first release is intended for a small deployment, not high-volume billing.

## 4. Deploy

Copy `.env.example` to a local untracked `.env` for development, or enter the same variables in your host’s secret settings. Never publish the filled file.

```sh
npm test
npm run build:download
```

Deploy using the supplied Dockerfile or a Node 22+ web service. Set:

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=8780
APP_ORIGIN=https://your-chosen-domain
```

Use the actual host-provided port where necessary. `APP_ORIGIN` must be the exact HTTPS origin, without a trailing slash or path. Terminate HTTPS at your host/reverse proxy. Configure platform timeouts, request/rate limits, logs without tokens or workspace bodies, uptime checks and backups. The service has no file-based customer database; it uses Supabase.

GitHub Pages can host static documentation or a separately packaged demonstration. It cannot host this paid Node service.

## 5. Record acceptance checks before enabling live billing

Test the following against your actual Supabase project and Stripe **test mode**, recording expected result, observed result, owner and date:

- Email code request, invalid/expired code, sign-in, expiry and sign-out.
- Two-account isolation, save, reload, export, import and deletion.
- Successful £5 payment, download, repeated download, failed payment, cancelled checkout, refund and dispute handling.
- Successful £1 subscription, saving, repeated checkout clicks, cancellation, period-end expiry, failed renewal and restoring payment.
- Export after cancellation, wrong price/currency, forged webhook and repeated webhook delivery.
- Mobile layout, keyboard access, screen-reader labels, backups and restore after deployment.
- Operator terms/support/privacy information and complete end-to-end customer receipts.

Only after these pass should the operator enable `COMMERCE_ENABLED=true` with live keys and approved production content. The repository’s mock tests are not evidence of a successful real purchase or legal sign-off.
