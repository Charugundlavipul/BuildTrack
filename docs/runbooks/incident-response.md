# Incident response runbook

## Access or tenant-isolation incident

1. Stop new intake and notification dispatch without deleting evidence.
2. Revoke affected memberships and sessions where supported.
3. Preserve request IDs, operation IDs, audit events, Edge logs, and policy versions; redact tokens and signed URLs.
4. Reproduce the request against an isolated copy and run cross-tenant tests.
5. Notify the accountable security owner before restoring access.

## Offline queue incident

Do not ask the user to clear browser data until queued operations and blobs are inventoried. Export diagnostic metadata without content, preserve the device/user/tenant partition, and use original operation IDs for safe replay.

## Email or worker incident

Disable dispatch, not the outbox producer. Inspect leased, failed, dead, and provider IDs. Resend delivery is at-least-once unless provider idempotency confirms suppression of a retry.

## File-validation incident

Keep files quarantined, revoke fresh downloads, disable finalization, and preserve hashes and provider references. Never move an unscanned object to `ready` to unblock the workflow.
