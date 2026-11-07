import { expect, test } from '@playwright/test'
import { home, mockWorkspace, neighborhood, org, userId } from './fixtures/workspace'

const questions = [
  { id: 'q1', ordinal: 1, section: 'Kitchen', label: 'Cabinet doors aligned', requires_response: true },
  { id: 'q2', ordinal: 2, section: 'Bedroom', label: 'Window operates', requires_response: true }
]
const inspection = { id: 'report-test', organization_id: org, neighborhood_id: neighborhood.id, home_id: home.id, lot_code: '104', address_line1: home.address_line1, status: 'in_progress', type: 'internal_quality', template_version_id: 'version1', lead_inspector_user_id: userId, version: 1, current_revision: 1, updated_at: '2026-11-04T12:00:00Z' }

test('space selection preserves drafts and each item offers media upload', async ({ page }, testInfo) => {
  await mockWorkspace(page, { tables: { inspections: inspection, checklist_questions: questions, attachments: [], inspection_repair_readiness: [] } })
  await page.goto(`/org/${org}/inspections/${inspection.id}`)
  await page.getByLabel('Notes for Cabinet doors aligned', { exact: true }).fill('Kitchen draft stays saved in memory')
  await expect(page.getByLabel('Upload media for Cabinet doors aligned', { exact: true })).toBeAttached()
  await page.getByLabel('Select space', { exact: true }).selectOption('Bedroom')
  await expect(page.getByLabel('Notes for Cabinet doors aligned', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Upload media for Window operates', { exact: true })).toBeAttached()
  await page.getByLabel('Select space', { exact: true }).selectOption('Kitchen')
  await expect(page.getByLabel('Notes for Cabinet doors aligned', { exact: true })).toHaveValue('Kitchen draft stays saved in memory')
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`field-sheet-${width}.png`), fullPage: true })
  }
})

test('submitted inspection becomes a report with inline assigned repair creation', async ({ page }, testInfo) => {
  const observation = { id: 'obs1', organization_id: org, inspection_id: inspection.id, home_id: home.id, neighborhood_id: neighborhood.id, question_id: 'q1', title: 'Cabinet hinge loose', description: 'Secure the hinge and check alignment.', space_name: 'Kitchen', priority: 'high', safety_flag: false, status: 'open', version: 1, work_items: [] }
  await mockWorkspace(page, { tables: { inspections: { ...inspection, status: 'submitted' }, checklist_questions: questions, inspection_responses: [{ id: 'response1', question_id: 'q1', result: 'fail', explanation: observation.description }], inspection_observations: [observation], attachments: [], inspection_repair_readiness: [] } })
  await page.goto(`/org/${org}/inspections/${inspection.id}`)
  await expect(page.getByText('PROPERTY INSPECTION REPORT', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Result for Cabinet doors aligned', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Add repair task', exact: true }).click()
  const task = page.getByRole('group', { name: 'Repair task 1', exact: true })
  await task.getByRole('combobox', { name: 'Assignee', exact: true }).selectOption(userId)
  await task.getByLabel('Due date', { exact: true }).fill('2026-11-09T10:00')
  let payload: Record<string, unknown> | undefined
  await page.route('**/functions/v1/command', async (route) => { payload = route.request().postDataJSON().envelope.payload; await route.fulfill({ json: { ok: true, data: { id: 'repair1' } } }) })
  await page.getByRole('button', { name: 'Create and assign 1 repair task', exact: true }).click()
  await expect.poll(() => payload).toBeTruthy()
  expect(payload).toMatchObject({ observation_id: 'obs1', tasks: [{ title: observation.title, assignment: { accountable_internal_user_id: userId } }] })
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`submitted-report-${width}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: 'Complete inspection record', exact: false }).click()
  await expect(page.getByText('Needs repair', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Media for Cabinet doors aligned' })).toBeVisible()
})

test('item evidence completes reservation, upload and validation for the selected question', async ({ page }) => {
  const attachments: Record<string, unknown>[] = []
  await mockWorkspace(page, { tables: { inspections: inspection, checklist_questions: questions, attachments, inspection_repair_readiness: [] } })
  const attachment = { id: 'media1', organization_id: org, neighborhood_id: neighborhood.id, home_id: home.id, inspection_id: inspection.id, question_id: 'q1', original_name: 'cabinet.png', mime_type: 'image/png', byte_size: 8, status: 'ready' }
  let reserved: Record<string, unknown> | undefined
  await page.route('**/rest/v1/rpc/request_inspection_item_media', async (route) => { reserved = route.request().postDataJSON(); await route.fulfill({ json: attachment }) })
  await page.route('**/functions/v1/request-upload', (route) => route.fulfill({ json: { attachment, upload: { path: 'test/original', token: 'token' } } }))
  await page.route('**/storage/v1/**', (route) => route.fulfill({ json: { Key: 'test/original' } }))
  await page.route('**/functions/v1/finalize-upload', async (route) => { attachments.push(attachment); await route.fulfill({ json: { attachment } }) })
  await page.goto(`/org/${org}/inspections/${inspection.id}`)
  await page.getByLabel('Upload media for Cabinet doors aligned', { exact: true }).setInputFiles({ name: 'cabinet.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) })
  await expect(page.getByRole('button', { name: /cabinet.png/ })).toBeVisible()
  expect(reserved).toMatchObject({ p_inspection: inspection.id, p_question: 'q1', p_name: 'cabinet.png' })
})

test('saving draft answers and submitting uses the newly saved inspection version', async ({ page }) => {
  const current = { ...inspection }
  const responses: Record<string, unknown>[] = []
  const commands: Array<{ name: string; version: number }> = []
  await mockWorkspace(page, { tables: { inspections: current, checklist_questions: questions, inspection_responses: responses, attachments: [], inspection_repair_readiness: [] } })
  await page.route('**/functions/v1/command', async (route) => {
    const body = route.request().postDataJSON()
    commands.push({ name: body.command_name, version: body.envelope.expected_version })
    if (body.command_name === 'save_inspection_responses') {
      for (const response of body.envelope.payload.responses) responses.push({ id: response.question_id, question_id: response.question_id, result: response.response })
      current.version++
    } else if (body.command_name === 'submit_inspection') {
      current.status = 'submitted'
      current.version++
    }
    await route.fulfill({ json: { ok: true, data: { id: current.id, version: current.version, status: current.status } } })
  })
  await page.goto(`/org/${org}/inspections/${current.id}`)
  await page.getByRole('button', { name: 'Checked: Cabinet doors aligned', exact: true }).click()
  await page.getByLabel('Select space', { exact: true }).selectOption('Bedroom')
  await page.getByRole('button', { name: 'Checked: Window operates', exact: true }).click()
  await page.getByRole('button', { name: 'Submit inspection', exact: true }).click()
  await expect(page.getByText('PROPERTY INSPECTION REPORT', { exact: true })).toBeVisible()
  expect(commands).toEqual([{ name: 'save_inspection_responses', version: 1 }, { name: 'submit_inspection', version: 2 }])
})
