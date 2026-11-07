import { expect, test } from '@playwright/test'
import { mockWorkspace, org, userId, work } from './fixtures/workspace'

test('assignee confirms completion with evidence and may cancel without changing work', async ({ page }, testInfo) => {
  const item = { ...work, state: 'assigned' }
  await mockWorkspace(page, { tables: { work_item_list: item, work_completion_context: { can_complete: true, evidence_exception_id: null }, attachments: [{ id: 'evidence1', original_name: 'repair-finished.jpg', status: 'ready', visibility: 'shared', purpose: 'correction', correction_attempt_id: null, byte_size: 1000 }] } })
  let payload: Record<string, unknown> | undefined
  let command = ''
  await page.route('**/functions/v1/command', async (route) => { const body = route.request().postDataJSON(); command = body.command_name; payload = body.envelope.payload; item.state = 'ready_for_verification'; await route.fulfill({ json: { ok: true, data: { id: item.id, version: 3 } } }) })
  await page.goto(`/org/${org}/work/${item.id}`)
  await expect(page.getByRole('button', { name: 'Acknowledge work', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Mark as completed', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Mark as completed?', exact: true })
  await expect(modal).toBeVisible()
  await modal.getByRole('button', { name: 'Keep working', exact: true }).click()
  expect(payload).toBeUndefined()
  await page.getByRole('button', { name: 'Mark as completed', exact: true }).click()
  await modal.getByLabel('Completion note', { exact: true }).fill('Replaced the cabinet door and aligned the hinges.')
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`completion-modal-${width}.png`), fullPage: true })
  }
  await modal.getByRole('button', { name: 'Confirm completion', exact: true }).click()
  await expect(modal).not.toBeVisible()
  expect(command).toBe('submit_correction')
  expect(payload).toMatchObject({ item_id: item.id, note: 'Replaced the cabinet door and aligned the hinges.', attachment_ids: ['evidence1'] })
  await expect(page.getByText('Completion submitted. Your supervisor can now review the work.', { exact: true })).toBeVisible()
})

test('completion needs evidence and supervisor reviews from the action panel', async ({ page }, testInfo) => {
  await mockWorkspace(page, { tables: { work_item_list: { ...work, state: 'assigned' }, work_completion_context: { can_complete: true, evidence_exception_id: null }, attachments: [] } })
  await page.goto(`/org/${org}/work/${work.id}`)
  await page.getByRole('button', { name: 'Mark as completed', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Confirm completion', exact: true })).toBeDisabled()
  await page.getByRole('dialog').getByRole('button', { name: 'Keep working', exact: true }).click()
  await mockWorkspace(page, { tables: { work_item_list: { ...work, state: 'ready_for_verification' }, work_completion_context: { can_complete: false, can_review: true, can_request_reinspection: true, evidence_exception_id: null }, correction_attempts: [{ id: 'attempt1', attempt_number: 1, completion_note: 'Door repaired; photo attached.', submitted_at: '2026-11-04T12:00:00Z' }] } })
  await page.reload()
  await page.getByRole('button', { name: 'Review completion', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Supervisor completion review', exact: true })).toBeVisible()
  await expect(page.getByText('Door repaired; photo attached.', { exact: true })).toBeVisible()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`supervisor-work-${width}.png`), fullPage: true })
  }
})

