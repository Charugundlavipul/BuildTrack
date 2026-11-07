import { expect, test, type Page } from '@playwright/test'
import { home, mockWorkspace, neighborhood, org } from './fixtures/workspace'

test.use({ actionTimeout: 10_000 })
const otherNeighborhood = { ...neighborhood, id: 'other-community', name: 'Harbor Point', code: 'HP' }
const otherHome = { ...home, id: 'other-home', neighborhood_id: otherNeighborhood.id, lot_code: '205', address_line1: '205 Harbor Lane' }
const targetUser = { user_id: 'target-user', display_name: 'Jordan Lee', email: 'jordan@example.test', affiliation: 'internal', status: 'active', companies: [], roles: [{ id: 'target-role', role_code: 'scope_reviewer', scope_kind: 'home', neighborhood_id: neighborhood.id, home_id: home.id }] }

async function setup(page: Page) {
  await mockWorkspace(page, { tables: { roles: [
    { code: 'scope_reviewer', label: 'Scoped reviewer', allowed_scope_kinds: ['organization', 'neighborhood', 'home'], requires_company: false },
    { code: 'internal_contributor', label: 'Internal contributor', allowed_scope_kinds: ['neighborhood', 'home'], requires_company: false },
    { code: 'vendor_admin', label: 'Vendor Manager', allowed_scope_kinds: ['company'], requires_company: true }
  ], neighborhoods: [neighborhood, otherNeighborhood], neighborhood_summary: [neighborhood, otherNeighborhood], home_summary: [home, otherHome], admin_list_members: [targetUser] } })
  await page.goto(`/org/${org}/admin`)
}

test('invitation scope hides irrelevant fields and clears stale location values', async ({ page }, testInfo) => {
  await setup(page)
  await page.getByRole('button', { name: 'Invite user', exact: true }).click()
  const form = page.getByRole('form', { name: 'Invite team member', exact: true })
  await expect(form.getByRole('combobox', { name: 'Neighborhood', exact: true })).toBeVisible()
  await expect(form.getByRole('combobox', { name: 'Home', exact: true })).toHaveCount(0)
  await expect(form.getByRole('combobox', { name: 'Company member type', exact: true })).toHaveCount(0)
  await form.getByRole('combobox', { name: 'Role', exact: true }).selectOption('scope_reviewer')
  await expect(form.getByRole('combobox', { name: 'Neighborhood', exact: true })).toHaveCount(0)
  await form.getByRole('combobox', { name: 'Access scope', exact: true }).selectOption('home')
  await expect(form.getByRole('combobox', { name: 'Home', exact: true })).toBeDisabled()
  await form.getByRole('combobox', { name: 'Neighborhood', exact: true }).selectOption(neighborhood.id)
  await expect(form.getByRole('combobox', { name: 'Home', exact: true }).getByRole('option', { name: /Lot 205/ })).toHaveCount(0)
  await form.getByRole('combobox', { name: 'Home', exact: true }).selectOption(home.id)
  await form.getByRole('combobox', { name: 'Neighborhood', exact: true }).selectOption(otherNeighborhood.id)
  await expect(form.getByRole('combobox', { name: 'Home', exact: true })).toHaveValue('')
  await expect(form.getByRole('combobox', { name: 'Home', exact: true }).getByRole('option', { name: /Lot 104/ })).toHaveCount(0)
  await form.getByRole('combobox', { name: 'Home', exact: true }).selectOption(otherHome.id)
  await expect(form.getByRole('combobox', { name: /company/i })).toHaveCount(0)
  await form.getByRole('combobox', { name: 'Access scope', exact: true }).selectOption('organization')
  await expect(form.getByRole('combobox', { name: 'Home', exact: true })).toHaveCount(0)
  await expect(form.getByRole('combobox', { name: 'Neighborhood', exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('organization-wide-invitation.png'), fullPage: true })
  let body: Record<string, unknown> = {}
  await page.route('**/functions/v1/invite-user', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: { invitation_id: 'fixture-invite', expires_at: '2026-11-01T12:00:00Z' } }) })
  await form.getByRole('textbox', { name: 'Email address', exact: true }).fill('new@example.test')
  await form.getByRole('button', { name: 'Send invitation', exact: true }).click()
  await expect(form.getByRole('status')).toContainText('Invitation sent.')
  expect(body).toMatchObject({ grants: [{ role_code: 'scope_reviewer', scope_kind: 'organization', neighborhood_id: null, home_id: null }], company_id: null, company_kind: null })
})

