import { expect, test } from '@playwright/test'
import { home, mockWorkspace, neighborhood, org, work } from './fixtures/workspace'

const external = { user_id: 'inspector-1', display_name: 'Jamie Inspector', affiliation: 'external' }
const fixtures = {
  business_calendars: [{ id: 'calendar-1', name: 'Field operations', timezone: 'America/New_York', working_weekdays: [1, 2, 3, 4, 5, 6], local_start_time: '07:00:00', local_end_time: '16:00:00', holiday_dates: ['2026-12-25'] }],
  checklist_templates: [{ id: 'checklist-1', name: 'Final quality', active: true }],
  checklist_versions: [{ id: 'version-1', template_id: 'checklist-1', number: 1, published_at: null }],
  checklist_questions: [{ id: 'question-1', version_id: 'version-1', ordinal: 1, section: 'Interior', label: 'Cabinet doors aligned', requires_response: true }],
  inspection_engagements: [{ id: 'engagement-1', purpose: 'Final external inspection', home_id: home.id, neighborhood_id: neighborhood.id, inspector_user_id: external.user_id, starts_at: '2026-10-24T12:00:00Z', ends_at: '2026-11-01T12:00:00Z', revoked_at: null }],
  escalation_routes: [{ id: 'route-1', name: 'Site escalation', active: true }],
  escalation_route_steps: [{ id: 'step-1', route_id: 'route-1', level: 1, recipient_kind: 'supervisor', recipient_user_id: null }],
  notification_rules: [{ id: 'rule-1', trigger: 'work_due', enabled: true, business_minutes: 60, repeat_minutes: 120, max_repeats: 3, quiet_hours: {}, escalation_route_id: 'route-1', neighborhood_id: null }],
  home_milestones: [{ id: 'milestone-1', home_id: home.id, milestone_code: 'operational_readiness', planned_at: '2026-11-01T12:00:00Z', actual_at: null }],
  milestone_requirements: [{ id: 'requirement-1', home_id: home.id, milestone_code: 'operational_readiness', required_inspection_type: 'internal_quality', required: true }],
  participant_directory: [external]
}
test.use({ actionTimeout: 15000 })

test('operational directories and record pages fit desktop tablet and mobile', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await mockWorkspace(page, { tables: fixtures })
  const pages = [['calendars', 'calendar-1'], ['checklists', 'checklist-1'], ['engagements', 'engagement-1'], ['escalations', 'route-1'], ['notifications', 'rule-1'], ['milestones', 'milestone-1'], ['requirements', 'requirement-1']]
  for (const width of testInfo.project.name.startsWith('mobile') ? [390] : [1440, 768]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const [kind, id] of pages) {
      for (const suffix of ['', `/${id}`, '/new']) {
        await page.goto(`/org/${org}/settings/${kind}${suffix}`)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await expect(page.getByRole('heading', { name: suffix ? kind === 'checklists' ? 'Checklist category versions' : suffix === '/new' ? 'Record details' : 'Edit details' : undefined, level: suffix ? 2 : 1 }).first()).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
      }
    }
    await page.goto(`/org/${org}/settings/engagements/engagement-1`)
    await expect(page.getByRole('button', { name: 'Revoke grant', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`engagement-${width}.png`), fullPage: true })
  }
  expect(errors).toEqual([])
})

test('calendar editing preserves working days and reports invalid days before saving', async ({ page }) => {
  await mockWorkspace(page, { tables: fixtures })
  let body: Record<string, unknown> = {}
  await page.route('**/rest/v1/rpc/admin_save_business_calendar', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: fixtures.business_calendars[0] }) })
  await page.goto(`/org/${org}/settings/calendars/calendar-1`)
  await expect(page.getByRole('checkbox', { name: 'Saturday' })).toBeChecked()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Extended field week')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status')).toContainText('saved')
  expect(body).toMatchObject({ p_id: 'calendar-1', p_working_weekdays: [1, 2, 3, 4, 5, 6], p_holiday_dates: ['2026-12-25'] })
  for (const box of await page.getByRole('checkbox').all()) await box.uncheck()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('alert')).toContainText('at least one working day')
})

