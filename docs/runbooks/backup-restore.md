# Backup and restore runbook

## Development backup

- Export schema and data separately with `supabase db dump` using an ephemeral password variable.
- Export a Storage manifest containing bucket, object key, attachment ID, byte size, and SHA-256. Never record signed URLs.
- Store database and object backups under the same dated recovery identifier.

## Restore drill

1. Create an empty isolated Supabase project or local stack.
2. Apply versioned migrations before restoring business data.
3. Restore Auth identities only in a controlled development drill; never reuse production credentials.
4. Restore private Storage objects to their recorded keys.
5. Compare object bytes with attachment SHA-256 values and reconcile missing/orphaned records.
6. Regenerate database types, then run SEC01–SEC10 and direct download authorization tests.
7. Record measured RPO/RTO. The provisional objectives are RPO 24 hours and RTO 8 hours, not guarantees of the micro development tier.

Database-only success is not a complete restore because evidence objects are part of submitted records.
