begin;

-- Required application metadata, not tenant fixture data.
insert into public.permissions(code, description) values
  ('structure.manage','Manage divisions, neighborhoods, homes, locations, and milestones'),
  ('access.manage','Manage memberships, invitations, and scoped role grants'),
  ('roster.manage','Manage companies, specialties, and neighborhood rosters'),
  ('work.read_scope','Read authorized work within a granted scope'),
  ('work.create','Create field work and inspection findings'),
  ('work.triage','Classify, duplicate, and cancel work'),
  ('work.assign','Assign and reassign accountable parties and due dates'),
  ('work.execute_assigned','Act on work for which the user or company is accountable'),
  ('work.verify','Independently verify correction attempts'),
  ('inspection.manage','Schedule and administer inspections'),
  ('inspection.perform','Capture authorized inspection responses'),
  ('comment.internal','Read and create internal-only comments'),
  ('report.read_scope','Read scoped metrics and request exports'),
  ('audit.read_scope','Read scoped audit history'),
  ('config.manage','Manage calendars, notification rules, and checklist publication'),
  ('milestone.approve','Record operational milestone approval')
on conflict (code) do update set description = excluded.description;

insert into public.roles(code, label, allowed_scope_kinds, immutable_seed) values
  ('org_admin','Organization administrator','{organization}',true),
  ('area_manager','Area construction manager','{neighborhood,home}',true),
  ('superintendent','Superintendent','{neighborhood,home}',true),
  ('assistant_superintendent','Assistant superintendent','{neighborhood,home}',true),
  ('internal_quality','Internal quality inspector','{neighborhood,home}',true),
  ('external_inspector','External inspector','{neighborhood,home}',true),
  ('verifier','Independent verifier','{neighborhood,home}',true),
  ('trade_manager','Trade company manager','{neighborhood}',true),
  ('trade_technician','Trade technician','{neighborhood}',true),
  ('operations_coordinator','Operations coordinator','{neighborhood,home}',true),
  ('internal_contributor','Internal field contributor','{neighborhood,home}',true),
  ('leadership_viewer','Leadership viewer','{organization,neighborhood,home}',true),
  ('auditor','Auditor','{organization,neighborhood,home}',true)
on conflict (code) do update
set label = excluded.label,
    allowed_scope_kinds = excluded.allowed_scope_kinds,
    immutable_seed = true;

insert into public.role_permissions(role_code, permission_code) values
  ('org_admin','structure.manage'),('org_admin','access.manage'),('org_admin','roster.manage'),('org_admin','config.manage'),('org_admin','audit.read_scope'),
  ('area_manager','work.read_scope'),('area_manager','work.create'),('area_manager','work.triage'),('area_manager','work.assign'),('area_manager','work.verify'),('area_manager','inspection.manage'),('area_manager','comment.internal'),('area_manager','report.read_scope'),('area_manager','audit.read_scope'),('area_manager','milestone.approve'),
  ('superintendent','work.read_scope'),('superintendent','work.create'),('superintendent','work.triage'),('superintendent','work.assign'),('superintendent','work.execute_assigned'),('superintendent','work.verify'),('superintendent','inspection.manage'),('superintendent','comment.internal'),('superintendent','report.read_scope'),('superintendent','milestone.approve'),
  ('assistant_superintendent','work.read_scope'),('assistant_superintendent','work.create'),('assistant_superintendent','work.triage'),('assistant_superintendent','work.assign'),('assistant_superintendent','work.execute_assigned'),('assistant_superintendent','inspection.manage'),('assistant_superintendent','comment.internal'),
  ('internal_quality','work.read_scope'),('internal_quality','work.create'),('internal_quality','inspection.perform'),('internal_quality','comment.internal'),
  ('external_inspector','work.create'),('external_inspector','inspection.perform'),
  ('verifier','work.read_scope'),('verifier','work.verify'),
  ('trade_manager','work.execute_assigned'),
  ('trade_technician','work.execute_assigned'),
  ('operations_coordinator','work.read_scope'),('operations_coordinator','work.create'),('operations_coordinator','work.triage'),('operations_coordinator','work.assign'),('operations_coordinator','inspection.manage'),('operations_coordinator','comment.internal'),
  ('internal_contributor','work.read_scope'),('internal_contributor','work.create'),('internal_contributor','work.execute_assigned'),('internal_contributor','comment.internal'),
  ('leadership_viewer','work.read_scope'),('leadership_viewer','report.read_scope'),
  ('auditor','work.read_scope'),('auditor','report.read_scope'),('auditor','audit.read_scope')
on conflict do nothing;

commit;
