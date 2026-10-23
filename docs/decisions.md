# Development decision register

| ID | Development baseline | Production owner/status |
| --- | --- | --- |
| D01 | One builder organization is the tenant boundary; divisions are reporting only. | Product/IT approval required |
| D02 | Responsive installable PWA with explicit offline home downloads. | Device durability test required |
| D03 | Fixed role templates, multiple scoped grants, and independent verifier permission. | Field-policy approval required |
| D04 | No self-verification or verification by a member of the accountable trade company. | Verifier staffing approval required |
| D05 | Common-area tasks included; buyer portal and warranty cases deferred. | Product approval required |
| D06 | In-app and Resend email; SMS and push deferred. | Sender/domain approval required |
| D07 | Business calendar with one-business-day acknowledgment and verification defaults. | Field leadership approval required |
| D08 | Private evidence, seven-year submitted-record proposal, 30-day abandoned draft proposal, 24-hour local cache. | Legal/IT approval required |
| D09 | External IDs and CSV exports only; no payment execution. | Finance/IT approval required |
| D10 | One-neighborhood pilot with a two-week baseline and four-to-six-week measurement. | Sponsor approval required |
| D11 | Safety flags require on-site verification; readiness remains operational only. | Safety/field approval required |
| D12 | Time-bound inspector engagement; immutable submissions and numbered amendments. | Quality lead approval required |

## Additional technical decisions

- Realtime is omitted initially; polling and reconnect reconciliation trigger authorized refreshes.
- Versioned migrations are authoritative and generated database types are committed after migrations pass.
- Cloudmersive is isolated behind Edge Functions. Only synthetic fixtures may be uploaded until vendor privacy and processing terms are approved.
- The micro Supabase development size is not evidence that pilot performance targets are met.
- Vercel deployment is a development preview with a visible banner and synthetic data only.