test('escalation levels hide irrelevant members and save their actual order', async ({ page }) => {
  await mockWorkspace(page, { tables: fixtures })
  let body: Record<string, unknown> = {}
  await page.route('**/rest/v1/rpc/admin_save_escalation_route', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: { id: 'route-1' } }) })
  await page.goto(`/org/${org}/settings/escalations/route-1`)
  await expect(page.getByRole('combobox', { name: 'Specific user' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Add level' }).click()
  const level = page.getByRole('group', { name: 'Level 2', exact: true })
  await level.getByRole('combobox', { name: 'Recipient' }).selectOption('specific_user')
  await level.getByRole('combobox', { name: 'Specific user' }).selectOption(external.user_id)
  await level.getByRole('button', { name: 'Move up' }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status')).toContainText('saved')
  expect(body.p_steps).toEqual([{ recipient_kind: 'specific_user', recipient_user_id: external.user_id }, { recipient_kind: 'supervisor', recipient_user_id: null }])
})

test('checklist draft survives failed publication and can be copied with structured questions', async ({ page }) => {
  await mockWorkspace(page, { tables: fixtures })
  let publishes = 0
  await page.route('**/rest/v1/rpc/admin_publish_checklist_version', async (route) => { publishes++; await route.fulfill({ status: 400, json: { message: 'Publication temporarily unavailable' } }) })
  await page.goto(`/org/${org}/settings/checklists/checklist-1`)
  await page.getByText('Version 1 · Draft · 1 questions', { exact: true }).click()
  await expect(page.getByText('Cabinet doors aligned', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Publish version', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm publication' }).click()
  await expect(page.getByRole('alert')).toContainText('Publication temporarily unavailable')
  await expect(page.getByText('Version 1 · Draft · 1 questions', { exact: true })).toBeVisible()
  expect(publishes).toBe(1)
  await page.getByRole('button', { name: 'Copy to new draft' }).click()
  await expect(page.getByRole('textbox', { name: 'Question', exact: true })).toHaveValue('Cabinet doors aligned')
  await page.getByRole('button', { name: 'Add question' }).click()
  await page.getByRole('textbox', { name: 'Question', exact: true }).nth(1).fill('Windows secured')
  let body: Record<string, unknown> = {}
  await page.route('**/rest/v1/rpc/admin_create_checklist_version', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: { template_id: 'checklist-1', version_id: 'version-2', number: 2 } }) })
  await page.getByRole('button', { name: 'Create draft version', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Draft version 2 created')
  expect(body.p_questions).toEqual([{ section: 'Interior', label: 'Cabinet doors aligned', requires_response: true }, { section: 'General', label: 'Windows secured', requires_response: true }])
  expect(publishes).toBe(1)
})

test('inspector grant revocation is explicit and uses only the existing grant ID', async ({ page }) => {
  await mockWorkspace(page, { tables: { ...fixtures, homes: [{ ...home, archived_at: '2026-10-25T12:00:00Z' }] } })
  let body: Record<string, unknown> = {}
  await page.route('**/rest/v1/rpc/admin_revoke_inspector_engagement', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: { ...fixtures.inspection_engagements[0], revoked_at: '2026-10-25T12:00:00Z' } }) })
  await page.goto(`/org/${org}/settings/engagements/engagement-1`)
  await page.getByRole('button', { name: 'Revoke grant', exact: true }).click()
  expect(body).toEqual({})
  await page.getByRole('button', { name: 'Confirm revocation' }).click()
  await expect(page.getByRole('status')).toContainText('Status updated')
  expect(body).toEqual({ p_organization_id: org, p_id: 'engagement-1' })
})

test('verification requires actual method notes and attestation instead of canned facts', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: testInfo.project.name.startsWith('mobile') ? 390 : 1440, height: 1000 })
  await mockWorkspace(page, { tables: { work_item_list: { ...work, state: 'ready_for_verification', safety_flag: true }, work_completion_context: { can_complete: false, can_review: true, can_request_reinspection: true } } })
  let body: { envelope?: { payload: Record<string, unknown> } } = {}
  await page.route('**/functions/v1/command', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, data: { id: work.id } } }) })
  await page.goto(`/org/${org}/work/${work.id}?tab=review`)
  await page.getByRole('combobox', { name: 'Decision', exact: true }).selectOption('rejected')
  const method = page.getByRole('combobox', { name: /Review method/ })
  await expect(method.getByRole('option', { name: 'Review completion evidence' })).toHaveCount(0)
  await method.selectOption('on_site')
  await page.getByRole('textbox', { name: 'Review notes' }).fill('Hinge still loose; replace the upper fastener.')
  await page.getByRole('checkbox', { name: /I reviewed the completed work/ }).check()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('verification-review.png'), fullPage: true })
  await page.getByRole('button', { name: 'Save supervisor decision' }).click()
  await expect.poll(() => body.envelope?.payload.notes).toBe('Hinge still loose; replace the upper fastener.')
  expect(body.envelope?.payload).toMatchObject({ method: 'on_site', decision: 'rejected' })
})

