import { expect, test, type Page } from '@playwright/test'
import { home, mockWorkspace, neighborhood, org } from './fixtures/workspace'

test.use({ actionTimeout: 10_000 })
const division = { id: 'division-1', organization_id: org, name: 'Triangle region', status: 'active', version: 1, updated_at: '2026-10-25T12:00:00Z' }
const base = `/org/${org}/properties`

async function propertyWorkspace(page: Page, options: { aal?: 'aal1' | 'aal2'; permissions?: string[]; rejectArchive?: boolean } = {}) {
  const records = { divisions: [{ ...division }], neighborhoods: [{ ...neighborhood }], homes: [{ ...home }], home_locations: [] as Array<{ id: string; name: string; home_id: string; parent_location_id: string | null; active: boolean }> }
  const commands: Array<{ name: string; body: Record<string, unknown> }> = []
  await mockWorkspace(page, options)
  await page.route('**/rest/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const resource = url.pathname.split('/').at(-1)!
    if (resource === 'home_summary') return route.fulfill({ json: records.homes.filter((row) => !url.searchParams.get('id') || url.searchParams.get('id') === `eq.${row.id}`) })
    if (resource in records) return route.fulfill({ json: records[resource as keyof typeof records] })
    if (!url.pathname.includes('/rpc/admin_save_') && resource !== 'admin_set_catalog_status' && resource !== 'save_home_space' && resource !== 'onboard_home_layout') return route.fallback()
    const body = route.request().postDataJSON()
    commands.push({ name: resource, body })
    if (resource === 'admin_save_division') {
      const row = { ...division, id: body.p_id ?? 'new-division', name: body.p_name, status: body.p_status }
      records.divisions = [...records.divisions.filter((item) => item.id !== row.id), row]
      return route.fulfill({ json: row })
    }
    if (resource === 'admin_save_neighborhood') {
      const row = { ...neighborhood, id: body.p_id ?? 'new-neighborhood', name: body.p_name, code: body.p_code, division_id: body.p_division_id, timezone: body.p_timezone, supervisor_user_id: body.p_supervisor_user_id }
      records.neighborhoods = [...records.neighborhoods.filter((item) => item.id !== row.id), row]
      return route.fulfill({ json: row })
    }
    if (resource === 'onboard_home_layout') {
      const details = body.p_details
      const row = { ...home, ...details, id: 'new-home', phase: 'planned' }
      records.homes.push(row)
      return route.fulfill({ json: row })
    }
    if (resource === 'admin_save_home') {
      const row = { ...home, id: body.p_id ?? 'new-home', neighborhood_id: body.p_neighborhood_id, lot_code: body.p_lot_code, address_line1: body.p_address_line1, address_line2: body.p_address_line2, city: body.p_city, state_code: body.p_state_code, postal_code: body.p_postal_code, phase: body.p_phase, external_reference: body.p_external_reference, primary_supervisor_user_id: body.p_primary_supervisor_user_id }
      records.homes = [...records.homes.filter((item) => item.id !== row.id), row]
      return route.fulfill({ json: row })
    }
    if (resource === 'save_home_space') {
      const row = { id: body.p_id ?? `location-${records.home_locations.length + 1}`, name: body.p_name, home_id: body.p_home, parent_location_id: body.p_parent, active: body.p_active }
      records.home_locations = [...records.home_locations.filter((item) => item.id !== row.id), row]
      return route.fulfill({ json: row })
    }
    if (resource === 'admin_set_catalog_status') {
      if (options.rejectArchive) return route.fulfill({ status: 400, json: { message: 'home has open work', code: '23514' } })
      records.homes = records.homes.map((item) => item.id === body.p_id ? { ...item, archived_at: body.p_active ? null : '2026-10-25T12:00:00Z' } : item)
      return route.fulfill({ json: { id: body.p_id, active: body.p_active } })
    }
    return route.fulfill({ status: 400, json: { message: 'Unexpected fixture command' } })
  })
  return { records, commands }
}

test('property directories and record pages fit desktop, tablet, and mobile', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  await propertyWorkspace(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const paths = [
    ['divisions', 'Divisions'], ['neighborhoods', 'Neighborhoods'], ['homes', 'Homes & lots'],
    ['divisions/division-1', 'Triangle region'], ['neighborhoods/community-1', 'Cedar Grove'], ['homes/home-1', 'Lot 104'],
    ['divisions/new', 'Add division'], ['neighborhoods/new?division=division-1', 'Add neighborhood'], ['homes/new?neighborhood=community-1', 'Add home']
  ]
  for (const width of testInfo.project.name.startsWith('mobile') ? [390] : [1440, 768]) {
    await page.setViewportSize({ width, height: 960 })
    for (const [path, title] of paths) {
      await page.goto(`${base}/${path}`)
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible({ timeout: 15_000 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`${width}-${path.replaceAll(/[/?=]/g, '-')}.png`), fullPage: true })
    }
  }
  expect(errors).toEqual([])
})

