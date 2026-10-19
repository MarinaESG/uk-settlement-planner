# Settlement Planner UK

An open-source UK settlement evidence planner with a searchable route catalogue, travel records, permission history and review notes.

**Status: pre-launch v0.1.** The code runs locally with fictional demo data. Paid operation requires your own Supabase, Stripe and hosting configuration. No real customer payments or external account integrations have been verified for this release.

## Product and pricing

| Offer | Price | Included |
| --- | --- | --- |
| Public catalogue and fictional demo | Free | Official route signposts and a demonstration workspace |
| Packaged offline planner | £5 once | Standalone HTML file, browser-local records, JSON export/import |
| Operated hosted workspace | £1 per month | Account-based saving while the subscription is active; export/delete remain accessible afterwards |

The source is MIT-licensed and can be inspected, modified, built and self-hosted free of charge. The prices are for the operated service and packaged delivery. Public source cannot guarantee payment for every copy or prevent redistribution. An offline purchase does not include a hosted subscription or guaranteed updates.

## Run the demo

Install Node.js 22 or later, then run these commands from this directory:

```sh
npm run build:download
npm start
```

Open **http://localhost:8780**. No third-party packages or credentials are required for the fictional demo. Use the hostname `localhost`, matching the default `APP_ORIGIN`, rather than `127.0.0.1` when making account requests.

For a self-contained website preview that opens directly from disk, run `npm run build:preview` and open `dist/Settlement-Planner-UK-Preview.html`. The preview keeps edits in memory and has no account or payment connection. The separate `dist/Settlement-Planner-UK.html` is the blank offline planner with local saving.

```sh
npm test
```

The tests use local ports and mock provider responses. They do not contact Stripe, Supabase or the Home Office.

The initial verification record is in [docs/VERIFICATION.md](docs/VERIFICATION.md).

## What this release does

- Catalogue of 33 route and signpost entries, including work, family, residence, protection, legacy and specialist provisions. Each links to an official source and carries a review date.
- Evidence workspace usable against any catalogue entry. Records distinguish user reports, evidence links and the user’s own review status.
- Long-residence whole-day absence indicators, including the April 2024 transition, calendar-based rolling windows, overlaps and a selected review period.
- Email-code sign-in integration with Supabase, server-validated user identity and per-user storage.
- Stripe Checkout and billing portal integration; server-side access checks query current Stripe records. A checkout redirect never grants access.
- Subscription cancellation through the configured Stripe portal. Users retain access to read, export or delete their saved workspace without an active subscription.
- A standalone HTML download built from the same catalogue and planner code.

## Coverage boundaries

This is an evidence organiser, not a Home Office service or an immigration eligibility decision. The catalogue is broad but is not a verified exhaustive account of every historical, discretionary or special provision. **Only long residence has automated absence indicators.** Other entries offer evidence organisation and official signposts, not a route-specific eligibility engine.

Long-residence totals are limited to the selected review period. A trip that crosses a boundary is flagged for review; its full length is retained for the pre-change single-trip indicator. No exception days are automatically removed. The software does not establish lawful residence, calculate section 3C leave, decide which permission periods count, confirm English-language requirements, assess suitability, optimise an application date or certify that a chosen ten-year period qualifies.

Sources were checked on **19 October 2026**. There is no automatic rule-update service. See [sources and coverage](docs/COVERAGE.md).

## Connect accounts and payments

Follow [the launch guide](docs/LAUNCH.md) in a test environment first. Keep `COMMERCE_ENABLED=false` until configuration and end-to-end checks are complete. The default demo cannot take payment.

The application uses Node’s HTTP, cryptography and Fetch APIs with no runtime npm dependencies. Supabase stores the account/workspace; Stripe collects payment. GitHub Pages alone cannot run this backend or enforce its paywall.

## Project map

| File | Purpose |
| --- | --- |
| `src/catalogue.js` | Official-source catalogue and coverage labels |
| `src/domain.js` | Date arithmetic and backup validation |
| `src/server.js` | HTTP API, authentication, storage and payment checks |
| `src/security.js` | Price, purchase and signature checks |
| `public/` | Responsive web interface; no embedded account secrets |
| `supabase/schema.sql` | Database tables, RLS and restricted grants |
| `scripts/build-download.js` | Builds the offline planner outside the public directory |
| `test/` | Meaningful domain, access and billing checks |

## Development and support

See [contributing](CONTRIBUTING.md) and [security](SECURITY.md). Use fictional data in all issues, screenshots, fixtures and pull requests. Never publish passports, visa grants, application references, user backups, account tokens or payment keys.

Code is licensed under [MIT](LICENSE). GOV.UK sources remain subject to their own notices, including Crown copyright and the [Open Government Licence](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). Links and brief summaries do not imply government endorsement.
