# Pilot exit runbook

## Planned exit

1. Announce a final synchronization deadline and require every device to show no queued, uploading, sending, conflict, or failed operations.
2. Disable invitations and new pilot data entry while preserving authorized read access.
3. Export scoped operational reports and capture the filters, denominators, UTC timestamps, local timestamps, and small-sample suppression rules used.
4. Create a database backup and a Storage object inventory with evidence hashes, then perform the restore verification in `backup-restore.md`.
5. Disable notification delivery using `notification-disable.md`.
6. Revoke pilot memberships, inspector engagements, role grants, and trade-company access after the retention owner approves the timing.
7. Record unresolved work, custody of submitted inspections/evidence, export recipients, backup identifiers, and the disposition decision.

## Emergency exit

Suspend affected memberships and notification delivery first. Preserve audit, operation-deduplication, inspection submission, verification, and evidence records. Do not delete the Supabase project until legal/IT retention and incident owners give written approval and the restore drill succeeds.

Production migration is a separate approval. A successful development pilot does not authorize production data, production email, or deletion of retained evidence.
