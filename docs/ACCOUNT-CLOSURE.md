# Private preview account closure

This operator procedure covers the free private preview. Owner: Min Gao trading as My Settlement Record. It separates active account deletion from provider logs, support correspondence and copies on users' devices. The existing **Delete saved workspace** button deletes only the saved workspace; it is not a full account closure request.

The utility is a local review candidate, not a completed live deletion service. The owner account and its backups must remain intact. No live account deletion, paid upgrade, expanded invitation list or authentication-setting change is authorised by preparing this procedure. Before using it for a real request, verify it in a separately authorised, non-production Supabase fixture with the deployed schema and access controls.

## Verify and scope the request

1. Record the request, its receipt date, scope and applicable response deadline. Verify identity proportionately through the known account or confirmed email; never request a one-time code or a passport as a default.
2. Confirm the immutable user ID and its current verified email. Offer an export if wanted without making a routine operator copy of the full workspace.
3. Inventory the Auth identity, workspace, customer mapping, any storage objects, support correspondence, operator exports and provider records. The utility checks only Auth, `public.workspaces` and `public.customers`. Record other systems separately, including exceptions and review dates.
4. Check the actual database constraints and grants before relying on cascading deletion. The reviewed schema specifies `ON DELETE CASCADE` for workspace and customer rows and denies direct client table access. A local fixture test does not prove the deployed constraints.

## Block app access before deleting

The server supports an optional `PREVIEW_CLOSED_EMAILS` list. A matching address is blocked even if it remains invited. This closes the app's code-request, code-verification, workspace-read, save and workspace-deletion paths. It preserves the requirement for a non-empty invitation list when the sole invited account is being closed.

Keep this list empty during the current owner-only testing. For an authorised closure, add only the verified account email through the protected hosting configuration. Keep private preview on and both live and sandbox payment flags off. Never place real addresses or keys in source control. Changing this list requires a service restart or deployment because it is read at startup.

Before administrative deletion, verify that the updated configuration is active on every serving instance and that both a code request and a controlled existing-session request are denied. Let in-flight requests finish and confirm the blocked revision is the only serving version. Do not proceed if the service rollout is incomplete. The command's `--access-block-verified` flag records the operator's confirmation; it cannot independently verify the deployed settings.

This is an application access block. It does not change Supabase's project-wide signup settings or guarantee that direct provider calls can never recreate an Auth identity. The app must still deny that identity access, and direct table access must remain denied. Verify those controls before real customer use. Supabase cautions that already issued access tokens can remain valid until expiry; a successful delete response alone is not proof of session revocation.

The closure list is personal data. Retain an address only while needed to enforce the closure and prevent unintended access. Review it at completion and annually. Do not remove a closure block while the same address remains invited. Re-invitation requires a deliberate verified decision. For final closure of the sole account, plan service retirement or a reviewed maintenance state; never weaken the invitation guard to keep the service running. The twelve-month request-ledger period does not automatically control this separate access list.

## Read-only review

Use a trusted terminal with the correct project's credentials supplied through a protected environment. Do not paste keys into commands, chat, reports or this repository. The utility does not load an `.env` file automatically and does not access browser credentials.

Required environment settings are `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (or the legacy `SUPABASE_SERVICE_ROLE_KEY`), `PRIVATE_PREVIEW_ENABLED=true`, `COMMERCE_ENABLED=false` and `STRIPE_SANDBOX_CHECKOUT=false`. For deletion the local `PREVIEW_CLOSED_EMAILS` must also match the verified deployed closure list. The public invitation configuration remains unchanged unless separately authorised.

First view the instructions:

```sh
node scripts/review-account-closure.js --help
```

Then run a read-only review using the verified values, replacing all placeholders:

```sh
node scripts/review-account-closure.js --user-id ACCOUNT_UUID --email VERIFIED_EMAIL --project PROJECT_REF
```

Without `--apply`, only scoped reads are made. Output includes account presence and linked-row counts, not workspace contents, email, keys or tokens. Protect the account ID and project reference in the result as operational information. Credentials are sent only to the exact HTTPS Supabase project origin matching `--project`; redirects are rejected.

## Authorised deletion and verification

Proceed only after the request, identity, scope, deployed access block and provider fixture checks are complete. Confirm the account ID a second time:

```sh
node scripts/review-account-closure.js --user-id ACCOUNT_UUID --email VERIFIED_EMAIL --project PROJECT_REF --apply --confirm-id ACCOUNT_UUID --access-block-verified
```

The utility re-checks the identity and scoped row counts, sends a hard-delete request for that exact Auth ID, then reads all three locations again. It never issues a broad table delete and does not automatically retry failed requests. A subsequent review can identify an interrupted or already completed run without issuing another deletion.

`active_account_records_absent` means the Auth identity, workspace row and customer mapping were all absent at the verification read. It is not proof that every copy everywhere has been erased. If records remain, the response is unreadable or a provider request fails, keep access blocked, record the partial state and investigate; do not confirm completion. Storage ownership or other linked data may require separately scoped actions.

After active deletion, verify old-session access is still rejected and ordinary sign-in cannot recreate an accessible account. Confirm that unrelated fixture users and records remain intact. The utility cannot make these broader acceptance checks for the operator.

## Complete the wider request

Handle the relevant support messages, sent copies, attachments and operator backups under the working retention schedule. Apply targeted actions, not whole-mailbox or project deletion. Record justified exceptions and provider residual retention; do not invent a fixed purge period from a dashboard's visible history. Prevent an operator restore from reintroducing deleted records.

Tell the user that account deletion cannot remotely erase browser drafts, other open tabs, exported JSON, iCloud copies or emailed backups. Explain how to remove unwanted copies and site data on each device. Do not clear recovery data before wanted work is safely retained.

The minimal request ledger contains the request reference, necessary account identifier, scope, dates, checks, result and exception reviews. Keep it for twelve months after closure under the working policy, without workspace content, OTPs or credentials. The completion response must distinguish active records removed, retained exceptions, provider residual periods and unfinished checks.

## Provider references

- [Supabase account management and deletion limits](https://supabase.com/docs/guides/auth/managing-user-data)
- [Supabase administrative user deletion](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser)
- [Supabase deletion request format](https://github.com/supabase/auth-js/blob/master/src/GoTrueAdminApi.ts)
- [ICO right to erasure](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/)

Review provider behaviour and the procedure before wider access, real records, payment activation or a schema/provider change.
