import { expect, test, type Page } from '@playwright/test'
import { mockWorkspace, neighborhood, org } from './fixtures/workspace'

test.use({ actionTimeout: 10_000, trace: 'off' })
const base = `/org/${org}/vendors`
const stamp = new Date().toISOString()
const past = new Date(Date.now() - 7 * 86400000).toISOString()
const future = new Date(Date.now() + 7 * 86400000).toISOString()
const ended = new Date(Date.now() - 86400000).toISOString()
const vendor = { id: 'vendor-1', organization_id: org, name: 'Cedar Finish Carpentry', categories: ['Finish carpentry'], external_vendor_reference: 'VEN-104', status: 'active', version: 1, created_at: stamp, updated_at: stamp }
const roster = { authority_level: 1, id: 'roster-1', organization_id: org, company_id: vendor.id, neighborhood_id: neighborhood.id, status: 'active', active_from: past, active_to: null as string | null, version: 1, created_at: stamp, updated_at: stamp }
const member = { id: 'membership-1', organization_id: org, company_id: vendor.id, user_id: 'vendor-member', kind: 'manager', active_from: past, active_to: null, revoked_at: null }

async function workspace(page: Page, options: { aal?: 'aal1' | 'aal2'; permissions?: string[]; rejectDeactivate?: boolean } = {}) {
  const rosterOnly = options.permissions?.length === 1 && options.permissions[0] === 'roster.manage'
  const records = {
    companies: [{ ...vendor }, { ...vendor, id: 'vendor-2', name: 'Harbor Electrical', external_vendor_reference: 'VEN-205' }],
    neighborhoods: [{ ...neighborhood }], company_memberships: [{ ...member }],
    neighborhood_trade_rosters: [{ ...roster }, { ...roster, id: 'roster-scheduled', company_id: 'vendor-2', active_from: future }, { ...roster, id: 'roster-expired', active_to: ended }, { ...roster, id: 'roster-inactive', company_id: 'vendor-2', status: 'archived' }],
    assignment_episodes: [{ id: 'assignment-1', organization_id: org, company_id: vendor.id, work_item_id: 'vendor-work-1', due_at: future, ended_at: null }],
    work_items: [{ id: 'vendor-work-1', title: 'Repair kitchen cabinetry', state: 'in_progress', priority: 'high', due_at: future, current_assignment_id: 'assignment-1' }]
  }
  const commands: Array<{ name: string; body: Record<string, unknown> }> = []
  await mockWorkspace(page, { ...options, tables: {
    administration_context: rosterOnly ? { organization_admin: false, grants: [{ scope_kind: 'neighborhood', neighborhood_id: neighborhood.id, permissions: ['roster.manage'] }], companies: [] } : { organization_admin: true, grants: [{ scope_kind: 'organization' }], companies: [{ id: vendor.id, name: vendor.name }, { id: 'vendor-2', name: 'Harbor Electrical' }] },
    vendor_access_context: rosterOnly ? { can_edit: false, can_edit_company_details: false, can_edit_profile: false, can_deactivate: false, can_manage_coverage: false, can_manage_team: false, can_manage_eligibility: true, owner_scope_kind: 'organization', owner_label: 'Organization', coverage: [] } : { can_edit: true, can_edit_company_details: true, can_edit_profile: true, can_deactivate: true, can_manage_coverage: true, can_manage_team: true, can_manage_eligibility: true, owner_scope_kind: 'organization', owner_label: 'Organization', coverage: [] },
    participant_directory: [{ user_id: member.user_id, display_name: 'Jordan Vendor', affiliation: 'external' }],
    admin_list_members: [{ user_id: member.user_id, display_name: 'Jordan Vendor', email: 'jordan@example.test', affiliation: 'external', status: 'active', roles: [{ id: 'role-vendor', role_code: 'vendor_admin', scope_kind: 'neighborhood', neighborhood_id: neighborhood.id, home_id: null }], companies: [{ company_id: vendor.id, company_name: vendor.name, kind: 'manager' }] }]
  } })
  await page.route('**/rest/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const resource = url.pathname.split('/').at(-1)!
    if (resource in records) {
      if (resource === 'assignment_episodes') return route.fulfill({ json: records.assignment_episodes.filter((item) => url.searchParams.get('company_id') === `eq.${item.company_id}`) })
      return route.fulfill({ json: records[resource as keyof typeof records] })
    }
    if (!['onboard_vendor_with_profile', 'admin_save_company', 'admin_save_roster', 'admin_set_catalog_status'].includes(resource)) return route.fallback()
    const body = route.request().postDataJSON()
    commands.push({ name: resource, body })
    if (resource === 'admin_save_company' || resource === 'onboard_vendor_with_profile') {
      const row = { ...vendor, id: body.p_id ?? 'new-vendor', name: body.p_name, external_vendor_reference: body.p_external_vendor_reference ?? body.p_reference, status: body.p_status ?? 'active' }
      records.companies = [...records.companies.filter((item) => item.id !== row.id), row]
      return route.fulfill({ json: row })
    }
    if (resource === 'admin_save_roster') {
      const row = { ...roster, id: body.p_id ?? 'new-roster', company_id: body.p_company_id, neighborhood_id: body.p_neighborhood_id, active_from: body.p_active_from, active_to: body.p_active_to, status: body.p_status }
      records.neighborhood_trade_rosters = [...records.neighborhood_trade_rosters.filter((item) => item.id !== row.id), row]
      return route.fulfill({ json: row })
    }
    if (options.rejectDeactivate) return route.fulfill({ status: 400, json: { message: 'company has active assignments', code: '23514' } })
    if (body.p_entity === 'company') records.companies = records.companies.map((item) => item.id === body.p_id ? { ...item, status: body.p_active ? 'active' : 'archived' } : item)
    if (body.p_entity === 'roster') records.neighborhood_trade_rosters = records.neighborhood_trade_rosters.map((item) => item.id === body.p_id ? { ...item, status: body.p_active ? 'active' : 'archived' } : item)
    return route.fulfill({ json: { id: body.p_id, active: body.p_active } })
  })
  return { records, commands }
}