test('edited inspection answers can be saved as a draft before submission', async ({ page }) => {
  const responses = [{ id: 'response-1', question_id: 'question-1', result: 'pass', explanation: null, finding_work_item_id: null }]
  await mockWorkspace(page, { tables: { inspection_responses: responses } })
  await page.route('**/functions/v1/command', async (route) => { const { envelope } = route.request().postDataJSON(); const answer = envelope.payload.responses[0]; responses[0] = { ...responses[0], result: answer.response, explanation: answer.reason }; await route.fulfill({ json: { ok: true, data: {} } }) })
  await page.goto(`/org/${org}/inspections/inspection-1`)
  await expect(page.getByRole('button', { name: 'Submit inspection' })).toBeEnabled()
  await page.getByRole('combobox', { name: /^Result for/ }).selectOption('not_applicable')
  await page.getByRole('textbox', { name: /^Notes for/ }).fill('Not installed in this plan.')
  await expect(page.getByRole('button', { name: 'Submit inspection' })).toBeEnabled()
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Save draft', exact: true }).first().click()
  await expect(page.getByRole('button', { name: 'Submit inspection' })).toBeEnabled()
  await expect(page.getByText('Unsaved changes', { exact: true })).toHaveCount(0)
})

test('work queue reaches records beyond its first server page and filters before pagination', async ({ page }) => {
  const rows = Array.from({ length: 31 }, (_, index) => ({ ...work, id: `work-${index}`, title: `Repair ${index}` }))
  await mockWorkspace(page, { tables: { work_item_list: rows } })
  await page.goto(`/org/${org}/my-work`)
  await expect(page.getByText('1–25 of 31 items')).toBeVisible()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByText('26–31 of 31 items')).toBeVisible()
  await expect(page.getByRole('link', { name: /Repair 30/ })).toBeVisible()
  await page.getByRole('textbox', { name: 'Search work' }).fill('Repair 30')
  await expect(page.getByText('1–1 of 1 items')).toBeVisible()
})

test('configuration writes retain domain-specific permission with MFA disabled', async ({ page }) => {
  await mockWorkspace(page, { aal: 'aal1', permissions: ['structure.manage'], tables: fixtures })
  await page.goto(`/org/${org}/settings/milestones/milestone-1`)
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  await expect(page.getByRole('link', { name: 'Inspection requirements', exact: true })).toHaveCount(0)
  await page.goto(`/org/${org}/settings/engagements`)
  await expect(page.getByRole('heading', { name: 'Access not granted' })).toBeVisible()
})

test('failed configuration saves retain input and notification quiet fields follow the toggle', async ({ page }) => {
  await mockWorkspace(page, { tables: fixtures })
  await page.route('**/rest/v1/rpc/admin_save_notification_rule', async (route) => route.fulfill({ status: 400, json: { message: 'Escalation route is unavailable' } }))
  await page.goto(`/org/${org}/settings/notifications/rule-1`)
  await expect(page.getByLabel('Quiet starts', { exact: true })).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Use quiet hours' }).check()
  await expect(page.getByLabel('Quiet starts', { exact: true })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Use quiet hours' }).uncheck()
  await page.getByRole('spinbutton', { name: 'Maximum repeats' }).fill('7')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('alert')).toContainText('Escalation route is unavailable')
  await expect(page.getByRole('spinbutton', { name: 'Maximum repeats' })).toHaveValue('7')
})

test('scheduling selects an eligible lead and closes without a false success error', async ({ page }) => {
  await mockWorkspace(page, { tables: {
    homes: { ...home, master_plan_id: 'schedule-plan' },
    master_plans: [{ id: 'schedule-plan', name: 'Scheduling checklist', division_id: 'division-1', version: 1, levels: 1, active: true, spaces: [{ type: 'kitchen', name: 'Kitchen', checklist_items: ['Cabinet doors aligned'] }] }],
    inspection_lead_options: [{ user_id: '22222222-2222-4222-8222-222222222222', display_name: 'Jamie Inspector', role_label: 'Inspector' }]
  } })
  let body: { envelope?: { payload: Record<string, unknown> } } = {}
  await page.route('**/functions/v1/command', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, data: { id: 'created-inspection' } } }) })
  await page.goto(`/org/${org}/inspections`)
  await page.getByRole('button', { name: 'Schedule inspection', exact: true }).first().click()
  await expect(page.getByRole('button', { name: 'Choose a home first', exact: true })).toBeDisabled()
  await page.getByRole('combobox', { name: 'Home', exact: true }).selectOption(home.id)
  await page.getByRole('button', { name: 'Choose lead inspector', exact: true }).click()
  await page.getByRole('option', { name: /Jamie Inspector/ }).click()
  await expect(page.getByRole('region', { name: 'Property inspection checklist' })).toContainText('Kitchen')
  await page.getByRole('button', { name: 'Create inspection' }).click()
  await expect(page.getByRole('heading', { name: 'Schedule inspection', exact: true })).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(body.envelope?.payload.lead_inspector_user_id).toBe('22222222-2222-4222-8222-222222222222')
})

