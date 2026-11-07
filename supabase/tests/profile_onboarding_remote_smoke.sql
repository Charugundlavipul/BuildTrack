-- No committed data or external email delivery.
begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_user_meta_data,raw_app_meta_data)
values('a2000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','profile-check@example.invalid',now(),now(),now(),'{}','{}'),
('a2000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','unverified-profile-check@example.invalid',null,now(),now(),'{}','{}');
insert into public.platform_administrators(user_id) values('a2000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims','{"sub":"a2000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare org uuid; created jsonb; profile jsonb; blocked boolean; completed timestamptz;
begin
  profile:=public.my_profile();
  if profile->>'completed_at' is not null then raise exception 'profile incorrectly marked complete'; end if;
  created:=public.platform_save_organization(null,'Profile onboarding verification','America/New_York','active','profile-check@example.invalid','org_admin',gen_random_uuid(),null);
  org:=(created->'organization'->>'id')::uuid;
  perform public.platform_prepare_administrator_invitation(org,'0b96b52f53cb2b8f4e836a507792f1906c276465c9229ca4f4873d280d32c2ff',now()+interval '1 day');
  blocked:=false;
  begin perform public.accept_invitation('buildtrack-rollback-verification-token'); exception when invalid_parameter_value then blocked:=true; end;
  if not blocked then raise exception 'invitation accepted before basic details'; end if;
  blocked:=false;
  begin perform public.save_my_profile(' ','Verifier','','','',1); exception when invalid_parameter_value then blocked:=true; end;
  if not blocked then raise exception 'blank first name accepted'; end if;
  profile:=public.save_my_profile('Profile','Verifier','','','America/New_York',1);
  if profile->>'display_name'<>'Profile Verifier' or profile->>'contact_email' is not null or profile->>'phone_number' is not null or profile->>'completed_at' is null then raise exception 'required or optional profile fields failed'; end if;
  completed:=(profile->>'completed_at')::timestamptz;
  perform public.accept_invitation('buildtrack-rollback-verification-token');
  blocked:=false;
  begin perform public.save_my_profile('Profile','Verifier','invalid phone','bad email','',2); exception when invalid_parameter_value then blocked:=true; end;
  if not blocked then raise exception 'invalid contact accepted'; end if;
  profile:=public.save_my_profile('Updated','Name','+1 (919) 555-0100','CONTACT@example.invalid','',2);
  if profile->>'contact_email'<>'contact@example.invalid' or profile->>'account_email'<>'profile-check@example.invalid' or (profile->>'completed_at')::timestamptz<>completed then raise exception 'profile update changed identity or completion'; end if;
  blocked:=false;
  begin perform public.save_my_profile('Stale','Edit','','','',2); exception when serialization_failure then blocked:=true; end;
  if not blocked then raise exception 'stale profile edit accepted'; end if;
  profile:=public.save_my_profile('Updated','Name','','','',3);
  if profile->>'contact_email' is not null or profile->>'phone_number' is not null then raise exception 'optional fields could not be cleared'; end if;
end; $$;
select set_config('request.jwt.claims','{"sub":"a2000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
do $$
declare blocked boolean:=false;
begin
  if public.my_profile()->>'account_email'<>'unverified-profile-check@example.invalid' then raise exception 'profile ownership isolation failed'; end if;
  if exists(select 1 from public.profiles where id='a2000000-0000-4000-8000-000000000001') then raise exception 'another profile exposed'; end if;
  begin perform public.save_my_profile('Unverified','User','','','',1); exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'unverified identity completed profile'; end if;
end; $$;
reset role;
rollback;
select 'profile_onboarding_smoke_passed_and_rolled_back' as result;
