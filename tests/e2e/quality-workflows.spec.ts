import { expect, test } from '@playwright/test'
import { home, mockWorkspace, neighborhood, org, userId } from './fixtures/workspace'
import { standardSpaceTypes } from '../../src/features/properties/spaceTypeCatalog'

const base = `/org/${org}`
const inspection = { id: 'quality-inspection', organization_id: org, neighborhood_id: neighborhood.id, home_id: home.id, type: 'external_quality', status: 'in_progress', scheduled_at: null, company_id: 'company-1', lead_inspector_user_id: userId, template_version_id: 'checklist-1', current_revision: 1, version: 3 }
const location = { id: 'kitchen', name: 'Kitchen', home_id: home.id, organization_id: org, active: true, parent_location_id: null, space_type_code: 'kitchen' }
const observation = { id: 'observation-1', organization_id: org, inspection_id: inspection.id, neighborhood_id: neighborhood.id, home_id: home.id, location_id: location.id, title: 'Damaged kitchen panel', description: 'Replace the damaged cabinet panel.', state: 'submitted', version: 2, priority: 'normal', safety_flag: false, reinspection_status: null, reinspection_assignee_user_id: null }

test('floor plan spaces require explicit choices from the expanded catalog and exclude retired types', async ({ page }, testInfo) => {
  await mockWorkspace(page, { tables: { master_plans: [], space_types: standardSpaceTypes.map((type) => ({ ...type, active: type.code !== 'bedroom' })) } })
  let body: Record<string, unknown> = {}
  await page.route('**/rest/v1/rpc/save_master_plan', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: { id: 'plan-expanded' } }) })
  await page.goto(`${base}/plans`)
  await page.getByRole('button', { name: 'Create floor plan', exact: true }).click()
  const form = page.getByRole('form', { name: 'Floor plan editor' })
  const levelCount = form.getByRole('combobox', { name: 'No. of levels', exact: true })
  await levelCount.selectOption('2')
  await levelCount.focus()
  await page.mouse.wheel(0, 300)
  await expect(levelCount).toHaveValue('2')
  const type = form.getByRole('combobox', { name: 'Space type 1', exact: true })
  await expect(type).toHaveValue('')
  await expect(type.getByRole('option', { name: 'Bedroom', exact: true })).toHaveCount(0)
  await expect(type.locator('option')).toHaveCount(standardSpaceTypes.length)
  await expect(type.locator('optgroup')).toHaveCount(8)
  await form.getByRole('textbox', { name: 'Plan name', exact: true }).fill('Courtyard home')
  await form.getByRole('textbox', { name: 'Space name 1', exact: true }).fill('Garden cooking area')
  await form.getByRole('combobox', { name: 'Level', exact: true }).selectOption('2')
  await form.getByRole('button', { name: 'Save floor plan' }).click()
  expect(body).toEqual({})
  await type.selectOption('outdoor_kitchen')
  await form.getByRole('button', { name: 'Add space' }).click()
  await expect(form.getByRole('combobox', { name: 'Space type 2', exact: true })).toHaveValue('')
  await form.getByRole('combobox', { name: 'Space type 2', exact: true }).selectOption('mechanical_room')
  await form.getByRole('textbox', { name: 'Space name 2', exact: true }).fill('Ground floor services')
  for (const width of testInfo.project.name === 'desktop-chromium' ? [1440, 768] : [390]) {
    await page.setViewportSize({ width, height: 950 })
    await page.evaluate(() => window.scrollTo(0, 0))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`space-types-${width}.png`), fullPage: true })
  }
  await form.getByRole('button', { name: 'Save floor plan' }).click()
  await expect(page.getByRole('status')).toContainText('Plan saved')
  expect(body.p_levels).toBe(2)
  expect(body.p_spaces).toEqual([{ type: 'outdoor_kitchen', name: 'Garden cooking area', level: 2, square_feet: null }, { type: 'mechanical_room', name: 'Ground floor services', level: 1, square_feet: null }])
})

