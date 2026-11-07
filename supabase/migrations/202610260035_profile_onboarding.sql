begin;

alter table public.profiles
  add column first_name text not null default '' check(length(first_name)<=80),
  add column last_name text not null default '' check(length(last_name)<=80),
  add column phone_number text check(length(phone_number)<=40),
  add column contact_email text check(length(contact_email)<=254),
  add column completed_at timestamptz,
  add column version bigint not null default 1,
  add constraint profiles_complete_names check(completed_at is null or (length(trim(first_name))>0 and length(trim(last_name))>0));
alter table public.profiles drop constraint profiles_display_name_check;
alter table public.profiles add constraint profiles_display_name_check check(length(display_name) between 1 and 161);

create function public.my_profile() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception using errcode='42501',message='sign in required'; end if;
  return (select coalesce(to_jsonb(p),'{}'::jsonb)||jsonb_build_object('account_email',u.email,'email_verified',u.email_confirmed_at is not null)
    from auth.users u left join public.profiles p on p.id=u.id where u.id=auth.uid());
end; $$;

create function public.save_my_profile(p_first_name text,p_last_name text,p_phone_number text default '',p_contact_email text default '',p_timezone text default '',p_expected_version bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.profiles; first_name text:=trim(coalesce(p_first_name,'')); last_name text:=trim(coalesce(p_last_name,''));
  phone text:=nullif(trim(coalesce(p_phone_number,'')),''); email text:=nullif(lower(trim(coalesce(p_contact_email,''))),''); timezone text:=nullif(trim(coalesce(p_timezone,'')),'');
begin
  if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then
    raise exception using errcode='42501',message='verify your account email before completing your profile';
  end if;
  -- Lock the identity as well as the profile, including users without a profile row yet.
  perform 1 from auth.users where id=auth.uid() for update;
  select * into previous from public.profiles where id=auth.uid() for update;
  if previous.version is distinct from p_expected_version then raise exception using errcode='40001',message='your profile changed; reload before saving'; end if;
  if length(first_name) not between 1 and 80 or length(last_name) not between 1 and 80 then raise exception using errcode='22023',message='first and last names are required, up to 80 characters each'; end if;
  if phone is not null and (phone !~ '^[+0-9() .-]{7,40}$' or length(regexp_replace(phone,'[^0-9]','','g')) not between 7 and 15) then raise exception using errcode='22023',message='enter a valid phone number with 7 to 15 digits, or leave it blank'; end if;
  if email is not null and (length(email)>254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception using errcode='22023',message='enter a valid contact email or leave it blank'; end if;
  if timezone is not null and not exists(select 1 from pg_catalog.pg_timezone_names where name=timezone) then raise exception using errcode='22023',message='choose a valid timezone'; end if;
  insert into public.profiles(id,display_name,first_name,last_name,phone_number,contact_email,timezone,completed_at)
    values(auth.uid(),first_name||' '||last_name,first_name,last_name,phone,email,timezone,now())
  on conflict(id) do update set display_name=excluded.display_name,first_name=excluded.first_name,last_name=excluded.last_name,
    phone_number=excluded.phone_number,contact_email=excluded.contact_email,timezone=excluded.timezone,
    completed_at=coalesce(public.profiles.completed_at,now()),version=public.profiles.version+1,updated_at=now();
  return public.my_profile();
end; $$;

revoke all on function public.my_profile(),public.save_my_profile(text,text,text,text,text,bigint) from public,anon;
grant execute on function public.my_profile(),public.save_my_profile(text,text,text,text,text,bigint) to authenticated;

-- A verified identity must supply its own basic details before accepting tenant access.
do $migration$
declare definition text; needle text:='insert into public.organization_memberships(organization_id, user_id, affiliation, status, joined_at)';
begin
  definition:=pg_get_functiondef('public.accept_invitation(text)'::regprocedure);
  if strpos(definition,needle)=0 then raise exception 'accept_invitation changed; profile guard requires review'; end if;
  definition:=replace(definition,needle,$patch$
  if not exists(select 1 from public.profiles where id=auth.uid() and completed_at is not null and length(trim(first_name))>0 and length(trim(last_name))>0) then
    raise exception using errcode='22023',message='complete your first and last name before accepting this invitation';
  end if;
  insert into public.organization_memberships(organization_id, user_id, affiliation, status, joined_at)
  $patch$);
  execute definition;
end;
$migration$;

commit;
