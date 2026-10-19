# Security

This is pre-launch software and has not received an independent penetration test or production security certification.

Never include secrets or personal records in public issues. Once this repository is published, maintainers should enable GitHub private vulnerability reporting and use that channel for vulnerabilities. If the private report option is unavailable, do not publish exploit details or real data; contact the operator through the verified support channel configured on their deployment.

The default configuration cannot authenticate users or accept payment. Secrets belong only in the host’s secret store or an untracked local `.env`. The static server uses an allowlist; the generated paid download is outside the public directory. Browser data rendering uses text nodes rather than user-controlled HTML.

Tokens are kept in session storage. Supabase validates user identity; the backend scopes database operations to that returned identity. Supabase tables have RLS enabled and no direct browser grants. Stripe state is checked on each protected operation. Webhook delivery does not mutate entitlements.

Production operators remain responsible for secret rotation, platform rate limits, TLS, monitoring, backups, data retention/deletion, dependency/runtime patching and incident handling. In-memory request limits do not provide distributed abuse protection. Review `docs/LAUNCH.md` before enabling accounts or billing.