test('a new completion requires new correction evidence and leaves earlier evidence linked to its attempt', async ({ page }) => {
  const item = { ...work, state: 'assigned' }
  const files = [
    { id: 'old-file', original_name: 'previous-attempt.png', status: 'ready', visibility: 'shared', purpose: 'correction', correction_attempt_id: 'old-attempt' },
    { id: 'before-file', original_name: 'original-observation.png', status: 'ready', visibility: 'shared', purpose: 'observation', correction_attempt_id: null }
  ]
  await mockWorkspace(page, { tables: { work_item_list: item, work_completion_context: { can_complete: true }, attachments: files } })
  await page.route('**/functions/v1/request-upload', async (route) => {
    const file = { id: 'fresh-file', original_name: 'new-completion.png', status: 'ready', visibility: 'shared', purpose: 'correction', correction_attempt_id: null }
    files.push(file)
    await route.fulfill({ json: { attachment: file } })
  })
  let submitted: Record<string, unknown> | undefined
  await page.route('**/functions/v1/command', async (route) => {
    submitted = route.request().postDataJSON().envelope.payload
    item.state = 'ready_for_verification'
    await route.fulfill({ json: { ok: true, data: { id: item.id, version: 3 } } })
  })
  await page.goto(`/org/${org}/work/${item.id}`)
  await page.getByRole('button', { name: 'Mark as completed', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Completion note', { exact: true }).fill('The remaining hinge has been repaired.')
  await expect(dialog.getByRole('button', { name: 'Confirm completion', exact: true })).toBeDisabled()
  await dialog.getByLabel('Completion evidence file', { exact: true }).setInputFiles({ name: 'new-completion.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) })
  await expect(dialog.getByText('new-completion.png', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Confirm completion', exact: true }).click()
  expect(submitted?.attachment_ids).toEqual(['fresh-file'])
  expect(files[0].correction_attempt_id).toBe('old-attempt')
})

for (const decision of ['accepted', 'rejected']) {
  test(`supervisor ${decision === 'accepted' ? 'approves their own completed repair without reinspection' : 'returns completion for correction'}`, async ({ page }) => {
    const item = { ...work, state: 'ready_for_verification', version: 7 }
    await mockWorkspace(page, { tables: { work_item_list: item, work_completion_context: { can_complete: false, can_review: true, can_request_reinspection: true }, correction_attempts: [{ id: 'attempt1', attempt_number: 1, completion_note: 'Door repaired.', submitted_by: userId, accountable_internal_user_id: userId, submitted_at: '2026-11-05T12:00:00Z' }] } })
    let sent: Record<string, unknown> | undefined
    await page.route('**/functions/v1/command', async (route) => {
      const body = route.request().postDataJSON()
      expect(body.command_name).toBe('verify_correction')
      expect(body.envelope.expected_version).toBe(7)
      sent = body.envelope.payload
      item.state = decision === 'accepted' ? 'verified' : 'rework_required'
      item.version++
      await route.fulfill({ json: { ok: true, data: { id: item.id, version: item.version, state: item.state } } })
    })
    await page.goto(`/org/${org}/work/${item.id}?tab=review`)
    await expect(page.getByRole('heading', { name: 'Supervisor completion review', exact: true })).toBeVisible()
    await expect(page.getByText('Request reinspection (optional)', { exact: true })).toBeVisible()
    await page.getByRole('combobox', { name: 'Decision', exact: true }).selectOption(decision)
    await page.getByRole('combobox', { name: 'Review method', exact: true }).selectOption('remote')
    await page.getByRole('textbox', { name: 'Review notes', exact: true }).fill(decision === 'accepted' ? 'Evidence shows the door is aligned.' : 'Adjust the remaining hinge.')
    await page.getByLabel('I reviewed the completed work using the selected method.', { exact: true }).check()
    await page.getByRole('button', { name: 'Save supervisor decision', exact: true }).click()
    await expect(page.getByRole('status')).toContainText(decision === 'accepted' ? 'Completion accepted. This work item is closed.' : 'Work returned for correction.')
    expect(sent).toMatchObject({ item_id: item.id, decision, method: 'remote' })
  })
}

test('contributor needs review permission and pending reinspection waits for assigned Inspector', async ({ page }) => {
  const reason = 'An authorized supervisor will review this completion.'
  await mockWorkspace(page, { permissions: ['work.read_scope', 'work.execute_assigned'], tables: { work_item_list: { ...work, state: 'ready_for_verification' }, work_completion_context: { can_complete: false, can_review: false, can_request_reinspection: false, review_block_reason: reason } } })
  await page.goto(`/org/${org}/work/${work.id}?tab=review`)
  await expect(page.getByRole('button', { name: 'Review completion', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save supervisor decision', exact: true })).toHaveCount(0)
  await expect(page.getByText(reason, { exact: true }).last()).toBeVisible()
  await mockWorkspace(page, { tables: { work_item_list: { ...work, state: 'ready_for_verification', reinspection_status: 'pending', reinspection_assignee_user_id: 'another-inspector' }, work_completion_context: { can_complete: false, can_review: false, can_request_reinspection: false, review_block_reason: 'Waiting for the assigned Inspector’s reinspection decision.' } } })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Optional reinspection requested', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save supervisor decision', exact: true })).toHaveCount(0)
  await expect(page.getByText('Request reinspection (optional)', { exact: true })).toHaveCount(0)
})
