import { expect, test } from '@playwright/test'
import { mockWorkspace, neighborhood, org, userId } from './fixtures/workspace'

const divisionA = { id: 'division-1', organization_id: org, name: 'North Division', status: 'active' }
const divisionB = { id: 'division-2', organization_id: org, name: 'South Division', status: 'active' }
const otherArea = { ...neighborhood, id: 'community-2', division_id: divisionB.id, name: 'South Grove' }
const company = { id: 'company-1', organization_id: org, name: 'Cedar Finish Carpentry', status: 'active', owner_scope_kind: 'neighborhood', owner_neighborhood_id: neighborhood.id, version: 1 }
const base = `/org/${org}`

test('division admins invite only inside their divisions', async ({ page }, testInfo) => {
  await mockWorkspace(page, { permissions: ['access.manage', 'structure.manage', 'roster.manage'], tables: {
    divisions: [divisionA, divisionB], neighborhoods: [neighborhood, otherArea],
    administration_context: { organization_admin: false, grants: [{ scope_kind: 'division', division_id: divisionA.id }], companies: [company] }
  } })
  await page.goto(`${base}/admin?invite=1`)
  const form = page.getByRole('form', { name: 'Invite team member' })
  const roles = form.getByRole('combobox', { name: 'Role', exact: true })
  await expect(roles.getByRole('option', { name: 'Org Admin', exact: true })).toHaveCount(0)
  await roles.selectOption('division_admin')
  const division = form.getByRole('combobox', { name: 'Division', exact: true })
  await expect(division.getByRole('option', { name: divisionB.name })).toHaveCount(0)
  await division.selectOption(divisionA.id)
  await expect(form.getByRole('combobox', { name: 'Neighborhood', exact: true })).toHaveCount(0)
  let body: Record<string, unknown> = {}
  await page.route('**/functions/v1/invite-user', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: { invitation_id: 'invite-1', expires_at: '2026-11-01T12:00:00Z' } }) })
  await form.getByRole('textbox', { name: 'Email address' }).fill('division-admin@example.test')
  await form.getByRole('button', { name: 'Send invitation' }).click()
  await expect(form.getByRole('status')).toContainText('Invitation sent')
  expect(body.grants).toEqual([expect.objectContaining({ role_code: 'division_admin', scope_kind: 'division', division_id: divisionA.id, neighborhood_id: null, home_id: null, company_id: null })])
  await roles.selectOption('neighborhood_admin')
  await expect(form.getByRole('combobox', { name: 'Neighborhood', exact: true }).getByRole('option', { name: otherArea.name })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('division-invitation.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('local editors lock parent grants and remove only local access', async ({ page }, testInfo) => {
  const target = { user_id: 'target-user', display_name: 'Jordan Lee', email: 'jordan@example.test', affiliation: 'internal', status: 'active', can_suspend: false, can_remove_access: true, companies: [], roles: [
    { id: 'parent-role', role_code: 'leadership_viewer', role_label: 'Viewer', scope_kind: 'organization', neighborhood_id: null, home_id: null, division_id: null, company_id: null, can_edit: false, starts_at: '2026-10-01T00:00:00Z', ends_at: null },
    { id: 'local-role', role_code: 'internal_contributor', scope_kind: 'neighborhood', neighborhood_id: neighborhood.id, home_id: null, division_id: null, company_id: null, can_edit: true }
  ] }
  await mockWorkspace(page, { permissions: ['access.manage'], tables: {
    administration_context: { organization_admin: false, grants: [{ scope_kind: 'neighborhood', neighborhood_id: neighborhood.id }], companies: [] }, admin_list_members: [target]
  } })
  await page.goto(`${base}/admin`)
  await expect(page.getByRole('button', { name: 'Suspend', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Remove local access', exact: true })).toBeVisible({ timeout: 15000 })
  await page.getByRole('button', { name: 'Edit roles & scope' }).click()
  const form = page.getByRole('form', { name: 'Manage Jordan Lee' })
  await expect(form.getByText('Protected access — granted by a higher administrator.')).toBeVisible()
  await expect(form.getByRole('combobox', { name: 'Role', exact: true }).first()).toBeDisabled()
  await form.getByRole('button', { name: 'Remove role', exact: true }).last().click()
  let body: Record<string, unknown> = {}
  await page.route('**/rest/v1/rpc/admin_set_member_access', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: { updated: true } }) })
  await page.screenshot({ path: testInfo.outputPath('protected-role-editor.png'), fullPage: true })
  await form.getByRole('button', { name: 'Save roles & scope' }).click()
  await expect(page.getByRole('status')).toContainText("Jordan Lee's access was updated")
  expect(body.p_assignments).toEqual([expect.objectContaining({ id: 'parent-role', scope_kind: 'organization', role_code: 'leadership_viewer' })])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('a higher admin expands one vendor into another division', async ({ page }, testInfo) => {
  await mockWorkspace(page, { tables: { divisions: [divisionA, divisionB], companies: [company], attachments: [] } })
  let body: Record<string, unknown> = {}
  await page.route('**/rest/v1/rpc/admin_set_vendor_coverage', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: { id: 'new-coverage' } }) })
  await page.goto(`${base}/vendors/${company.id}`)
  await page.getByRole('button', { name: 'Add coverage', exact: true }).click()
  await page.getByRole('combobox', { name: 'Coverage level', exact: true }).selectOption('division')
  await page.getByRole('combobox', { name: 'Division', exact: true }).selectOption(divisionB.id)
  await page.getByRole('button', { name: 'Save coverage', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Add a location', exact: true })).toHaveCount(0)
  expect(body).toMatchObject({ p_company_id: company.id, p_scope: 'division', p_division_id: divisionB.id, p_neighborhood_id: null, p_active: true })
  await page.screenshot({ path: testInfo.outputPath('vendor-coverage.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('vendor admins invite their own company team without location or builder roles', async ({ page }, testInfo) => {
  await mockWorkspace(page, { permissions: ['company.users.manage', 'work.execute_assigned', 'evidence.upload', 'comment.create_shared'], tables: {
    companies: [company],
    administration_context: { organization_admin: false, grants: [{ scope_kind: 'company', company_id: company.id }], companies: [company] },
    current_access: { organization_id: org, user_id: userId, profile: { display_name: 'Alex Morgan', timezone: 'America/New_York' }, membership: { affiliation: 'external', status: 'active' }, permissions: ['company.users.manage', 'work.execute_assigned'], roles: [{ id: 'vendor-role', role_code: 'vendor_admin', role_label: 'Vendor Manager', scope_kind: 'company', company_id: company.id }], companies: [{ company_id: company.id, kind: 'manager' }] }
  } })
  let body: Record<string, unknown> = {}
  await page.route('**/functions/v1/invite-user', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: { invitation_id: 'vendor-invite', expires_at: '2026-11-01T12:00:00Z' } }) })
  await page.goto(`${base}/admin?invite=1&company=${company.id}`)
  const form = page.getByRole('form', { name: 'Invite team member' })
  await form.getByRole('combobox', { name: 'Role', exact: true }).selectOption('trade_technician')
  await expect(form.getByRole('combobox', { name: 'Neighborhood', exact: true })).toHaveCount(0)
  await expect(form.getByRole('combobox', { name: 'Division', exact: true })).toHaveCount(0)
  await expect(form.getByRole('combobox', { name: 'Role', exact: true }).getByRole('option', { name: 'Org Admin', exact: true })).toHaveCount(0)
  await form.getByRole('textbox', { name: 'Email address' }).fill('technician@example.test')
  await page.screenshot({ path: testInfo.outputPath('vendor-team-invitation.png'), fullPage: true })
  await form.getByRole('button', { name: 'Send invitation' }).click()
  await expect(form.getByRole('status')).toContainText('Invitation sent')
  expect(body).toMatchObject({ company_id: company.id, company_kind: 'technician', grants: [{ scope_kind: 'company', company_id: company.id, neighborhood_id: null, division_id: null, home_id: null }] })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('a neighborhood admin manages local team and eligibility without company or coverage controls', async ({ page }) => {
  await mockWorkspace(page, { permissions: ['access.manage', 'roster.manage'], tables: {
    companies: [company], neighborhoods: [neighborhood, otherArea], divisions: [divisionA, divisionB],
    administration_context: { organization_admin: false, grants: [{ scope_kind: 'neighborhood', neighborhood_id: neighborhood.id }], companies: [company] },
    vendor_access_context: { can_edit: false, can_edit_company_details: false, can_edit_profile: false, can_deactivate: false, can_manage_coverage: false, can_manage_team: true, can_manage_eligibility: true, owner_scope_kind: 'neighborhood', owner_label: neighborhood.name,
      coverage: [{ id: 'parent-coverage', scope_kind: 'division', division_id: divisionB.id, neighborhood_id: null, label: divisionB.name, authority_level: 1, can_remove: false }] }
  } })
  await page.goto(`${base}/vendors/${company.id}`)
  await expect(page.getByRole('heading', { name: 'Approved coverage', exact: true })).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('button', { name: 'Deactivate vendor', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Remove coverage', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add coverage', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Invite vendor member', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Add eligibility', exact: true })).toBeVisible()
  await expect(page.getByText('Company name, reference, approved coverage, and lifecycle are controlled by an organization administrator.')).toBeVisible()
})

test('a division admin edits contact and services but not identity or EIN', async ({ page }) => {
  await mockWorkspace(page, { permissions: ['access.manage', 'roster.manage'], tables: {
    companies: [company], neighborhoods: [neighborhood], divisions: [divisionA],
    administration_context: { organization_admin: false, grants: [{ scope_kind: 'division', division_id: divisionA.id }], companies: [company] },
    vendor_access_context: { can_edit: false, can_edit_company_details: false, can_edit_profile: true, can_deactivate: false, can_manage_coverage: false, can_manage_team: true, can_manage_eligibility: true, owner_scope_kind: 'organization', owner_label: 'Organization', coverage: [] },
    company_profile_context: { can_edit: true, can_edit_profile: true, can_edit_ein: false, ein: null }
  } })
  await page.goto(`${base}/vendors/${company.id}`)
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save contact & services', exact: true })).toBeVisible()
  await expect(page.getByLabel(/^EIN/)).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Deactivate vendor', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Invite vendor member', exact: true })).toBeVisible()
})
