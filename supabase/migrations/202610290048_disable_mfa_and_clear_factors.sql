-- Temporarily disable MFA (AAL2) enforcement across all roles and clear existing MFA factor records.
-- MFA will be reintroduced in a future phase.

delete from auth.mfa_amr_claims;
delete from auth.mfa_challenges;
update auth.sessions
   set factor_id = null,
       aal = 'aal1'
 where factor_id is not null
    or aal <> 'aal1';
delete from auth.mfa_factors;

create or replace function private.require_aal2()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.uid() is not null
$$;

