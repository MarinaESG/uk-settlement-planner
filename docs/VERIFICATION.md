# Initial verification record

Date: 19 October 2026. Version: 0.1.0. Environment: local macOS, Node.js and Safari.

## Completed

- **20 automated tests passed.** These exercise whole-day arithmetic, leap dates, April 2024 transition, review-period clipping, overlap handling, incomplete/invalid backups, exact advertised prices, subscription status, purchase ownership, refund denial, forged/stale webhook signatures, user-scoped database requests, unauthenticated denial, static-file isolation, export/delete after cancellation and the offline build.
- Payment/database integration tests used explicitly fictional provider responses. They also covered empty successful database responses, which had caused an error and were corrected.
- The local website loaded in Safari. The fictional trip initially showed 15 whole days. Changing its arrival day increased both the trip count and aggregate to 16.
- The completeness checkbox updated the outstanding-review list while evidence reconciliation remained outstanding.
- Permission and evidence-review tabs displayed their respective fields.
- The standalone website preview opened directly from disk in Safari. Searching for Global Talent returned the matching entry; selecting it removed the long-residence indicators and displayed the evidence-only coverage statement.
- The standalone offline planner build contains no external script or stylesheet imports; its combined JavaScript compiled successfully.

## Not yet verified

- Live Supabase email delivery, production account lifecycle and deployed database grants.
- Actual Stripe test-mode or live checkout, receipts, renewals, cancellation, refunds and disputes.
- Production hosting, TLS, rate limiting, operational monitoring, recovery and backups.
- Full keyboard/screen-reader accessibility, mobile-device testing and cross-browser file-storage behaviour.
- Independent security testing, qualified legal review or consumer/data-protection approval.
- Exhaustive coverage of every ILR provision or any automatic eligibility assessment.

These limits remain release conditions for an operated paid service. The GitHub repository and local preview are a pre-launch software release.