test('vendor directories, records, and creation pages fit desktop, tablet, and mobile', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  await workspace(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const paths = [['', 'Vendors'], ['/rosters', 'Neighborhood rosters'], ['/vendor-1', vendor.name], ['/rosters/roster-1', 'Manage eligibility'], ['/new', 'Add vendor'], ['/rosters/new?company=vendor-1', 'Add eligibility']]
  for (const width of testInfo.project.name.startsWith('mobile') ? [390] : [1440, 768]) {
    await page.setViewportSize({ width, height: 960 })
    for (const [path, title] of paths) {
      await page.goto(`${base}${path}`)
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible({ timeout: 15_000 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`${width}-${path.replaceAll(/[/?=]/g, '-') || 'directory'}.png`), fullPage: true })
    }
  }
  expect(errors).toEqual([])
})

test('creates and edits vendors and neighborhood eligibility', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const { commands } = await workspace(page)
  await page.goto(base)
  await page.getByRole('link', { name: 'Add vendor', exact: true }).click()
  await page.getByRole('textbox', { name: 'Vendor name *', exact: true }).fill('Oak Ridge Plumbing')
  await page.getByRole('textbox', { name: 'Vendor reference', exact: true }).fill('V-NEW')
  const categories = page.getByRole('combobox', { name: 'Company categories', exact: true })
  await categories.fill('cabinet')
  await page.getByRole('option', { name: 'Cabinetry & millwork', exact: true }).click()
  await categories.fill('fire protection')
  await categories.press('Enter')
  await expect(page.getByRole('button', { name: 'Remove Cabinetry & millwork', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove Fire protection', exact: true })).toBeVisible()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`company-category-pills-${width}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: 'Create vendor', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Oak Ridge Plumbing', exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Vendor name *', exact: true }).fill('Oak Ridge Plumbing LLC')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Vendor updated.')
  expect(commands.at(-1)?.body).toMatchObject({ p_id: 'new-vendor', p_name: 'Oak Ridge Plumbing LLC', p_external_vendor_reference: 'V-NEW' })
  expect(commands[0]?.body).toMatchObject({ p_profile: { categories: ['cabinetry_millwork', 'fire_protection'] } })
  await page.getByRole('link', { name: 'Add eligibility', exact: true }).click()
  await page.getByRole('combobox', { name: 'Vendor *', exact: true }).selectOption('new-vendor')
  await page.getByRole('combobox', { name: 'Neighborhood *', exact: true }).selectOption(neighborhood.id)
  await page.getByRole('button', { name: 'Create eligibility', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Manage eligibility', exact: true })).toBeVisible()
  expect(commands.at(-1)?.body).toMatchObject({ p_id: null, p_company_id: 'new-vendor', p_neighborhood_id: neighborhood.id, p_active_to: null })
  const start = await page.getByLabel('Active from *', { exact: true }).inputValue()
  await page.getByLabel(/^Active until/).fill(start)
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('The end date must be later than the start date.')
  await page.getByLabel(/^Active until/).fill('')
  await page.getByLabel('Active from *', { exact: true }).fill('2030-01-01T09:00')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Eligibility updated.')
  expect(commands.at(-1)?.body.p_id).toBe('new-roster')
  await expect(page.locator('.state-scheduled')).toBeVisible()
})

test('directory filters distinguish eligible, scheduled, expired, and inactive rosters', async ({ page }) => {
  await workspace(page)
  await page.goto(`${base}/rosters`)
  await expect(page.locator('.vendor-table tbody tr')).toHaveCount(4)
  for (const status of ['eligible', 'scheduled', 'expired', 'inactive']) {
    await page.getByRole('combobox', { name: 'Record status', exact: true }).selectOption(status)
    await expect(page.locator('.vendor-table tbody tr')).toHaveCount(1)
    await expect(page.locator(`.vendor-table .state-${status}`)).toBeVisible()
  }
  await page.goto(`${base}?q=VEN-104`)
  await expect(page.locator('.vendor-table tbody tr')).toHaveCount(1)
  await expect(page.getByRole('link', { name: vendor.name, exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Search vendors', exact: true }).fill('no matching vendor')
  await expect(page.getByRole('heading', { name: 'No matching records' })).toBeVisible()
  await page.getByRole('button', { name: 'Reset filters' }).click()
  await expect(page.locator('.vendor-table tbody tr')).toHaveCount(2)
})

test('vendor pages expose actual team, assigned work, and company-aware user management', async ({ page }) => {
  await workspace(page)
  await page.goto(`${base}/vendor-1`)
  await expect(page.getByText('Jordan Vendor', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Repair kitchen cabinetry', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Manage member', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Search team members', exact: true })).toHaveValue('Jordan Vendor')
  await page.getByRole('button', { name: 'Edit roles & scope', exact: true }).click()
  await expect(page.getByRole('form', { name: 'Manage Jordan Vendor', exact: true }).getByRole('combobox', { name: 'Company', exact: true })).toHaveValue(vendor.id)
  await page.goto(`${base}/vendor-1`)
  await page.getByRole('link', { name: 'Invite vendor member', exact: true }).click()
  const form = page.getByRole('form', { name: 'Invite team member', exact: true })
  await expect(form.getByRole('combobox', { name: 'Role', exact: true })).toHaveValue('vendor_admin')
  await expect(form.getByRole('combobox', { name: 'Vendor company *', exact: true })).toHaveValue(vendor.id)
})

test('vendors and roster eligibility can be deactivated and restored', async ({ page }) => {
  await workspace(page)
  await page.goto(`${base}/vendor-2`)
  await page.getByRole('button', { name: 'Deactivate vendor', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm deactivate', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Restore vendor', exact: true })).toBeVisible()
  await page.goto(`${base}?status=inactive`)
  await expect(page.getByRole('link', { name: 'Harbor Electrical', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Manage Harbor Electrical', exact: true }).click()
  await page.getByRole('button', { name: 'Restore vendor', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm restore', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Deactivate vendor', exact: true })).toBeVisible()
  await page.goto(`${base}/rosters/roster-1`)
  await page.getByRole('button', { name: 'Deactivate eligibility', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm deactivate', exact: true }).click()
  await expect(page.locator('.state-inactive')).toBeVisible()
  await page.getByRole('button', { name: 'Restore eligibility', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm restore', exact: true }).click()
  await expect(page.locator('.state-eligible')).toBeVisible()
})

test('active assignment refusal remains visible without hiding or archiving the vendor', async ({ page }) => {
  await workspace(page, { rejectDeactivate: true })
  await page.goto(`${base}/vendor-1`)
  await page.getByRole('button', { name: 'Deactivate vendor', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm deactivate', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('company has active assignments')
  await expect(page.getByRole('button', { name: 'Confirm deactivate', exact: true })).toBeVisible()
})

test('roster-only roles manage eligibility but not company identity or people', async ({ page }) => {
  await workspace(page, { aal: 'aal1', permissions: ['roster.manage'] })
  await page.goto(`${base}/vendor-1`)
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Deactivate vendor', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Invite vendor member', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Manage member', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Add eligibility', exact: true })).toBeVisible()
})

test('non-roster roles cannot open vendor management', async ({ page }) => {
  await workspace(page, { permissions: ['work.read_scope'] })
  await page.goto(base)
  await expect(page.getByRole('heading', { name: 'Access not granted' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Vendor management', exact: true })).toHaveCount(0)
})