test('divisional floor plans can be created with named spaces', async ({ page }, testInfo) => {
  await mockWorkspace(page, { tables: { master_plans: [], space_types: [{ code: 'kitchen', label: 'Kitchen', active: true }, { code: 'bedroom', label: 'Bedroom', active: true }] } })
  let body: Record<string, unknown> = {}
  await page.route('**/rest/v1/rpc/save_master_plan', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: { id: 'plan-1' } }) })
  await page.goto(`${base}/plans`)
  await page.getByRole('button', { name: 'Create floor plan', exact: true }).click()
  const form = page.getByRole('form', { name: 'Floor plan editor' })
  await form.getByRole('textbox', { name: 'Plan name', exact: true }).fill('The Monterey')
  await form.getByRole('combobox', { name: 'Space type 1' }).selectOption('kitchen')
  await form.getByRole('textbox', { name: 'Space name 1' }).fill('Kitchen')
  await form.getByRole('button', { name: 'Add space' }).click()
  await form.getByRole('combobox', { name: 'Space type 2' }).selectOption('bedroom')
  await form.getByRole('textbox', { name: 'Space name 2' }).fill('Bedroom 1')
  await page.screenshot({ path: testInfo.outputPath('floor-plan-editor.png'), fullPage: true })
  await form.getByRole('button', { name: 'Save floor plan' }).click()
  await expect(page.getByRole('status')).toContainText('Plan saved')
  expect(body).toMatchObject({ p_division: 'division-1', p_name: 'The Monterey', p_levels: 1, p_spaces: [{ type: 'kitchen', name: 'Kitchen', level: 1 }, { type: 'bedroom', name: 'Bedroom 1', level: 1 }] })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('supervisors can schedule directly to an approved inspection company', async ({ page }) => {
  await mockWorkspace(page, { tables: { homes: { ...home, master_plan_id: 'savoy' }, master_plans: [{ id: 'savoy', name: 'Savoy', version: 1, spaces: [{ type: 'kitchen', name: 'Kitchen', checklist_items: ['Check cabinet doors'] }] }], inspection_company_options: [{ id: 'company-1', name: 'Cedar QA' }], checklist_versions: [{ id: 'checklist-1', number: 1, published_at: '2026-10-28T12:00:00Z', template_id: 'template-1', checklist_templates: { name: 'Final QA' } }] } })
  let body: Record<string, unknown> = {}
  await page.route('**/functions/v1/command', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, data: inspection } }) })
  await page.goto(`${base}/inspections?new=1`)
  await expect(page.getByRole('link', { name: 'Checklist creation', exact: true })).toHaveAttribute('href', `${base}/settings/checklists`)
  await page.getByRole('combobox', { name: 'Home', exact: true }).selectOption(home.id)
  await page.getByRole('combobox', { name: 'Assign inspection to' }).selectOption('company')
  await expect(page.getByRole('combobox', { name: 'Lead inspector', exact: true })).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Inspection company', exact: true }).selectOption('company-1')
  await expect(page.getByRole('heading', { name: 'Savoy checklist' })).toBeVisible()
  await page.getByRole('button', { name: 'Create inspection' }).click()
  await expect(page.getByRole('heading', { name: 'Schedule inspection', exact: true })).toHaveCount(0)
  expect(body).toMatchObject({ command_name: 'schedule_company_inspection', envelope: { payload: { company_id: 'company-1', lead_inspector_user_id: null, home_id: home.id } } })
})

test('company managers allocate an inspection without field editing controls', async ({ page }, testInfo) => {
  await mockWorkspace(page, { permissions: ['company.users.manage', 'work.execute_assigned'], tables: { inspections: { ...inspection, lead_inspector_user_id: null, status: 'draft' }, inspection_allocation_options: [{ user_id: 'company-inspector', display_name: 'Jordan Inspector' }], home_locations: [location], work_items: [] } })
  let body: Record<string, unknown> = {}
  await page.route('**/functions/v1/command', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, data: { ...inspection, version: 4 } } }) })
  await page.goto(`${base}/inspections/${inspection.id}`)
  const form = page.getByRole('form', { name: 'Assign company Inspector' })
  await form.getByRole('combobox', { name: 'Inspector', exact: true }).selectOption('company-inspector')
  await form.getByRole('textbox', { name: 'Assignment / reassignment reason' }).fill('Daily allocation')
  await expect(page.getByRole('form', { name: 'Record additional observation' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('company-inspector-allocation.png'), fullPage: true })
  await form.getByRole('button', { name: 'Save Inspector assignment' }).click()
  await expect(page.getByRole('status')).toContainText('Inspection updated')
  expect(body).toMatchObject({ command_name: 'allocate_inspection', envelope: { expected_version: 3, payload: { inspector_user_id: 'company-inspector' } } })
})

