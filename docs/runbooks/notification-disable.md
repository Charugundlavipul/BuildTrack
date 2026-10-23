# Notification disable runbook

Use this procedure for unexpected recipients, incorrect content, provider abuse, or an incident involving notification data.

1. Disable the Postgres Cron notification-dispatch job. Leave cleanup jobs running unless the incident commander says otherwise.
2. Remove or rotate `RESEND_API_KEY` in Supabase secrets so no new provider delivery can occur.
3. Stop any external scheduler invoking `dispatch-notifications`.
4. Record the disable time, operator, reason, and affected organization in the incident log.
5. Inspect pending, failed, leased, and dead-letter outbox rows. Do not delete them; set affected pending rows to `cancelled` through an audited administrative procedure.
6. Revalidate recipients and assignment episodes before replaying any row.
7. Restore delivery with one synthetic recipient first, confirm provider idempotency, then re-enable the scheduler.

In-app records may remain visible when email is disabled. If confidentiality is at risk, suspend the affected membership and follow the incident-response runbook.
