import { expect, test } from '@playwright/test'
import { mockWorkspace, neighborhood, org, userId } from './fixtures/workspace'

const base = `/org/${org}`
const company = { id: 'company-1', name: 'Cedar QA and Trades' }
test('internal contributors can receive Inspector during onboarding', async ({ page }, testInfo) => {
  await mockWorkspace(page)
  let body: Record<string, unknown> = {}
  await page.route('**/functions/v1/invite-user', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: { invitation_id: 'internal-inspector', expires_at: '2026-11-03T12:00:00Z' } }) })
  await page.goto(`${base}/admin?invite=1`)
  const form = page.getByRole('form', { name: 'Invite team member' })
  await expect(form.getByRole('combobox', { name: 'Role', exact: true })).toHaveValue('internal_contributor')
  await form.getByRole('combobox', { name: 'Neighborhood', exact: true }).selectOption(neighborhood.id)
  await form.getByRole('checkbox', { name: 'Also assign Inspector', exact: true }).check()
  await expect(form.getByRole('combobox', { name: 'Vendor company *', exact: true })).toHaveCount(0)
  await form.getByRole('textbox', { name: 'Email address', exact: true }).fill('internal-qa@example.test')
  await page.screenshot({ path: testInfo.outputPath('internal-contributor-inspector.png'), fullPage: true })
  await form.getByRole('button', { name: 'Send invitation' }).click()
  await expect(form.getByRole('status')).toContainText('Invitation sent')
  expect(body).toMatchObject({ affiliation: 'internal', company_id: null, grants: [
    { role_code: 'internal_contributor', scope_kind: 'neighborhood', neighborhood_id: neighborhood.id, company_id: null },
    { role_code: 'inspector', scope_kind: 'neighborhood', neighborhood_id: neighborhood.id, company_id: null }
  ] })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('a Vendor Manager can invite an Inspector in their own company', async ({ page }, testInfo) => {
  await mockWorkspace(page, { permissions: ['company.users.manage', 'work.execute_assigned'], tables: {
    administration_context: { organization_admin: false, grants: [{ scope_kind: 'company', company_id: company.id, permissions: ['company.users.manage', 'work.execute_assigned'] }], companies: [company] }
  } })
  let body: Record<string, unknown> = {}
  await page.route('**/functions/v1/invite-user', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: { invitation_id: 'company-inspector', expires_at: '2026-11-03T12:00:00Z' } }) })
  await page.goto(`${base}/admin?invite=1&company=${company.id}`)
  const form = page.getByRole('form', { name: 'Invite team member' })
  await form.getByRole('combobox', { name: 'Role', exact: true }).selectOption('inspector')
  await expect(form.getByRole('combobox', { name: 'Access scope', exact: true })).toHaveValue('company')
  await expect(form.getByRole('combobox', { name: 'Vendor company *', exact: true })).toHaveValue(company.id)
  await expect(form.getByRole('combobox', { name: 'Neighborhood', exact: true })).toHaveCount(0)
  await expect(form.getByRole('combobox', { name: 'Division', exact: true })).toHaveCount(0)
  await expect(form.getByRole('combobox', { name: 'Role', exact: true }).getByRole('option', { name: 'Org Admin', exact: true })).toHaveCount(0)
  await form.getByRole('textbox', { name: 'Email address', exact: true }).fill('company-qa@example.test')
  await page.screenshot({ path: testInfo.outputPath('company-inspector.png'), fullPage: true })
  await form.getByRole('button', { name: 'Send invitation' }).click()
  await expect(form.getByRole('status')).toContainText('Invitation sent')
  expect(body).toMatchObject({ affiliation: 'external', company_id: company.id, company_kind: 'technician', grants: [{ role_code: 'inspector', scope_kind: 'company', company_id: company.id, neighborhood_id: null, home_id: null }] })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('Inspector access adds to an existing contributor instead of replacing their work role', async ({ page }, testInfo) => {
  const target = { user_id: 'contributor-1', display_name: 'Jordan Lee', email: 'jordan@example.test', affiliation: 'internal', status: 'active', companies: [],
    roles: [{ id: 'contributor-role', role_code: 'internal_contributor', role_label: 'Internal contributor', scope_kind: 'neighborhood', neighborhood_id: neighborhood.id, home_id: null, can_edit: true }] }
  await mockWorkspace(page, { tables: { admin_list_members: [target] } })
  let body: Record<string, unknown> = {}
  await page.route('**/rest/v1/rpc/admin_set_member_access', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: { updated: true } }) })
  await page.goto(`${base}/admin`)
  await page.getByRole('button', { name: 'Edit roles & scope', exact: true }).click()
  const form = page.getByRole('form', { name: 'Manage Jordan Lee', exact: true })
  await form.getByRole('button', { name: 'Add role', exact: true }).click()
  await form.getByRole('combobox', { name: 'Role', exact: true }).last().selectOption('inspector')
  await form.getByRole('combobox', { name: 'Neighborhood', exact: true }).last().selectOption(neighborhood.id)
  await page.screenshot({ path: testInfo.outputPath('add-inspector-to-contributor.png'), fullPage: true })
  await form.getByRole('button', { name: 'Save roles & scope', exact: true }).click()
  await expect(page.getByRole('status')).toContainText("Jordan Lee's access was updated")
  expect(body.p_assignments).toEqual([
    expect.objectContaining({ role_code: 'internal_contributor', scope_kind: 'neighborhood', neighborhood_id: neighborhood.id }),
    expect.objectContaining({ role_code: 'inspector', scope_kind: 'neighborhood', neighborhood_id: neighborhood.id })
  ])
})

test('a company Inspector has inspection access without ordinary work creation controls', async ({ page }) => {
  await mockWorkspace(page, { permissions: ['inspection.perform', 'inspection.findings.create', 'evidence.upload', 'comment.create_shared'], tables: {
    current_access: { organization_id: org, user_id: userId, profile: { display_name: 'Alex Morgan', timezone: 'America/New_York' }, membership: { affiliation: 'external', status: 'active' },
      permissions: ['inspection.perform', 'inspection.findings.create', 'evidence.upload', 'comment.create_shared'], roles: [{ id: 'inspector-role', role_code: 'inspector', role_label: 'Inspector', scope_kind: 'company', company_id: company.id }], companies: [{ company_id: company.id, kind: 'technician' }] }
  } })
  await page.goto(`${base}`)
  await expect(page).toHaveURL(`${page.url().split('/org/')[0]}${base}/inspections`)
  await expect(page.getByRole('heading', { name: 'Inspections', exact: true })).toBeVisible()
  await page.goto(`${base}/my-work`)
  await expect(page.getByRole('heading', { name: 'My work', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'New work item', exact: true })).toHaveCount(0)
})