test('conflict review preserves local details and discards dependent work only after confirmation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: testInfo.project.name.startsWith('mobile') ? 390 : 1440, height: 1000 })
  await mockWorkspace(page)
  await page.goto(`/org/${org}/sync`)
  await expect(page.getByRole('heading', { name: 'Sync center', exact: true })).toBeVisible()
  await page.evaluate(async ({ org, workId }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('buildtrack-offline-v1')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const transaction = db.transaction('operations', 'readwrite')
        const common = { user_id: '22222222-2222-4222-8222-222222222222', organization_id: org, aggregate_id: workId, request_hash: 'fixture', retries: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        transaction.objectStore('operations').put({ ...common, id: 'conflict-1', command_name: 'add_comment', envelope: { operation_id: 'conflict-1', expected_version: 1, payload: { body: 'Keep this local note' } }, state: 'conflict', dependencies: [], last_error: 'The record version changed.' })
        transaction.objectStore('operations').put({ ...common, id: 'dependent-1', command_name: 'add_comment', envelope: { operation_id: 'dependent-1', expected_version: 1, payload: { body: 'Dependent note' } }, state: 'queued', dependencies: ['conflict-1'] })
        transaction.oncomplete = () => { db.close(); resolve() }
        transaction.onerror = () => reject(transaction.error)
      }
    })
  }, { org, workId: work.id })
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.locator('.queue-row').filter({ hasText: 'The record version changed.' }).getByRole('button', { name: 'Review local operation', exact: true }).click()
  await expect(page.getByText('Keep this local note', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open current record' })).toHaveAttribute('href', `/org/${org}/work/${work.id}`)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('sync-conflict-review.png'), fullPage: true })
  await page.getByRole('button', { name: 'Discard local operation', exact: true }).click()
  await expect(page.getByText(/and 1 dependent local operations/)).toBeVisible()
  await page.getByRole('button', { name: 'Keep local work' }).click()
  await expect(page.getByRole('region', { name: 'Review local change' })).toBeVisible()
  await page.getByRole('button', { name: 'Discard local operation', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm discard' }).click()
  await expect(page.getByRole('heading', { name: 'Device queue is clear' })).toBeVisible()
})

test('inbox pages through older notifications while keeping the overall unread count', async ({ page }) => {
  const notifications = Array.from({ length: 106 }, (_, index) => ({ id: `notice-${index}`, organization_id: org, title: `Update ${index}`, body: 'An operational update', deep_link: `/org/${org}/work/${work.id}`, invalidated_at: null, created_at: '2026-10-25T12:00:00Z', read_at: index === 105 ? null : '2026-10-25T13:00:00Z' }))
  await mockWorkspace(page, { tables: { notifications } })
  await page.goto(`/org/${org}/notifications`)
  await expect(page.getByText('1–25 of 106 notifications · 1 unread overall')).toBeVisible()
  for (let index = 0; index < 4; index++) await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByText('Update 105', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
})

test('home detail fetches the selected record directly even beyond the old directory limit', async ({ page }) => {
  const homes = Array.from({ length: 520 }, (_, index) => ({ ...home, id: `home-${index}`, lot_code: String(index), address_line1: `${index} Cedar Lane` }))
  await mockWorkspace(page, { tables: { home_summary: homes } })
  let requestedDirectly = false
  page.on('request', (request) => { const url = new URL(request.url()); if (url.pathname.endsWith('/home_summary') && url.searchParams.get('id') === 'eq.home-519') requestedDirectly = true })
  await page.goto(`/org/${org}/homes/home-519`)
  await expect(page.getByRole('heading', { name: 'Lot 519' })).toBeVisible()
  expect(requestedDirectly).toBeTruthy()
})

test('inspection directory filters on the server and continues to later records', async ({ page }) => {
  const rows = Array.from({ length: 31 }, (_, index) => ({ id: `inspection-${index}`, organization_id: org, home_id: home.id, type: 'internal_quality', status: index === 30 ? 'submitted' : 'in_progress', scheduled_at: '2026-10-25T12:00:00Z', lot_code: home.lot_code, current_revision: 1, updated_at: '2026-10-25T12:00:00Z' }))
  await mockWorkspace(page, { tables: { inspection_list: rows } })
  await page.goto(`/org/${org}/inspections`)
  await expect(page.getByText('1–25 of 31 inspections')).toBeVisible()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('link').filter({ hasText: 'Submitted' })).toHaveCount(1)
  await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('submitted')
  await expect(page.getByText('1–1 of 1 inspections')).toBeVisible()
})