test('an Inspector records observations in the lot-specific room layout', async ({ page }, testInfo) => {
  await mockWorkspace(page, { permissions: ['inspection.perform', 'inspection.findings.create', 'evidence.upload', 'comment.create_shared'], tables: { inspections: inspection, home_locations: [location], work_items: [] } })
  let body: Record<string, unknown> = {}
  await page.route('**/functions/v1/command', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, data: { id: 'new-observation', version: 1 } } }) })
  await page.goto(`${base}/inspections/${inspection.id}`)
  const section = page.getByRole('region', { name: 'Additional observations' })
  await section.getByRole('button', { name: 'Add additional observation' }).click()
  await section.getByRole('combobox', { name: 'Room or area' }).selectOption(location.id)
  const form = page.getByRole('form', { name: 'Record additional observation' })
  await form.getByRole('textbox', { name: 'Observation title' }).fill('Cabinet panel damaged')
  await form.getByRole('textbox', { name: 'What needs fixing?' }).fill('Replace the upper panel beside the refrigerator.')
  await page.screenshot({ path: testInfo.outputPath('room-observation.png'), fullPage: true })
  await form.getByRole('button', { name: 'Save observation' }).click()
  await expect(page.getByRole('status')).toContainText('Observation saved')
  expect(body).toMatchObject({ command_name: 'record_inspection_observation', envelope: { payload: { location_id: 'kitchen', inspection_id: inspection.id } } })
})

test('supervisors select original observations for independent reinspection', async ({ page }) => {
  await mockWorkspace(page, { tables: { inspections: { ...inspection, status: 'submitted' }, work_items: [{ ...observation, state: 'ready_for_verification' }], home_locations: [location] } })
  let body: Record<string, unknown> = {}
  await page.route('**/functions/v1/command', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, data: { updated_count: 1 } } }) })
  await page.goto(`${base}/inspections/${inspection.id}`)
  const section = page.getByRole('region', { name: 'Review observations' })
  await section.getByRole('checkbox').check()
  await section.getByRole('combobox', { name: 'Action', exact: true }).selectOption('reinspect')
  await section.getByRole('combobox', { name: 'Inspector', exact: true }).selectOption(userId)
  await section.getByRole('textbox', { name: 'Reason', exact: true }).fill('Verify the repaired panel on site')
  await section.getByRole('button', { name: 'Apply to selected observations' }).click()
  await expect(section.getByRole('status')).toContainText('1 observations updated')
  expect(body).toMatchObject({ command_name: 'bulk_review_observations', envelope: { payload: { action: 'reinspect', inspector_user_id: userId, rows: [{ item_id: observation.id, expected_version: 2 }] } } })
})

test('reinspection inbox groups observations by home and closes each original thread', async ({ page }, testInfo) => {
  await mockWorkspace(page, { permissions: ['inspection.perform', 'inspection.findings.create'], tables: { work_items: [{ ...observation, state: 'ready_for_verification', reinspection_status: 'pending', reinspection_assignee_user_id: userId }] } })
  let body: Record<string, unknown> = {}
  await page.route('**/functions/v1/command', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, data: { ...observation, state: 'verified' } } }) })
  await page.goto(`${base}/inspections`)
  await page.getByRole('button', { name: 'Re-inspections', exact: true }).click()
  await page.getByText(/Lot 104 · 1 items? to re-inspect/).click()
  await page.getByRole('combobox', { name: 'Reinspection decision' }).selectOption('accepted')
  await page.getByRole('textbox', { name: 'On-site findings' }).fill('Replacement panel verified on site.')
  await page.getByRole('checkbox', { name: 'I inspected this repair on site.' }).check()
  await page.screenshot({ path: testInfo.outputPath('targeted-reinspection.png'), fullPage: true })
  await page.getByRole('button', { name: 'Record reinspection', exact: true }).click()
  await expect.poll(() => body.command_name).toBe('decide_reinspection')
  expect(body).toMatchObject({ envelope: { expected_version: 2, payload: { item_id: observation.id, decision: 'accepted' } } })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
