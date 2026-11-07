import { expect, test, type Page } from '@playwright/test'
import { home, mockWorkspace, neighborhood, org, userId } from './fixtures/workspace'
import type { InspectionObservation } from '../../src/features/inspections/qualityData'

const questions = [
  { id: 'q-kitchen', version_id: 'version-1', ordinal: 1, section: 'Kitchen', label: 'Cabinet doors aligned', requires_response: true },
  { id: 'q-bedroom', version_id: 'version-1', ordinal: 2, section: 'Bedroom 1', label: 'Bedroom window operates', requires_response: true }
]
const inspectionBase = { id: 'flow-inspection', organization_id: org, neighborhood_id: neighborhood.id, home_id: home.id, lot_code: home.lot_code, status: 'in_progress', type: 'internal_quality', template_version_id: 'version-1', lead_inspector_user_id: userId, version: 1, current_revision: 1, reviewed_at: null as string | null }
const issue = (id: string): InspectionObservation => ({ id, organization_id: org, inspection_id: inspectionBase.id, home_id: home.id, neighborhood_id: neighborhood.id, question_id: questions[0].id, location_id: 'kitchen', space_name: 'Kitchen', title: 'Damaged cabinet panel and hinge', description: 'Replace the panel and realign the hinge.', priority: 'normal', safety_flag: false, status: 'open', version: 1, review_notes: null, work_items: [] })
async function workspace(page: Page, reviewing = false) {
  const inspection = { ...inspectionBase, status: reviewing ? 'submitted' : 'in_progress' }
  const observations: InspectionObservation[] = reviewing ? [issue('observation-1')] : []
  const responses: Array<Record<string, unknown>> = []
  const calls: Array<{ command_name: string; envelope: { payload: Record<string, unknown> } }> = []
  await mockWorkspace(page, { ...(reviewing ? {} : { permissions: ['inspection.perform', 'inspection.findings.create', 'evidence.upload'] }), tables: {
    inspections: inspection, checklist_questions: questions, inspection_responses: responses, inspection_observations: observations,
    home_locations: [{ id: 'kitchen', name: 'Kitchen', active: true, home_id: home.id, organization_id: org }], work_items: [],
    inspection_repair_readiness: [], neighborhood_trade_rosters: [{ organization_id: org, neighborhood_id: neighborhood.id, status: 'active', company_id: 'company-1', companies: { id: 'company-1', name: 'Cedar Carpentry' } }]
  } })
  await page.route('**/functions/v1/command', async (route) => {
    const body = route.request().postDataJSON(); const payload = body.envelope.payload
    calls.push(body)
    if (body.command_name === 'record_inspection_observation') observations.push({ ...issue(payload.id), ...payload, question_id: payload.question_id ?? null })
    if (body.command_name === 'upsert_inspection_response') { responses.push({ id: `response-${responses.length}`, question_id: payload.question_id, result: payload.response, explanation: payload.reason, finding_work_item_id: null }); inspection.version += 1 }
    if (body.command_name === 'save_inspection_responses') for (const answer of payload.responses) {
      const response = { id: `response-${answer.question_id}`, question_id: answer.question_id, result: answer.response, explanation: answer.reason, finding_work_item_id: null }
      const index = responses.findIndex((row) => row.question_id === answer.question_id)
      if (index < 0) responses.push(response); else responses[index] = response
      if (answer.response === 'fail') {
        const existing = observations.find((row) => row.question_id === answer.question_id && row.status === 'open')
        if (existing) existing.description = answer.reason
        else observations.push({ ...issue(answer.observation_id), question_id: answer.question_id, title: answer.title, description: answer.reason })
      } else for (const row of observations) if (row.question_id === answer.question_id && row.status === 'open') row.status = 'disregarded'
    }
    if (body.command_name === 'submit_inspection') inspection.status = 'submitted'
    if (body.command_name === 'create_observation_work') {
      observations[0].status = 'actioned'; observations[0].version += 1
      observations[0].work_items = payload.tasks.map((task: { title: string }, index: number) => ({ id: `repair-${index}`, title: task.title, home_id: home.id, observation_id: observations[0].id, version: 1, state: 'assigned', reinspection_status: null }))
    }
    if (body.command_name === 'review_inspection') inspection.reviewed_at = new Date().toISOString()
    await route.fulfill({ json: { ok: true, data: { id: payload.id ?? inspection.id, version: inspection.version } } })
  })
  return { inspection, observations, responses, calls }
}

