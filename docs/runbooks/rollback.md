# Pilot rollback and notification-disable runbook

1. Disable new intake with a configuration flag while preserving authorized reads.
2. Disable the database notification schedule and Edge dispatch trigger; leave outbox history intact.
3. Export authorized outstanding work, immutable inspection submissions, and attachment manifests.
4. Reconcile every active assignment with the builder's declared source-of-status process.
5. Suspend pilot memberships and revoke active grants; do not mark work complete automatically.
6. Preserve audit, events, attempts, verification decisions, and evidence under the approved retention policy.
7. Record the rollback reason, owner, timestamps, unresolved work count, and export identifiers.

Never erase the tenant as a shortcut for ending a pilot.
