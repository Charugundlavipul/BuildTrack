begin;

insert into public.master_catalog_entries(kind,code,label,sort_order) values
  ('company_category','general_contractor','General contractor',100),
  ('company_category','excavation_grading','Excavation & grading',110),
  ('company_category','site_utilities','Site utilities',120),
  ('company_category','concrete_masonry','Concrete & masonry',130),
  ('company_category','structural_steel','Structural steel',140),
  ('company_category','carpentry','Carpentry',150),
  ('company_category','cabinetry_millwork','Cabinetry & millwork',160),
  ('company_category','gutters','Gutters & drainage',170),
  ('company_category','waterproofing','Waterproofing',180),
  ('company_category','insulation','Insulation',190),
  ('company_category','painting_coatings','Painting & coatings',200),
  ('company_category','flooring_tile','Flooring & tile',210),
  ('company_category','countertops','Countertops',220),
  ('company_category','doors_windows','Doors & windows',230),
  ('company_category','garage_doors','Garage doors',240),
  ('company_category','fire_protection','Fire protection',250),
  ('company_category','low_voltage_security','Low voltage & security',260),
  ('company_category','solar_energy','Solar energy',270),
  ('company_category','elevators_lifts','Elevators & lifts',280),
  ('company_category','appliances','Appliances',290),
  ('company_category','fencing','Fencing',300),
  ('company_category','pools_spas','Pools & spas',310),
  ('company_category','pest_control','Pest control',320),
  ('company_category','final_cleaning','Final cleaning',330),
  ('company_category','waste_management','Waste management',340),
  ('company_category','engineering_testing','Engineering & testing',350)
on conflict(kind,code) do nothing;

-- Validate against the master catalog so platform-added categories and future
-- catalog expansion do not require another company-profile function rewrite.
create or replace function public.save_company_profile(p_org uuid,p_company uuid,p_email text,p_phone text,p_address text,p_ein text,p_categories text[],p_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.companies; ein_editor boolean; normalized_categories text[];
begin
  select * into c from public.companies where organization_id=p_org and id=p_company for update;
  if not found or not private.require_aal2() or not private.can_edit_company_profile(p_org,auth.uid(),p_company) then raise insufficient_privilege using message='Contact and service management is unavailable for this company.'; end if;
  if c.version<>p_version then raise serialization_failure using message='Company changed. Refresh before saving.'; end if;
  if nullif(trim(p_email),'') is not null and p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise check_violation using message='Enter a valid contact email.'; end if;
  normalized_categories:=array(select distinct category from unnest(coalesce(p_categories,'{}')) category where nullif(trim(category),'') is not null order by category);
  if exists(select 1 from unnest(normalized_categories) category where not exists(
      select 1 from public.master_catalog_entries entry where entry.kind='company_category' and entry.code=category and (entry.active or category=any(c.categories))))
    or length(coalesce(p_phone,''))>40 or length(coalesce(p_address,''))>1000 then
    raise check_violation using message='Invalid company contact details or categories.';
  end if;
  update public.companies set contact_email=nullif(trim(p_email),''),phone_number=nullif(trim(p_phone),''),physical_address=nullif(trim(p_address),''),categories=normalized_categories,updated_at=now(),version=version+1 where id=p_company returning * into c;
  ein_editor:=coalesce(private.admin_level(p_org,auth.uid(),'organization')=1,false) or private.vendor_admin(p_org,auth.uid(),p_company);
  if ein_editor then
    if nullif(trim(p_ein),'') is not null and p_ein !~ '^[0-9]{2}-?[0-9]{7}$' then raise check_violation using message='EIN must contain nine digits.'; end if;
    insert into public.company_private_details(organization_id,company_id,ein) values(p_org,p_company,nullif(trim(p_ein),'')) on conflict(company_id) do update set ein=excluded.ein;
  end if;
  perform private.append_audit(p_org,auth.uid(),'company.profile_updated','company',p_company,null,null,null,jsonb_build_object('categories',normalized_categories));
  return to_jsonb(c);
end; $$;

notify pgrst, 'reload schema';

commit;
