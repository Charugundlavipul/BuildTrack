import { expect, test } from '@playwright/test'
import { standardSpaceTypes } from '../../src/features/properties/spaceTypeCatalog'
import { home, mockWorkspace, org, userId } from './fixtures/workspace'

const category = { id: 'version-kitchen', template_id: 'category-kitchen', number: 1, published_at: '2026-11-03T12:00:00Z', checklist_templates: { name: 'Kitchen', active: true, snapshot_home_id: null } }
const categoryQuestions = [{ id: 'question-1', version_id: category.id, ordinal: 1, label: 'Cabinet doors are secure' }, { id: 'question-2', version_id: category.id, ordinal: 2, label: 'Countertops are finished' }]
const plan = { id: 'savoy', division_id: 'division-1', name: 'Savoy 1', active: true, version: 3, spaces: [{ type: 'kitchen', name: 'Kitchen', checklist_items: ['Cabinet doors are secure', 'Check island clearance'] }, { type: 'bedroom', name: 'Bedroom 1', checklist_items: ['Check closet door'] }] }

test('category items are imported into an editable and deletable space checklist', async ({ page }, testInfo) => {
  await mockWorkspace(page, { tables: { master_plans: [plan], checklist_versions: [category], checklist_questions: categoryQuestions, space_types: [{ code: 'kitchen', label: 'Kitchen', active: true }, { code: 'bedroom', label: 'Bedroom', active: true }] } })
  let saved: Record<string, unknown> | undefined
  await page.route('**/rest/v1/rpc/save_master_plan', async (route) => { saved = route.request().postDataJSON(); await route.fulfill({ json: plan }) })
  await page.goto(`/org/${org}/plans`)
  await page.getByRole('button', { name: 'Edit floor plan', exact: true }).click()
  await page.getByRole('combobox', { name: 'Import checklist category for Bedroom 1', exact: true }).fill('kit')
  await page.getByRole('option', { name: 'Kitchen · v1', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Checklist item 2 for Bedroom 1', exact: true })).toHaveValue('Cabinet doors are secure')
  await page.getByRole('textbox', { name: 'Checklist item 2 for Bedroom 1', exact: true }).fill('Cabinet doors and drawers are aligned')
  await page.getByRole('button', { name: 'Remove checklist item 3 for Bedroom 1', exact: true }).click()
  await page.getByRole('button', { name: 'Add checklist item for Bedroom 1', exact: true }).click()
  await page.getByRole('textbox', { name: 'Checklist item 3 for Bedroom 1', exact: true }).fill('Check bedroom window')
  await page.getByRole('button', { name: 'Add checklist item for Bedroom 1', exact: true }).click()
  await page.getByRole('textbox', { name: 'Checklist item 4 for Bedroom 1', exact: true }).fill('Temporary item')
  await page.getByRole('button', { name: 'Remove checklist item 4 for Bedroom 1', exact: true }).click()
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`plan-checklist-${width}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: 'Save floor plan', exact: true }).click()
  await expect.poll(() => saved).toBeTruthy()
  expect(saved).toMatchObject({ p_version: 3, p_spaces: [plan.spaces[0], { ...plan.spaces[1], checklist_items: ['Check closet door', 'Cabinet doors and drawers are aligned', 'Check bedroom window'] }] })
  expect((saved?.p_spaces as Array<Record<string, unknown>>)[1]).not.toHaveProperty('checklist_version_id')
})

test('scheduling inherits the home plan and sends property-only additions', async ({ page }, testInfo) => {
  await mockWorkspace(page, { tables: { master_plans: [plan], homes: { ...home, master_plan_id: plan.id }, inspection_lead_options: [{ user_id: userId, display_name: 'Alex Morgan', role_label: 'Inspector' }] } })
  let payload: Record<string, unknown> | undefined
  await page.route('**/functions/v1/command', async (route) => { payload = route.request().postDataJSON().envelope.payload; await route.fulfill({ json: { ok: true, data: { id: 'new-inspection' } } }) })
  await page.goto(`/org/${org}/inspections?new=1&home=${home.id}`)
  await expect(page.getByRole('heading', { name: 'Savoy 1 checklist' })).toBeVisible()
  await page.getByRole('button', { name: 'Add property-only item', exact: true }).click()
  await page.getByLabel('Space for additional item 1').selectOption('Kitchen')
  await page.getByLabel('Property-only item 1', { exact: true }).fill('Verify repaired island panel')
  await page.getByRole('button', { name: 'Choose lead inspector' }).click()
  await page.getByRole('option', { name: 'Alex Morgan Inspector' }).click()
  await page.screenshot({ path: testInfo.outputPath('property-only-checklist.png'), fullPage: true })
  await page.getByRole('button', { name: 'Create inspection', exact: true }).click()
  await expect.poll(() => payload).toBeTruthy()
  expect(payload).toMatchObject({ plan_checklist: true, plan_version: 3, home_id: home.id, additional_items: [{ section: 'Kitchen', label: 'Verify repaired island panel' }] })
  expect(payload).not.toHaveProperty('template_version_id')
  expect(plan.spaces[0].checklist_items).toEqual(['Cabinet doors are secure', 'Check island clearance'])
})

test('new checklist categories do not depend on work categories', async ({ page }) => {
  await mockWorkspace(page)
  await page.goto(`/org/${org}/settings/checklists/new`)
  await expect(page.getByLabel('Checklist category name')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Category', exact: true })).toHaveCount(0)
})


test('work-category settings and work editing controls are removed', async ({ page }) => {
  await mockWorkspace(page)
  const categoryRequests: string[] = []
  page.on('request', (request) => { if (request.url().includes('/work_categories')) categoryRequests.push(request.url()) })
  await page.goto(`/org/${org}/settings/calendars`)
  await expect(page.getByRole('heading', { name: 'Business calendars', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Work categories', exact: true })).toHaveCount(0)
  await page.goto(`/org/${org}/work/work-1`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Category', exact: true })).toHaveCount(0)
  await expect(page.getByText('Category and priority', { exact: true })).toHaveCount(0)
  expect(categoryRequests).toEqual([])
})


test('checklist dropdown searches the full catalog and supports keyboard selection', async ({ page }, testInfo) => {
  const categories = standardSpaceTypes.map((space) => ({ ...category, id: `version-${space.code}`, template_id: `category-${space.code}`, checklist_templates: { ...category.checklist_templates, name: space.label } }))
  await mockWorkspace(page, { tables: { master_plans: [plan], checklist_versions: categories, space_types: [{ code: 'kitchen', label: 'Kitchen', active: true }, { code: 'bedroom', label: 'Bedroom', active: true }] } })
  await page.goto(`/org/${org}/plans`)
  await page.getByRole('button', { name: 'Edit floor plan', exact: true }).click()
  const dropdown = page.getByRole('combobox', { name: 'Import checklist category for Bedroom 1', exact: true })
  await dropdown.fill('WALK IN')
  await expect(page.getByRole('option', { name: 'Walk-in closet · v1', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Walk-in pantry · v1', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Kitchen · v1', exact: true })).toHaveCount(0)
  await dropdown.fill('unmatched category')
  await expect(page.getByRole('status')).toContainText('No checklist categories found')
  await dropdown.fill('bathroom')
  await dropdown.press('ArrowDown')
  await dropdown.press('Enter')
  await expect(page.getByText(/Imported \d+ checklist item/)).toBeVisible()
  await expect(dropdown).toHaveValue('')
  await expect(dropdown).toHaveAttribute('aria-expanded', 'false')
  await dropdown.fill('kitchen')
  await dropdown.press('Escape')
  await expect(dropdown).toHaveValue('')
  await dropdown.click()
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(categories.length)
  await dropdown.fill('bedroom')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('searchable-checklist-dropdown.png'), fullPage: true })
  await dropdown.press('Escape')
})
