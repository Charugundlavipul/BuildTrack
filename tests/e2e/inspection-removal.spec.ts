import { expect, test, type Page } from '@playwright/test'
import { home, mockWorkspace, neighborhood, org, userId } from './fixtures/workspace'

const inspection = { id: 'inspection-1', organization_id: org, neighborhood_id: neighborhood.id, home_id: home.id, type: 'internal_quality', status: 'in_progress', version: 1, current_revision: 1, template_version_id: 'template-1', lead_inspector_user_id: userId, updated_at: '2026-11-04T12:00:00Z' }
const questions = [
  { id: 'question-1', ordinal: 1, section: 'Kitchen', label: 'Kitchen finishes', requires_response: true },
  { id: 'question-2', ordinal: 2, section: 'Bedroom', label: 'Bedroom window', requires_response: true }
]

async function openInspection(page: Page) {
  const path = `/org/${org}/inspections/${inspection.id}`
  await page.goto(path)
  const heading = page.getByRole('heading', { name: 'Internal Quality', exact: true })
  const picker = page.getByRole('heading', { name: 'Select an organization' })
  await expect.poll(async () => await heading.isVisible() || await picker.isVisible(), { timeout: 15000 }).toBe(true)
  if (await picker.isVisible()) {
    await page.getByRole('button', { name: /Cedar Homes America/ }).click()
    await page.goto(path)
  }
  await expect(heading).toBeVisible()
}

test('space selection preserves drafts and an administrator can remove an inspection after confirmation', async ({ page }) => {
  await mockWorkspace(page, { tables: { inspections: inspection, checklist_questions: questions, inspection_responses: [] } })
  let request: Record<string, unknown> | undefined
  await page.route('**/rest/v1/rpc/remove_inspection', async (route) => { request = route.request().postDataJSON(); await route.fulfill({ json: { id: inspection.id, removed: true } }) })
  await openInspection(page)
  await expect(page.getByRole('button', { name: 'Submit inspection', exact: true })).toBeVisible()
  await expect(page.getByText('REVISION 1', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Kitchen finishes' })).toBeVisible()
  await page.getByRole('radio', { name: 'Pass', exact: true }).check()
  await page.getByLabel('Select space').selectOption('Bedroom')
  await expect(page.getByRole('heading', { name: 'Bedroom window' })).toBeVisible()
  await page.getByLabel('Select space').selectOption('Kitchen')
  await expect(page.getByRole('radio', { name: 'Pass', exact: true })).toBeChecked()
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: 'Delete inspection' }).click()
  expect(request).toBeUndefined()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete inspection' }).click()
  await expect.poll(() => request).toMatchObject({ p_organization_id: org, p_inspection_id: inspection.id, p_expected_version: 1 })
  await expect(page).toHaveURL(`/org/${org}/inspections`)
})

test('inspectors do not receive the delete action', async ({ page }) => {
  const access = { organization_id: org, user_id: userId, profile: { display_name: 'Inspector', timezone: 'UTC' }, membership: { affiliation: 'internal', status: 'active' }, permissions: ['inspection.perform'], roles: [{ role_code: 'inspector', scope_kind: 'neighborhood', neighborhood_id: neighborhood.id }], companies: [] }
  await mockWorkspace(page, { tables: { current_access: access, inspections: inspection, checklist_questions: questions, inspection_responses: [] } })
  await openInspection(page)
  await expect(page.getByRole('heading', { name: 'Kitchen finishes' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete inspection' })).toHaveCount(0)
})

test('a submitted inspection links its findings to work assignment', async ({ page }) => {
  await mockWorkspace(page, { tables: {
    inspections: { ...inspection, status: 'submitted' },
    checklist_questions: questions,
    inspection_responses: [{ id: 'response-1', question_id: 'question-1', result: 'fail', explanation: 'Repair the finish', finding_work_item_id: 'work-1' }]
  } })
  await openInspection(page)
  const findings = page.getByRole('region', { name: 'Inspection findings to assign' })
  await expect(findings.getByText('Kitchen finishes')).toBeVisible()
  await expect(findings.getByRole('link', { name: 'Open work item' })).toHaveAttribute('href', `/org/${org}/work/work-1`)
  await expect(page.getByRole('button', { name: 'Edit submitted answers' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Begin amendment' })).toHaveCount(0)
})

test('a supervisor can create and assign repair work from a submitted finding', async ({ page }) => {
  const finding = { id: 'observation-1', organization_id: org, inspection_id: inspection.id, home_id: home.id, neighborhood_id: neighborhood.id, title: 'Repair kitchen finish', description: 'Repair the damaged wall', priority: 'normal', status: 'open', version: 2, work_items: [] }
  await mockWorkspace(page, { tables: { inspections: { ...inspection, status: 'submitted' }, checklist_questions: questions, inspection_responses: [], inspection_observations: [finding] } })
  let command: Record<string, unknown> | undefined
  await page.route('**/functions/v1/command', async (route) => { command = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, data: { id: 'work-new' } } }) })
  await openInspection(page)
  const planning = page.getByRole('region', { name: 'Inspection repair planning' })
  await expect(planning.getByText('Repair kitchen finish')).toBeVisible()
  await planning.getByRole('button', { name: 'Add work item' }).click()
  await planning.getByRole('combobox', { name: 'Assignee', exact: true }).selectOption(userId)
  await planning.getByLabel('Due date').fill('2027-01-01T12:00')
  await planning.getByRole('button', { name: 'Create and assign' }).click()
  await expect.poll(() => command).toMatchObject({ command_name: 'create_observation_work', envelope: { expected_version: 2, payload: { observation_id: finding.id, tasks: [{ title: finding.title, assignment: { accountable_internal_user_id: userId } }] } } })
})

test('an amended inspection explains that the update must be submitted before creating new work', async ({ page }) => {
  const finding = { id: 'observation-1', organization_id: org, inspection_id: inspection.id, home_id: home.id, neighborhood_id: neighborhood.id, title: 'Repair kitchen finish', description: 'Repair the damaged wall', priority: 'normal', status: 'open', version: 2, work_items: [] }
  await mockWorkspace(page, { tables: { inspections: { ...inspection, status: 'amended', current_revision: 2 }, checklist_questions: questions, inspection_responses: [], inspection_observations: [finding] } })
  await openInspection(page)
  const planning = page.getByRole('region', { name: 'Inspection repair planning' })
  await expect(planning.getByText(/Submit the updated inspection before creating new repair work/)).toBeVisible()
  await expect(planning.getByRole('button', { name: 'Add work item' })).toHaveCount(0)
})

test('the dashboard does not show the outdated independent-closure banner', async ({ page }) => {
  await mockWorkspace(page)
  await page.goto(`/org/${org}/my-work`)
  await expect(page.getByRole('heading', { name: 'My work' })).toBeVisible()
  await expect(page.getByText('Closure stays independent')).toHaveCount(0)
})