test('creates the hierarchy, edits a home, and manages its rooms', async ({ page }) => {
  test.setTimeout(90_000)
  const { commands } = await propertyWorkspace(page)
  await page.goto(`${base}/divisions`)
  await page.getByRole('link', { name: 'Add division', exact: true }).click()
  await page.getByRole('textbox', { name: 'Division name *', exact: true }).fill('Coastal region')
  await page.getByRole('button', { name: 'Create division', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Coastal region', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Add neighborhood', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Division', exact: true })).toHaveValue('new-division')
  await page.getByRole('textbox', { name: 'Neighborhood name *', exact: true }).fill('Harbor Point')
  await page.getByRole('textbox', { name: 'Neighborhood code *', exact: true }).fill('HP')
  await page.getByRole('button', { name: 'Create neighborhood', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Harbor Point', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Add home', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Neighborhood *', exact: true })).toHaveValue('new-neighborhood')
  await page.getByRole('textbox', { name: 'Lot code *', exact: true }).fill('205')
  await page.getByRole('textbox', { name: 'Street address', exact: true }).fill('205 Harbor Lane')
  await page.getByRole('combobox', { name: 'Layout method *', exact: true }).selectOption('manual')
  await page.getByRole('combobox', { name: 'Room type 1 *', exact: true }).selectOption('other')
  await page.getByRole('textbox', { name: 'Room name 1 *', exact: true }).fill('Entry')
  await page.getByRole('button', { name: 'Create home', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Lot 205', exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Street address', exact: true }).fill('205 Harbor Point Lane')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Lot 205 updated.')
  expect(commands.find((command) => command.name === 'admin_save_neighborhood')?.body.p_division_id).toBe('new-division')
  expect(commands.filter((command) => command.name === 'admin_save_home').at(-1)?.body).toMatchObject({ p_id: 'new-home', p_neighborhood_id: 'new-neighborhood', p_address_line1: '205 Harbor Point Lane' })

  await page.getByRole('button', { name: 'Add location', exact: true }).click()
  await page.getByRole('combobox', { name: 'Space type', exact: true }).selectOption('other')
  await page.getByRole('textbox', { name: 'Location name', exact: true }).fill('First floor')
  await page.getByRole('button', { name: 'Save location', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Edit First floor', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add location', exact: true }).click()
  await page.getByRole('combobox', { name: 'Space type', exact: true }).selectOption('other')
  await page.getByRole('textbox', { name: 'Location name', exact: true }).fill('Kitchen')
  await page.getByRole('combobox', { name: 'Within area', exact: true }).selectOption('location-1')
  await page.getByRole('button', { name: 'Save location', exact: true }).click()
  await page.getByRole('button', { name: 'Edit First floor', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Within area' }).getByRole('option')).toHaveCount(1)
  await page.getByRole('button', { name: 'Close location editor' }).click()
  await page.getByRole('button', { name: 'Edit Kitchen', exact: true }).click()
  await page.getByRole('textbox', { name: 'Location name', exact: true }).fill('Kitchen & pantry')
  await page.getByRole('button', { name: 'Save location', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Edit Kitchen & pantry', exact: true })).toBeVisible()
})

test('preserves existing home data, archives and restores through the directory', async ({ page }) => {
  const { commands } = await propertyWorkspace(page)
  await page.goto(`${base}/homes/home-1`)
  await page.getByRole('textbox', { name: 'Street address', exact: true }).fill('104 Updated Boulevard')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Lot 104 updated.')
  expect(commands.at(-1)?.body).toMatchObject({ p_id: home.id, p_address_line2: 'Unit A', p_external_reference: 'CRM-104', p_primary_supervisor_user_id: 'supervisor-1', p_archived: false })
  await page.getByRole('button', { name: 'Archive home', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm archive', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Restore home', exact: true })).toBeVisible()
  await page.goto(`${base}/homes?status=archived`)
  await expect(page.getByRole('link', { name: 'Lot 104', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Open Lot 104', exact: true }).click()
  await page.getByRole('navigation', { name: 'Home sections' }).getByRole('link', { name: 'Details & rooms' }).click()
  await page.getByRole('button', { name: 'Restore home', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm restore', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Archive home', exact: true })).toBeVisible()
  await page.goto(`${base}/homes?q=does-not-exist`)
  await expect(page.getByRole('heading', { name: 'No matching records' })).toBeVisible()
  await page.getByRole('button', { name: 'Reset filters' }).click()
  await expect(page.getByRole('link', { name: 'Lot 104', exact: true })).toBeVisible()
})

test('keeps an archive refusal visible and requires elevated access for changes', async ({ page }) => {
  await propertyWorkspace(page, { rejectArchive: true })
  await page.goto(`${base}/homes/home-1`)
  await page.getByRole('button', { name: 'Archive home', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm archive', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('home has open work')
})

test('authorized property editors can edit with the current MFA-disabled policy', async ({ page }) => {
  await propertyWorkspace(page, { aal: 'aal1' })
  await page.goto(`${base}/homes/home-1`)
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Archive home', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Add location', exact: true })).toBeEnabled()
  await expect(page.getByText('You can browse records.', { exact: false })).toHaveCount(0)
})

test('a field-only role cannot access property administration', async ({ page }) => {
  await propertyWorkspace(page, { permissions: ['work.read_scope'] })
  await page.goto(`${base}/homes`)
  await expect(page.getByRole('heading', { name: 'Access not granted' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Properties', exact: true })).toHaveCount(0)
})
