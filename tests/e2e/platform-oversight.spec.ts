import { expect, test, type Page } from '@playwright/test'
import { mockWorkspace, org } from './fixtures/workspace'

const organization = { id: org, name: 'Cedar Homes', timezone: 'America/New_York', status: 'active', onboarding_status: 'ready', version: 1 }
const provider = { id: 'provider-qa', name: 'Cedar Inspection Company', status: 'active', contact_email: 'qa@example.test', phone_number: '555-0100', physical_address: '100 Provider Avenue', categories: ['third_party_inspection'], member_count: 1, coverage_count: 1, owner_scope_kind: 'neighborhood', owner_label: 'Cedar Grove', external_vendor_reference: 'QA-100' }
async function setup(page: Page, verified = true) {
  const operationalReads: string[] = []
  page.on('request', (request) => { const resource = new URL(request.url()).pathname.split('/').at(-1)!; if (['work_items', 'work_item_list', 'inspections', 'inspection_list', 'attachments', 'comments', 'homes', 'home_summary'].includes(resource)) operationalReads.push(resource) })
  const catalogs = [{ kind: 'space_type', code: 'kitchen', label: 'Kitchen', active: true, version: 1, sort_order: 0 }, { kind: 'company_category', code: 'third_party_inspection', label: 'Third-party inspection', active: true, version: 1, sort_order: 10 }, { kind: 'construction_phase', code: 'framing', label: 'Framing', active: true, version: 1, sort_order: 10 }]
  const settings = { default_timezone: 'America/New_York', version: 1 }
  await mockWorkspace(page, { permissions: [], aal: verified ? 'aal2' : 'aal1', tables: {
    manage_role_catalog: { roles: [], permissions: [] }, my_organizations: [], platform_access: { administrator: true, verified },
    platform_get_organization: { organization, onboarding: null, invitations: [], activity: [] },
    platform_list_providers: { rows: [provider], total: 1 },
    platform_get_provider: { company: provider, member_total: 1, coverage_total: 1, members: [{ user_id: 'provider-user', display_name: 'Jordan Inspector', email: 'jordan@example.test', kind: 'technician', status: 'active', roles: [{ label: 'Inspector', scope: 'company', effective: true }] }], coverage: [{ id: 'coverage-qa', scope: 'neighborhood', label: 'Cedar Grove' }] },
    platform_get_configuration: { settings, catalogs }, workspace_defaults: { default_timezone: settings.default_timezone },
    platform_get_operations: { pricing: null, usage: { users: 1, homes: 10 }, total: 1, invitations: [], members: [{ user_id: 'provider-user', display_name: 'Jordan Inspector', email: 'jordan@example.test', affiliation: 'external', status: 'active', roles: [{ label: 'Inspector', scope: 'company', effective: true }] }] }
  } })
  return { operationalReads, catalogs, settings }
}

test('Super Admin can review providers and users without entering construction data', async ({ page }, testInfo) => {
  const { operationalReads } = await setup(page)
  await page.goto(`/platform/organizations/${org}/providers`)
  await page.getByRole('link', { name: /Cedar Inspection Company/ }).click()
  await expect(page.getByRole('heading', { name: provider.name, exact: true })).toBeVisible()
  await expect(page.getByText('Jordan Inspector', { exact: true })).toBeVisible()
  await expect(page.getByText('Cedar Grove', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Open workspace|Work items|Inspections|Reports|Evidence/ })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('platform-provider-oversight.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('link', { name: 'Manage user access' }).click()
  await expect(page.getByRole('searchbox', { name: 'Search users' })).toHaveValue('jordan@example.test')
  await expect(page.getByText(/current assignments/)).toHaveCount(0)
  expect(operationalReads).toEqual([])
  await page.goto(`/org/${org}/my-work`)
  await expect(page).toHaveURL(/organizations\/select/)
})

test('global catalogs support creation and retirement without changing stable codes', async ({ page }, testInfo) => {
  const { catalogs } = await setup(page)
  const calls: Array<Record<string, unknown>> = []
  await page.route('**/rest/v1/rpc/platform_save_catalog_entry', async (route) => {
    const body = route.request().postDataJSON(); calls.push(body)
    const existing = catalogs.find((entry) => entry.kind === body.p_kind && entry.code === body.p_code)
    if (existing) Object.assign(existing, { active: body.p_active, label: body.p_label, version: existing.version + 1 })
    else catalogs.push({ kind: body.p_kind, code: body.p_code, label: body.p_label, active: body.p_active, sort_order: body.p_sort_order, version: 1 })
    await route.fulfill({ json: { code: body.p_code } })
  })
  await page.goto('/platform/settings')
  await page.getByRole('button', { name: 'Add catalog entry' }).click()
  const form = page.getByRole('form', { name: 'Master catalog entry' })
  await form.getByRole('textbox', { name: /^Code/ }).fill('sunroom')
  await form.getByRole('textbox', { name: 'Display name' }).fill('Sunroom')
  await form.getByRole('button', { name: 'Save catalog entry' }).click()
  await expect(page.getByRole('status')).toContainText('Master catalog updated')
  await page.getByRole('button', { name: 'Edit Sunroom' }).click()
  await expect(form.getByRole('textbox', { name: /^Code/ })).toBeDisabled()
  await form.getByRole('checkbox', { name: 'Available for new selections' }).uncheck()
  await form.getByRole('button', { name: 'Save catalog entry' }).click()
  await expect.poll(() => calls.at(-1)).toMatchObject({ p_kind: 'space_type', p_code: 'sunroom', p_active: false, p_version: 1 })
  await page.screenshot({ path: testInfo.outputPath('platform-master-catalogs.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('platform timezone defaults are version checked and administrative pages require MFA', async ({ page }) => {
  const { settings } = await setup(page)
  let body: Record<string, unknown> = {}
  await page.route('**/rest/v1/rpc/platform_save_settings', async (route) => { body = route.request().postDataJSON(); settings.default_timezone = String(body.p_timezone); settings.version++; await route.fulfill({ json: settings }) })
  await page.goto('/platform/settings')
  await page.getByRole('textbox', { name: /^Default timezone/ }).fill('America/Chicago')
  await page.getByRole('button', { name: 'Save defaults' }).click()
  await expect(page.getByRole('status')).toContainText('Workspace defaults updated')
  expect(body).toMatchObject({ p_timezone: 'America/Chicago', p_version: 1 })
})

test('an unverified platform session cannot load provider or catalog controls', async ({ page }) => {
  await setup(page, false)
  await page.goto('/platform/settings')
  await expect(page.getByRole('heading', { name: 'Global settings & catalogs' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save defaults' })).toHaveCount(0)
  await page.goto(`/platform/organizations/${org}/providers`)
  await expect(page.getByRole('heading', { name: 'Organization providers' })).toHaveCount(0)
})