test('Inspector checks rooms, saves notes and item/general observations without creating work', async ({ page }, testInfo) => {
  const state = await workspace(page)
  await page.goto(`/org/${org}/inspections/${inspectionBase.id}`)
  const kitchen = page.getByRole('region', { name: 'Checklist for Kitchen', exact: true })
  await kitchen.getByRole('combobox', { name: 'Result for Cabinet doors aligned', exact: true }).selectOption('fail')
  await kitchen.getByRole('textbox', { name: 'What needs fixing for Cabinet doors aligned', exact: true }).fill('Replace the damaged panel beside the sink.')
  await page.getByRole('button', { name: 'Save draft', exact: true }).first().click()
  await expect(kitchen.getByText(/Saved observation/)).toBeVisible()
  await page.getByLabel('Select space', { exact: true }).selectOption('Bedroom 1')
  const bedroom = page.getByRole('region', { name: 'Checklist for Bedroom 1', exact: true })
  await bedroom.getByRole('button', { name: 'Checked: Bedroom window operates', exact: true }).click()
  await bedroom.getByRole('textbox', { name: 'Notes for Bedroom window operates', exact: true }).fill('Window opens and latches correctly.')
  await page.getByRole('button', { name: 'Save draft', exact: true }).first().click()
  await page.getByRole('button', { name: 'Add additional observation', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Submit inspection', exact: true })).toBeDisabled()
  const extra = page.getByRole('form', { name: 'Record additional observation', exact: true })
  await extra.getByRole('combobox', { name: 'Room or area', exact: true }).selectOption('kitchen')
  await extra.getByRole('textbox', { name: 'Observation title', exact: true }).fill('Loose trim')
  await extra.getByRole('textbox', { name: 'What needs fixing?', exact: true }).fill('Refix the loose entry trim.')
  await extra.getByRole('button', { name: 'Save observation', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Submit inspection', exact: true })).toBeEnabled()
  expect(state.calls.some((call) => call.command_name === 'create_work_item')).toBe(false)
  expect(state.observations).toHaveLength(2)
  expect(state.responses.find((row) => row.question_id === questions[1].id)).toMatchObject({ result: 'pass', explanation: 'Window opens and latches correctly.' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('inspector-room-checklist.png'), fullPage: true })
  await page.getByRole('button', { name: 'Submit inspection', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Submit inspection', exact: true })).toHaveCount(0)
})

test('reviewer splits an observation into separately assigned repair tasks', async ({ page }, testInfo) => {
  const state = await workspace(page, true)
  await page.goto(`/org/${org}/inspections/${inspectionBase.id}`)
  const review = page.getByRole('region', { name: 'Observation repair planning', exact: true })
  await review.getByRole('button', { name: 'Add repair task', exact: true }).click()
  await review.getByRole('button', { name: 'Add repair task', exact: true }).click()
  const first = review.getByRole('group', { name: 'Repair task 1', exact: true })
  await first.getByRole('textbox', { name: 'Task title', exact: true }).fill('Replace cabinet panel')
  await first.getByRole('combobox', { name: 'Assignee', exact: true }).selectOption(userId)
  await first.getByLabel('Due date', { exact: true }).fill('2026-11-06T10:00')
  const second = review.getByRole('group', { name: 'Repair task 2', exact: true })
  await second.getByRole('textbox', { name: 'Task title', exact: true }).fill('Align cabinet hinge')
  await second.getByRole('combobox', { name: 'Assign task to', exact: true }).selectOption('company')
  await second.getByRole('combobox', { name: 'Assignee', exact: true }).selectOption('company-1')
  await second.getByLabel('Due date', { exact: true }).fill('2026-11-07T10:00')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('observation-repair-planning.png'), fullPage: true })
  await review.getByRole('button', { name: 'Create and assign 2 repair tasks', exact: true }).click()
  await expect(review.getByRole('link', { name: /Replace cabinet panel/ })).toBeVisible()
  const create = state.calls.find((call) => call.command_name === 'create_observation_work')!
  expect(create.envelope.payload).toMatchObject({ observation_id: 'observation-1', tasks: [{ title: 'Replace cabinet panel', assignment: { accountable_internal_user_id: userId, company_id: null } }, { title: 'Align cabinet hinge', assignment: { accountable_internal_user_id: null, company_id: 'company-1' } }] })
  await page.getByRole('button', { name: 'Complete report review', exact: true }).click()
  await expect(page.getByText('This report has been reviewed.', { exact: false })).toBeVisible()
})

test('superintendent sees completed property repairs awaiting supervisor review', async ({ page }) => {
  await mockWorkspace(page, { tables: { inspection_repair_readiness: [{ home_id: home.id, lot_code: home.lot_code, observation_count: 2, unreviewed_count: 0, repair_count: 3, incomplete_count: 0, ready_for_reinspection: true }] } })
  await page.goto(`/org/${org}/inspections`)
  await expect(page.getByText('Lot 104 has completions ready for supervisor review', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Review property repairs', exact: true })).toHaveAttribute('href', `/org/${org}/homes/${home.id}?tab=inspections`)
})


test('offline checklist notes and observations survive reload and synchronize once', async ({ page }) => {
  const state = await workspace(page)
  await page.goto(`/org/${org}/inspections/${inspectionBase.id}`)
  await expect(page.getByRole('button', { name: 'Checked: Cabinet doors aligned', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open('buildtrack-offline-v1'); request.onsuccess = () => resolve(request.result) })
    return new Promise<boolean>((resolve) => { const request = db.transaction('cache').objectStore('cache').getAll(); request.onsuccess = () => { resolve(request.result.some((row) => row.entity_type === 'field_context' && row.entity_id === 'inspection:flow-inspection')); db.close() } })
  })).toBe(true)
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }))
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); window.dispatchEvent(new Event('offline')) })
  const kitchen = page.getByRole('region', { name: 'Checklist for Kitchen', exact: true })
  await kitchen.getByRole('combobox', { name: 'Result for Cabinet doors aligned', exact: true }).selectOption('fail')
  await kitchen.getByRole('textbox', { name: 'What needs fixing for Cabinet doors aligned', exact: true }).fill('Replace the loose panel recorded offline.')
  await page.getByRole('button', { name: 'Save draft', exact: true }).first().click()
  expect(state.calls).toHaveLength(0)
  await page.route('**/rest/v1/inspections?*', (route) => route.abort())
  await page.reload()
  await expect(kitchen.getByRole('textbox', { name: 'What needs fixing for Cabinet doors aligned', exact: true })).toHaveValue('Replace the loose panel recorded offline.')
  await expect(kitchen.getByRole('combobox', { name: 'Result for Cabinet doors aligned', exact: true })).toHaveValue('fail')
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }); window.dispatchEvent(new Event('online')) })
  await expect.poll(() => state.calls.filter((call) => call.command_name === 'save_inspection_responses').length, { timeout: 30000 }).toBe(1)
  expect(state.calls.find((call) => call.command_name === 'save_inspection_responses')?.envelope.payload.responses).toMatchObject([{ question_id: 'q-kitchen', response: 'fail', reason: 'Replace the loose panel recorded offline.' }])
})
