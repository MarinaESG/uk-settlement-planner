# Contributing

Use Node 22+ and run `npm test` and `npm run build:download` before proposing changes. There are no runtime package dependencies.

Keep fixtures fictional. Do not post personal immigration histories, identity documents, payment keys or exported user workspaces. Discuss a minimal reproducible example instead.

For route changes, cite the official source, its effective date and the exact scope of the implementation. Add boundary tests for calculation changes. Keep user-reported information distinct from reviewed evidence and never convert a successful arithmetic check into an eligibility result.

For account/payment changes, retain server-side access checks, per-user isolation, safe exports after cancellation and a default that cannot take payment without configuration. Record both tests run and tests still requiring real provider accounts.

Keep changes focused. A maintainer must review security, legal-content and billing changes before release.