test('invitation uses role-compatible scopes and submits a selected home', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: 'Invite user', exact: true }).click()
  const form = page.getByRole('form', { name: 'Invite team member', exact: true })
  await expect(form.getByRole('combobox', { name: 'Access scope', exact: true }).getByRole('option', { name: 'Entire organization' })).toHaveCount(0)
  await form.getByRole('combobox', { name: 'Role', exact: true }).selectOption('vendor_admin')
  await expect(form.getByRole('combobox', { name: 'Access scope', exact: true }).getByRole('option')).toHaveCount(1)
  await expect(form.getByRole('combobox', { name: 'Vendor company *', exact: true })).toHaveAttribute('required', '')
  await form.getByRole('combobox', { name: 'Role', exact: true }).selectOption('internal_contributor')
  await form.getByRole('combobox', { name: 'Access scope', exact: true }).selectOption('home')
  await form.getByRole('combobox', { name: 'Neighborhood', exact: true }).selectOption(neighborhood.id)
  await form.getByRole('combobox', { name: 'Home', exact: true }).selectOption(home.id)
  let body: Record<string, unknown> = {}
  await page.route('**/functions/v1/invite-user', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: { invitation_id: 'fixture-invite', expires_at: '2026-11-01T12:00:00Z' } }) })
  await form.getByRole('textbox', { name: 'Email address', exact: true }).fill('new@example.test')
  await form.getByRole('button', { name: 'Send invitation', exact: true }).click()
  await expect(form.getByRole('status')).toContainText('Invitation sent.')
  expect(body.grants).toEqual([expect.objectContaining({ role_code: 'internal_contributor', scope_kind: 'home', neighborhood_id: neighborhood.id, home_id: home.id })])
})

test('existing user scopes can be changed without submitting hidden locations or company type', async ({ page }, testInfo) => {
  await setup(page)
  await page.getByRole('textbox', { name: 'Search team members', exact: true }).fill('Jordan')
  await page.getByRole('button', { name: 'Edit roles & scope', exact: true }).click()
  const form = page.getByRole('form', { name: 'Manage Jordan Lee', exact: true })
  await expect(form.getByRole('combobox', { name: 'Home', exact: true })).toHaveValue(home.id)
  await form.getByRole('combobox', { name: 'Access scope', exact: true }).selectOption('organization')
  await expect(form.getByRole('combobox', { name: 'Home', exact: true })).toHaveCount(0)
  await expect(form.getByRole('combobox', { name: 'Neighborhood', exact: true })).toHaveCount(0)
  await expect(form.getByRole('combobox', { name: 'Company member type', exact: true })).toHaveCount(0)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('manage-user-scopes.png'), fullPage: true })
  let body: Record<string, unknown> = {}
  await page.route('**/rest/v1/rpc/admin_set_member_access', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: {} }) })
  await form.getByRole('button', { name: 'Save roles & scope', exact: true }).click()
  await expect(page.getByRole('status')).toContainText("Jordan Lee's access was updated.")
  expect(body.p_user_id).toBe(targetUser.user_id)
  expect(body.p_assignments).toEqual([expect.objectContaining({ role_code: 'scope_reviewer', scope_kind: 'organization', neighborhood_id: null, home_id: null })])
  expect(body.p_company_kind).toBeUndefined()
})

test('user access editor filters homes and keeps a rejected update visible', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: 'Edit roles & scope', exact: true }).click()
  const form = page.getByRole('form', { name: 'Manage Jordan Lee', exact: true })
  await form.getByRole('combobox', { name: 'Neighborhood', exact: true }).selectOption(otherNeighborhood.id)
  await expect(form.getByRole('combobox', { name: 'Home', exact: true })).toHaveValue('')
  await expect(form.getByRole('combobox', { name: 'Home', exact: true }).getByRole('option', { name: /Lot 104/ })).toHaveCount(0)
  await form.getByRole('combobox', { name: 'Home', exact: true }).selectOption(otherHome.id)
  let body: Record<string, unknown> = {}
  await page.route('**/rest/v1/rpc/admin_set_member_access', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ status: 400, json: { message: 'Access update rejected by organization policy.' } }) })
  await form.getByRole('button', { name: 'Save roles & scope', exact: true }).click()
  await expect(form.getByRole('alert')).toContainText('Access update rejected by organization policy.')
  expect(body.p_assignments).toEqual([expect.objectContaining({ scope_kind: 'home', neighborhood_id: otherNeighborhood.id, home_id: otherHome.id })])
})
