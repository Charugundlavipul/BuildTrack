import { expect, test } from '@playwright/test'
import { home, mockWorkspace, neighborhood, org, userId } from './fixtures/workspace'

const locations = ['Kitchen', 'Bathroom', 'Garage'].map((name) => ({ id: name.toLowerCase(), name, active: true, home_id: home.id, organization_id: org, parent_location_id: null }))
function item(id: string, location: string, assignee = userId) { return { id, organization_id: org, home_id: home.id, neighborhood_id: neighborhood.id, inspection_id: null, location_id: location, title: `Check ${location} repair`, description: 'Inspect the original repair and record the result.', state: 'ready_for_verification', version: 3, reinspection_status: 'pending', reinspection_assignee_user_id: assignee, priority: 'normal', safety_flag: false } }

test('the targeted room view includes only this Inspector’s assigned observations', async ({ page }, testInfo) => {
  const rows = [item('kitchen-repair', 'kitchen'), item('bath-repair', 'bathroom'), item('other-person', 'garage', 'other-inspector')]
  await mockWorkspace(page, { permissions: ['inspection.perform', 'inspection.findings.create'], tables: { work_items: rows, home_locations: locations } })
  let last: Record<string, unknown> = {}
  await page.route('**/functions/v1/command', async (route) => {
    last = route.request().postDataJSON(); Object.assign(rows[0], { state: 'verified', reinspection_status: 'completed', version: 4 })
    await route.fulfill({ json: { ok: true, data: rows[0] } })
  })
  await page.goto(`/org/${org}/inspections/reinspections/${home.id}`)
  await expect(page.getByRole('heading', { name: 'Lot 104 · Re-inspection' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Garage (1)', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Check garage repair' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Kitchen (1)', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Check bathroom repair' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Check kitchen repair' })).toHaveAttribute('href', `/org/${org}/work/kitchen-repair`)
  await page.getByRole('combobox', { name: 'Reinspection decision' }).selectOption('accepted')
  await page.getByRole('textbox', { name: 'On-site findings' }).fill('Repair inspected on site and accepted.')
  await page.getByRole('checkbox', { name: 'I inspected this repair on site.' }).check()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('room-filtered-reinspection.png'), fullPage: true })
  await page.getByRole('button', { name: 'Record reinspection' }).click()
  await expect(page.getByRole('heading', { name: '1 observation to check', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Check bathroom repair' })).toBeVisible()
  expect(last).toMatchObject({ command_name: 'decide_reinspection', envelope: { expected_version: 3, payload: { item_id: 'kitchen-repair', decision: 'accepted' } } })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('an offline reinspection decision survives reload and syncs automatically once', async ({ page }) => {
  const rows = [item('offline-repair', 'kitchen')]
  await mockWorkspace(page, { permissions: ['inspection.perform', 'inspection.findings.create'], tables: { work_items: rows, home_locations: locations } })
  let sends = 0
  await page.route('**/functions/v1/command', async (route) => { sends++; Object.assign(rows[0], { state: 'verified', reinspection_status: 'completed', version: 4 }); await route.fulfill({ json: { ok: true, data: rows[0] } }) })
  await page.goto(`/org/${org}/inspections/reinspections/${home.id}`)
  await expect(page.getByRole('button', { name: 'Record reinspection' })).toBeEnabled()
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open('buildtrack-offline-v1'); request.onsuccess = () => resolve(request.result) })
    return new Promise<boolean>((resolve) => { const request = db.transaction('cache').objectStore('cache').getAll(); request.onsuccess = () => { resolve(request.result.some((r) => r.entity_type === 'field_context')); db.close() } })
  })).toBe(true)
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }))
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); window.dispatchEvent(new Event('offline')) })
  await page.getByRole('combobox', { name: 'Reinspection decision' }).selectOption('accepted')
  await page.getByRole('textbox', { name: 'On-site findings' }).fill('Checked offline, panel is aligned.')
  await page.getByRole('checkbox', { name: 'I inspected this repair on site.' }).check()
  await page.getByRole('button', { name: 'Record reinspection' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Decision saved on this device' })).toBeVisible()
  expect(sends).toBe(0)
  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: 'Decision saved on this device' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Record reinspection' })).toHaveCount(0)
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }); window.dispatchEvent(new Event('online')) })
  await expect.poll(() => sends, { timeout: 30000 }).toBe(1)
  await expect(page.getByRole('heading', { name: 'No remaining observations to inspect' })).toBeVisible()
})
