// Runs real Auth, PostgREST, and Edge Function requests in one isolated tenant.
// No invitation emails are sent. Temporary accounts and tenant data are removed
// in finally; external provider checks are reported separately.
import { createClient } from '@supabase/supabase-js'
import { createHmac, randomBytes, randomUUID, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const root = process.cwd()
const cli = resolve('node_modules/@supabase/cli-windows-x64/bin/supabase.exe')
const directory = resolve('artifacts/live-quality')
mkdirSync(directory, { recursive: true })
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((s) => /^[A-Z_]+=/.test(s)).map((line) => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).replace(/^['"]|['"]$/g, '')] }))
const org = 'e2000000-0000-4000-8000-000000000041'
const userId = (i) => `e1000000-0000-4000-8000-${String(i).padStart(12, '0')}`
const runId = randomBytes(5).toString('hex')
const password = randomBytes(24).toString('base64url')
const email = (i) => `quality-live-${runId}-${i}@example.invalid`
const report = { checks: [], unverifiedExternalIntegrations: ['Invitation email delivery is not exercised; provide Resend credentials and an approved test recipient.', 'Photo content finalization is not exercised; configure the scanning provider before testing actual uploads.'], cleanup: false }
const clients = []
let setupCreated = false
function sql(name, source) {
  const path = resolve(directory, `${name}.sql`)
  writeFileSync(path, source)
  try { return JSON.parse(execFileSync(cli, ['db', 'query', '--linked', '--file', path, '--output', 'json'], { cwd: root, encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] })) }
  catch (error) { throw new Error(`${name}: ${String(error.stdout || error.stderr || error.message).slice(0, 2000)}`) }
}
async function rpc(client, name, args) { const { data, error } = await client.rpc(name, args); if (error) throw new Error(`${name}: ${error.message}`); return data }
async function command(client, name, payload, version) {
  const envelope = { operation_id: randomUUID(), captured_at: new Date().toISOString(), expected_version: version, payload: { organization_id: org, ...payload } }
  const { data, error } = await client.functions.invoke('command', { body: { command_name: name, envelope } })
  if (error || !data?.ok) { const detail = error?.context instanceof Response ? await error.context.clone().text() : error?.message; throw new Error(`${name}: ${JSON.stringify(data?.error ?? detail)}`) }
  return data.data
}
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = [...secret.replace(/=+$/, '').toUpperCase()].map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('')
  const key = Buffer.from(bits.match(/.{8}/g).map((byte) => Number.parseInt(byte, 2)))
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const mac = createHmac('sha1', key).update(counter).digest(); const offset = mac[19] & 15
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0')
}
async function signIn(i, mfa = false) {
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  clients.push(client)
  const login = await client.auth.signInWithPassword({ email: email(i), password })
  if (login.error) throw new Error(`Sign in ${i}: ${login.error.message}`)
  if (mfa) {
    const enrolled = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Temporary lifecycle test' })
    if (enrolled.error) throw enrolled.error
    const verified = await client.auth.mfa.challengeAndVerify({ factorId: enrolled.data.id, code: totp(enrolled.data.totp.secret) })
    if (verified.error) throw verified.error
  }
  return client
}
async function row(client, table, id) { const { data, error } = await client.from(table).select('*').eq('organization_id', org).eq('id', id).single(); if (error) throw new Error(`${table}: ${error.message}`); return data }
function check(label) { report.checks.push(label); console.log(`PASS ${label}`) }
async function invite(actor, i, grants, company = null, kind = null) {
  const token = randomBytes(24).toString('base64url')
  await rpc(actor, 'admin_create_invitation', { p_organization_id: org, p_email: email(i), p_affiliation: company ? 'external' : 'internal', p_grants: grants, p_company_id: company, p_company_kind: kind, p_token_hash: createHash('sha256').update(token).digest('hex'), p_expires_at: new Date(Date.now() + 86400000).toISOString() })
  const client = await signIn(i, [3, 4, 6].includes(i))
  await rpc(client, 'accept_invitation', { p_plaintext_token: token })
  const profile = await rpc(client, 'my_profile')
  await rpc(client, 'save_my_profile', { p_first_name: 'Quality', p_last_name: `User ${i}`, p_phone_number: '', p_contact_email: '', p_timezone: 'America/New_York', p_expected_version: profile.version })
  return client
}
const cleanup = `begin;
do $$ begin
  if exists(select 1 from public.organizations where id='${org}' and name<>'Temporary live quality validation') then raise exception 'Refusing cleanup outside the test tenant'; end if;
end $$;
-- Only this privileged cleanup transaction bypasses immutable-history triggers.
-- Every deletion remains confined to the isolated test tenant and its UUIDs.
set local session_replication_role='replica';
delete from public.notification_outbox where organization_id='${org}';
delete from public.notifications where organization_id='${org}';
delete from public.attachments where organization_id='${org}';
delete from public.inspection_responses where organization_id='${org}';
delete from public.inspection_submissions where organization_id='${org}';
delete from public.inspection_participants where organization_id='${org}';
delete from public.comments where organization_id='${org}';
delete from public.work_events where organization_id='${org}';
delete from public.verifications where organization_id='${org}';
update public.evidence_exceptions set consumed_by_attempt_id=null where organization_id='${org}';
delete from public.correction_attempts where organization_id='${org}';
delete from public.evidence_exceptions where organization_id='${org}';
delete from public.blocker_events where organization_id='${org}';
update public.work_items set current_assignment_id=null,duplicate_of_id=null where organization_id='${org}';
delete from public.assignment_episodes where organization_id='${org}';
delete from public.work_items where organization_id='${org}';
delete from public.inspections where organization_id='${org}';
delete from public.checklist_questions where organization_id='${org}';
delete from public.checklist_versions where organization_id='${org}';
delete from public.checklist_templates where organization_id='${org}';
delete from public.home_locations where organization_id='${org}';
delete from public.homes where organization_id='${org}';
delete from public.master_plans where organization_id='${org}';
delete from public.role_assignments where organization_id='${org}';
delete from public.company_memberships where organization_id='${org}';
delete from public.company_access_grants where organization_id='${org}';
delete from public.company_private_details where organization_id='${org}';
delete from public.neighborhood_trade_rosters where organization_id='${org}';
delete from public.neighborhoods where organization_id='${org}';
delete from public.divisions where organization_id='${org}';
delete from public.invites where organization_id='${org}';
delete from public.organization_roles where organization_id='${org}';
delete from public.organization_memberships where organization_id='${org}';
delete from public.audit_events where organization_id='${org}';
delete from private.client_operations where organization_id='${org}';
delete from public.organizations where id='${org}' and name='Temporary live quality validation';
delete from auth.mfa_challenges where factor_id in (select id from auth.mfa_factors where user_id in (${Array.from({ length: 8 }, (_, i) => `'${userId(i + 1)}'`).join(',')}));
delete from auth.mfa_amr_claims where session_id in (select id from auth.sessions where user_id in (${Array.from({ length: 8 }, (_, i) => `'${userId(i + 1)}'`).join(',')}));
delete from auth.refresh_tokens where user_id in (${Array.from({ length: 8 }, (_, i) => `'${userId(i + 1)}'`).join(',')});
delete from auth.identities where user_id in (${Array.from({ length: 8 }, (_, i) => `'${userId(i + 1)}'`).join(',')});
delete from auth.sessions where user_id in (${Array.from({ length: 8 }, (_, i) => `'${userId(i + 1)}'`).join(',')});
delete from auth.mfa_factors where user_id in (${Array.from({ length: 8 }, (_, i) => `'${userId(i + 1)}'`).join(',')});
delete from public.profiles where id in (${Array.from({ length: 8 }, (_, i) => `'${userId(i + 1)}'`).join(',')});
delete from auth.users where id in (${Array.from({ length: 8 }, (_, i) => `'${userId(i + 1)}'`).join(',')}) and email like 'quality-live-%@example.invalid';
set local session_replication_role='origin';
commit; select 'temporary quality tenant removed' result;`
writeFileSync(resolve(directory, 'cleanup.sql'), cleanup)

try {
  sql('setup', `begin;
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin,confirmation_token,email_change,email_change_token_new,recovery_token)
      values ${Array.from({ length: 8 }, (_, n) => `('00000000-0000-0000-0000-000000000000','${userId(n + 1)}','authenticated','authenticated','${email(n + 1)}',extensions.crypt('${password}',extensions.gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false,'','','','')`).join(',')};
    insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at) select id,id,id::text,jsonb_build_object('sub',id::text,'email',email),'email',now(),now() from auth.users where id in (${Array.from({ length: 8 }, (_, n) => `'${userId(n + 1)}'`).join(',')});
    insert into public.profiles(id,display_name,first_name,last_name,completed_at) select id,'Quality test','Quality','Test',now() from auth.users where id in (${Array.from({ length: 8 }, (_, n) => `'${userId(n + 1)}'`).join(',')}) on conflict(id) do update set first_name='Quality',last_name='Test',completed_at=now();
    insert into public.organizations(id,name,timezone) values('${org}','Temporary live quality validation','America/New_York');
    insert into public.organization_memberships(organization_id,user_id,affiliation,status,joined_at) values('${org}','${userId(1)}','internal','active',now());
    insert into public.role_assignments(organization_id,user_id,role_code,scope_kind,granted_by) values('${org}','${userId(1)}','org_admin','organization','${userId(1)}');
    commit; select 'isolated live tenant created' result;`)
  setupCreated = true
  const admin = await signIn(1, true)
  check('Real Supabase sign-in and administrator MFA')
  const division = await rpc(admin, 'admin_save_division', { p_organization_id: org, p_id: null, p_name: 'Test division', p_status: 'active' })
  const divisionAdmin = await invite(admin, 3, [{ role_code: 'division_admin', scope_kind: 'division', division_id: division.id }])
  const neighborhood = await rpc(divisionAdmin, 'admin_save_neighborhood', { p_organization_id: org, p_id: null, p_division_id: division.id, p_code: 'LIVE-QA', p_name: 'Quality neighborhood', p_timezone: 'America/New_York', p_status: 'active', p_supervisor_user_id: null })
  const area = await invite(divisionAdmin, 4, [{ role_code: 'neighborhood_admin', scope_kind: 'neighborhood', neighborhood_id: neighborhood.id }])
  const plan = await rpc(divisionAdmin, 'save_master_plan', { p_org: org, p_id: null, p_division: division.id, p_name: 'Live Monterey', p_spaces: [{ type: 'kitchen', name: 'Kitchen' }, { type: 'patio', name: 'Covered patio' }], p_active: true })
  const home = await rpc(area, 'onboard_home_with_plan', { p_org: org, p_details: { neighborhood_id: neighborhood.id, lot_code: '41', phase: 'framing' }, p_plan: plan.id })
  const spaces = await area.from('home_locations').select('*').eq('home_id', home.id)
  assert.equal(spaces.data.length, 2)
  check('Divisional plan ownership and neighborhood lot onboarding')
  const supervisor = await invite(area, 2, [{ role_code: 'superintendent', scope_kind: 'neighborhood', neighborhood_id: neighborhood.id }])
  const internal = await invite(area, 5, [{ role_code: 'internal_contributor', scope_kind: 'neighborhood', neighborhood_id: neighborhood.id }, { role_code: 'inspector', scope_kind: 'neighborhood', neighborhood_id: neighborhood.id }])
  const company = await rpc(area, 'onboard_vendor_with_profile', { p_org: org, p_name: 'Live QA company', p_reference: 'LIVE-QA', p_scope: 'neighborhood', p_division: null, p_neighborhood: neighborhood.id, p_profile: { email: 'company@example.invalid', phone: '555-0100', address: 'Quality test address', ein: '12-3456789', categories: ['third_party_inspection', 'plumbing'] } })
  const manager = await invite(area, 6, [{ role_code: 'vendor_admin', scope_kind: 'company', company_id: company.id }], company.id, 'manager')
  const tradesman = await invite(manager, 7, [{ role_code: 'trade_technician', scope_kind: 'company', company_id: company.id }], company.id, 'technician')
  const inspector = await invite(manager, 8, [{ role_code: 'inspector', scope_kind: 'company', company_id: company.id }], company.id, 'technician')
  check('Scoped invitations, profile completion, and vendor-owned personnel')
  await rpc(area, 'admin_save_roster', { p_organization_id: org, p_id: null, p_neighborhood_id: neighborhood.id, p_company_id: company.id, p_status: 'active', p_active_from: new Date(Date.now() - 60000).toISOString(), p_active_to: null })
  // Publish a checklist through the existing configuration APIs, using a fixture
  // insert only for the immutable test version; no live catalog is changed.
  const template = randomUUID(); const version = randomUUID(); const question = randomUUID()
  sql('checklist', `begin; insert into public.checklist_templates(id,organization_id,name) values('${template}','${org}','Live quality checklist'); insert into public.checklist_versions(id,organization_id,template_id,number,published_at,created_by) values('${version}','${org}','${template}',1,now(),'${userId(1)}'); insert into public.checklist_questions(id,organization_id,version_id,ordinal,section,label,requires_response) values('${question}','${org}','${version}',1,'Kitchen','Cabinet condition',true); commit; select 'test checklist published' result;`)
  let inspection = await command(supervisor, 'schedule_company_inspection', { home_id: home.id, company_id: company.id, type: 'external_quality', template_version_id: version })
  const unseen = await inspector.from('inspections').select('id').eq('id', inspection.id)
  assert.equal(unseen.data.length, 0)
  inspection = await command(manager, 'allocate_inspection', { inspection_id: inspection.id, inspector_user_id: userId(8), reason: 'Daily dispatch' }, inspection.version)
  check('Supervisor company assignment, isolated company inbox, and manager allocation')
  let observation = await command(inspector, 'create_work_item', { home_id: home.id, neighborhood_id: neighborhood.id, inspection_id: inspection.id, location_id: spaces.data[0].id, origin: 'external_inspection', title: 'Repair kitchen panel', description: 'Panel needs replacement.' })
  inspection = await command(inspector, 'upsert_inspection_response', { inspection_id: inspection.id, question_id: question, response: 'fail', reason: 'Panel damaged', finding_id: observation.id }, inspection.version)
  inspection = await command(inspector, 'submit_inspection', { inspection_id: inspection.id }, inspection.version)
  observation = await row(supervisor, 'work_items', observation.id)
  await command(supervisor, 'bulk_review_observations', { action: 'assign', rows: [{ item_id: observation.id, expected_version: observation.version }], company_id: company.id, due_at: new Date(Date.now() + 86400000).toISOString(), reason: 'Repair panel' })
  check('Room observation, checklist, report submission, and bulk vendor assignment')
  observation = await row(manager, 'work_items', observation.id)
  await command(manager, 'delegate_company_work', { item_id: observation.id, technician_id: userId(7) }, observation.version)
  for (const name of ['acknowledge_work', 'start_work']) { observation = await row(tradesman, 'work_items', observation.id); await command(tradesman, name, { item_id: observation.id }, observation.version) }
  observation = await row(supervisor, 'work_items', observation.id)
  await command(supervisor, 'issue_evidence_exception', { item_id: observation.id, reason: 'Live test: external scanner is not configured; supervisor exception is recorded.' }, observation.version)
  observation = await row(tradesman, 'work_items', observation.id)
  const exceptions = await tradesman.from('evidence_exceptions').select('id').eq('work_item_id', observation.id)
  assert.equal(exceptions.error, null)
  await command(tradesman, 'submit_correction', { item_id: observation.id, note: 'Panel replaced; supervisor will arrange on-site review.', attachment_ids: [], evidence_exception_id: exceptions.data.at(-1).id }, observation.version)
  observation = await row(supervisor, 'work_items', observation.id)
  await command(supervisor, 'bulk_review_observations', { action: 'reinspect', rows: [{ item_id: observation.id, expected_version: observation.version }], inspector_user_id: userId(5), reason: 'Independent site review' })
  observation = await row(internal, 'work_items', observation.id)
  assert.equal(observation.reinspection_status, 'pending')
  await command(internal, 'decide_reinspection', { item_id: observation.id, decision: 'accepted', notes: 'Verified repair on site.' }, observation.version)
  assert.equal((await row(supervisor, 'work_items', observation.id)).state, 'verified')
  check('Company repair dispatch, repair submission, independent reinspection, and original-thread closure')
  inspection = await row(supervisor, 'inspections', inspection.id)
  inspection = await command(supervisor, 'review_inspection', { inspection_id: inspection.id, action: 'escalate', reason: 'Area manager confirms buyer finish requirement.' }, inspection.version)
  inspection = await command(area, 'review_inspection', { inspection_id: inspection.id, action: 'resolve' }, inspection.version)
  await command(supervisor, 'review_inspection', { inspection_id: inspection.id, action: 'complete' }, inspection.version)
  check('Escalation to area manager, resolution, and report completion')
  if (process.argv.includes('--browser')) {
    const { chromium } = await import('@playwright/test')
    const browser = await chromium.launch({ channel: 'chrome' })
    try {
      for (const [label, client, path] of [['supervisor', supervisor, `inspections/${inspection.id}`], ['company-manager', manager, 'inspections'], ['inspector', internal, 'inspections']]) {
        const context = await browser.newContext({ viewport: { width: label === 'inspector' ? 390 : 1440, height: 960 } })
        const session = (await client.auth.getSession()).data.session
        await context.addInitScript(({ session, org }) => { localStorage.setItem('buildtrack.auth', JSON.stringify(session)); localStorage.setItem('buildtrack.activeOrganization', org) }, { session, org })
        const page = await context.newPage(); const errors = []; page.on('pageerror', (error) => errors.push(error.message))
        await page.goto(`http://localhost:5173/org/${org}/${path}`)
        await page.getByRole('heading', { level: 1 }).waitFor()
        if (label === 'inspector') { await page.getByRole('button', { name: 'Re-inspections', exact: true }).click(); await page.getByRole('checkbox', { name: 'Show completed' }).check(); await page.getByText('Lot 41 · 1 item checked', { exact: true }).waitFor() }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        assert.deepEqual(errors, [])
        await page.screenshot({ path: resolve(directory, `${label}.png`), fullPage: true }); await context.close()
      }
      check('Live authenticated supervisor, company manager, and mobile Inspector pages')
    } finally { await browser.close() }
  }
} catch (error) { report.error = error.message; console.error(`FAIL ${error.message}`); process.exitCode = 1 }
finally {
  for (const client of clients) await client.auth.signOut().catch(() => {})
  try { if (setupCreated) sql('cleanup', cleanup); report.cleanup = true; console.log('PASS Temporary test tenant and accounts removed') }
  catch (error) { report.cleanupError = error.message; console.error(`CLEANUP REQUIRED: ${error.message}`); process.exitCode = 1 }
  if (report.cleanup && existsSync(resolve(directory, 'setup.sql'))) unlinkSync(resolve(directory, 'setup.sql'))
  writeFileSync(resolve(directory, 'report.json'), JSON.stringify(report, null, 2))
}
