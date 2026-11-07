import { expect, test, type Page } from '@playwright/test'
import { home, mockWorkspace, neighborhood, org, userId } from './fixtures/workspace'

const base = `/org/${org}`
const peer = '33333333-3333-4333-8333-333333333333'
const conversation = '44444444-4444-4444-8444-444444444444'
const now = '2026-10-29T12:00:00Z'
async function chatWorkspace(page: Page) {
  const messages = [{ id: 'message-1', seq: 1, author_id: peer, author_name: 'Jamie Rivera', body: 'The kitchen is ready for review.', kind: 'message', reply_to: null as string | null, created_at: now, operation_id: 'seed' }]
  const members = [{ user_id: userId, display_name: 'Alex Morgan', has_access: true, last_read_seq: 0 }, { user_id: peer, display_name: 'Jamie Rivera', has_access: true, last_read_seq: 0 }]
  const record = { id: conversation, title: 'Team coordination', audience: 'partners', can_manage: true, unread: 1 }
  await mockWorkspace(page, { tables: {
    project_chat_inbox: { rows: [record], total: 1, unread: 1 },
    project_chat_read: { conversation: record, members, messages, has_more: false },
    project_chat_people: [{ user_id: peer, display_name: 'Jamie Rivera', affiliation: 'external' }]
  } })
  await page.route('**/rest/v1/rpc/project_chat_mark_read', (route) => route.fulfill({ json: null }))
  return { messages, members, record }
}

test('home creation requires a layout choice and explicit plan selection', async ({ page }) => {
  const plan = { id: 'plan-1', name: 'The Monterey', division_id: 'division-1', active: true, version: 1, spaces: [{ type: 'kitchen', name: 'Kitchen' }] }
  await mockWorkspace(page, { tables: { master_plans: [plan] } })
  const calls: Array<Record<string, unknown>> = []
  await page.route('**/rest/v1/rpc/onboard_home_layout', async (route) => { calls.push(route.request().postDataJSON()); await route.fulfill({ json: home }) })
  await page.goto(`${base}/properties/homes/new?neighborhood=${neighborhood.id}`)
  await expect(page.getByRole('button', { name: 'Create home', exact: true })).toBeEnabled()
  await page.getByRole('textbox', { name: 'Lot code *', exact: true }).fill('205')
  await page.getByRole('button', { name: 'Create home', exact: true }).click()
  expect(calls).toEqual([])
  await page.getByRole('combobox', { name: 'Layout method *', exact: true }).selectOption('plan')
  await page.getByRole('button', { name: 'Create home', exact: true }).click()
  expect(calls).toEqual([])
  await page.getByRole('combobox', { name: 'Floor plan *', exact: true }).selectOption(plan.id)
  await page.getByRole('button', { name: 'Create home', exact: true }).click()
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0]).toMatchObject({ p_mode: 'plan', p_plan: plan.id, p_spaces: [], p_details: { lot_code: '205', neighborhood_id: neighborhood.id } })
  expect(calls[0].p_request).toMatch(/^[0-9a-f-]{36}$/)
  expect(calls[0].p_details).not.toHaveProperty('phase')
})

test('manual onboarding saves named rooms and keeps rejected input for retry', async ({ page }, testInfo) => {
  await mockWorkspace(page, { tables: { space_types: [{ code: 'kitchen', label: 'Kitchen', active: true }, { code: 'bedroom', label: 'Bedroom', active: true }] } })
  const calls: Array<Record<string, unknown>> = []
  await page.route('**/rest/v1/rpc/onboard_home_layout', async (route) => { calls.push(route.request().postDataJSON()); await route.fulfill({ status: 400, json: { message: 'A room with this name already exists.', code: '23514' } }) })
  await page.goto(`${base}/properties/homes/new?neighborhood=${neighborhood.id}`)
  await expect(page.getByRole('button', { name: 'Create home', exact: true })).toBeEnabled()
  await page.getByRole('textbox', { name: 'Lot code *', exact: true }).fill('206')
  await page.getByRole('combobox', { name: 'Layout method *', exact: true }).selectOption('manual')
  await page.getByRole('combobox', { name: 'Room type 1 *', exact: true }).selectOption('kitchen')
  await page.getByRole('textbox', { name: 'Room name 1 *', exact: true }).fill('Kitchen')
  await page.getByRole('button', { name: 'Add room', exact: true }).click()
  await page.getByRole('combobox', { name: 'Room type 2 *', exact: true }).selectOption('bedroom')
  await page.getByRole('textbox', { name: 'Room name 2 *', exact: true }).fill('Bedroom 1')
  await page.getByRole('button', { name: 'Create home', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('A room with this name already exists.')
  expect(calls[0]).toMatchObject({ p_mode: 'manual', p_plan: null, p_spaces: [{ type: 'kitchen', name: 'Kitchen' }, { type: 'bedroom', name: 'Bedroom 1' }] })
  await expect(page.getByRole('textbox', { name: 'Room name 2 *', exact: true })).toHaveValue('Bedroom 1')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('required-home-layout.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('construction phases are hidden and editing preserves the stored value', async ({ page }) => {
  await mockWorkspace(page)
  let payload: Record<string, unknown> = {}
  await page.route('**/rest/v1/rpc/admin_save_home', async (route) => { payload = route.request().postDataJSON(); await route.fulfill({ json: home }) })
  await page.goto(`${base}/homes/${home.id}?tab=details`)
  await expect(page.getByLabel(/Construction phase/)).toHaveCount(0)
  await expect(page.getByText('Phase', { exact: true })).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Street address', exact: true }).fill('104 Updated Street')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.poll(() => payload.p_phase).toBe(home.phase)
  await page.goto(`${base}/properties/homes`)
  await expect(page.getByRole('columnheader', { name: 'Phase', exact: true })).toHaveCount(0)
  await expect(page.getByRole('columnheader', { name: 'Floor plan', exact: true })).toBeVisible()
})

test('observation handovers retain named people reasons messages and decisions in one feed', async ({ page }, testInfo) => {
  const entries = [
    { key: '001:event:a', at: now, kind: 'event', actor_id: userId, actor_name: 'Alex Morgan', event_type: 'work.assigned', from_state: 'assigned', to_state: 'assigned', visibility: 'shared', details: { previous_assignee_name: 'Jamie Rivera', assignee_name: 'Taylor Reed', company_name: 'Cedar Finish Carpentry', reason: 'Taylor is taking over the repair.' } },
    { key: '002:comment:b', at: now, kind: 'comment', actor_id: peer, actor_name: 'Jamie Rivera', event_type: 'comment.added', visibility: 'shared', details: {}, body: 'The replacement panel is fitted. Upper hinge still needs checking.' },
    { key: '003:event:c', at: now, kind: 'event', actor_id: userId, actor_name: 'Alex Morgan', event_type: 'observation.reinspection_rejected', from_state: 'ready_for_verification', to_state: 'rework_required', visibility: 'shared', details: { notes: 'Upper hinge remains loose. Return for adjustment.' } }
  ]
  await mockWorkspace(page, { tables: { observation_activity: { entries, has_more: false } } })
  let command: Record<string, unknown> = {}
  await page.route('**/functions/v1/command', async (route) => { command = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, data: { id: 'comment-new' } } }) })
  await page.goto(`${base}/work/work-1`)
  await page.getByRole('button', { name: 'Updates & evidence', exact: true }).click()
  const feed = page.getByRole('region', { name: 'Observation conversation and history' })
  await expect(feed.getByText('Jamie Rivera', { exact: true }).first()).toBeVisible()
  await expect(feed.getByText('Cedar Finish Carpentry · Taylor Reed', { exact: false })).toBeVisible()
  await expect(feed.getByText('Taylor is taking over the repair.')).toBeVisible()
  await expect(feed.getByText('Upper hinge remains loose. Return for adjustment.')).toBeVisible()
  await feed.getByRole('textbox', { name: 'Message about this observation' }).fill('Taylor, please check both hinges before resubmitting.')
  await feed.getByRole('combobox', { name: 'Audience' }).selectOption('shared')
  await feed.getByRole('button', { name: 'Post comment' }).click()
  await expect.poll(() => command.command_name).toBe('add_comment')
  expect(command.envelope).toMatchObject({ payload: { item_id: 'work-1', body: 'Taylor, please check both hinges before resubmitting.', visibility: 'shared' } })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('observation-handover-history.png'), fullPage: true })
})

test('project conversations support replies and audited participant removal without deleting history', async ({ page }, testInfo) => {
  const { messages, members } = await chatWorkspace(page)
  let command: Record<string, unknown> = {}
  await page.route('**/functions/v1/command', async (route) => {
    command = route.request().postDataJSON()
    const envelope = command.envelope as { operation_id: string; payload: { body: string; reply_to: string } }
    const sent = { id: 'message-2', seq: 2, author_id: userId, author_name: 'Alex Morgan', body: envelope.payload.body, reply_to: envelope.payload.reply_to, kind: 'message', created_at: '2026-10-29T12:05:00Z', operation_id: envelope.operation_id }
    messages.unshift(sent); await route.fulfill({ json: { ok: true, data: sent } })
  })
  await page.route('**/rest/v1/rpc/project_chat_set_member', async (route) => { const body = route.request().postDataJSON(); const index = members.findIndex((person) => person.user_id === body.p_user); if (index >= 0) members.splice(index, 1); await route.fulfill({ json: null }) })
  await page.goto(`${base}/messages?conversation=${conversation}`)
  await expect(page.getByText('The kitchen is ready for review.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Reply to Jamie Rivera' }).click()
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('I will review it this afternoon.')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.getByText('I will review it this afternoon.', { exact: true })).toBeVisible()
  expect(command.envelope).toMatchObject({ payload: { conversation_id: conversation, reply_to: 'message-1' } })
  await page.getByText('Participants & access', { exact: true }).click()
  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.getByText(/Jamie Rivera will lose access/)).toBeVisible()
  await page.getByRole('button', { name: 'Confirm removal' }).click()
  await expect(page.getByText(/Jamie Rivera will lose access/)).toHaveCount(0)
  await expect(page.locator('.project-message-list').getByText('The kitchen is ready for review.', { exact: true })).toHaveCount(2)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('project-conversation.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  if (testInfo.project.name === 'desktop-chromium') {
    await page.setViewportSize({ width: 768, height: 1024 })
    await expect(page.getByRole('heading', { name: 'Team coordination', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('project-conversation-tablet.png'), fullPage: true })
  }
})

test('CSV home imports require a layout and editing rooms invalidates the preview', async ({ page }) => {
  await mockWorkspace(page)
  let payload: Record<string, unknown> = {}
  await page.route('**/functions/v1/command', async (route) => {
    payload = route.request().postDataJSON().envelope.payload
    await route.fulfill({ json: { ok: true, data: { preview: true, inserted_count: 0, rows: [{ row: 0, lot_code: '207', status: 'ready' }] } } })
  })
  await page.goto(`${base}/admin`)
  await page.getByRole('button', { name: 'Import homes', exact: true }).click()
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Home import', exact: true }) })
  await section.getByRole('combobox', { name: 'Neighborhood', exact: true }).selectOption(neighborhood.id)
  await section.getByRole('textbox', { name: 'CSV data', exact: true }).fill('lot_code,address_line1,city,state_code,postal_code\n207,207 Cedar Way,Austin,TX,78701')
  await expect(section.getByRole('button', { name: 'Preview import' })).toBeDisabled()
  await section.getByRole('combobox', { name: 'Layout method *', exact: true }).selectOption('manual')
  await section.getByRole('combobox', { name: 'Room type 1 *', exact: true }).selectOption('other')
  await section.getByRole('textbox', { name: 'Room name 1 *', exact: true }).fill('Entry')
  await section.getByRole('button', { name: 'Preview import' }).click()
  await expect(section.getByRole('button', { name: 'Commit valid preview' })).toBeEnabled()
  expect(payload).toMatchObject({ layout_mode: 'manual', master_plan_id: null, spaces: [{ name: 'Entry' }], preview: true })
  await section.getByRole('textbox', { name: 'Room name 1 *', exact: true }).fill('Front entry')
  await expect(section.getByRole('button', { name: 'Commit valid preview' })).toBeDisabled()
})

test('new conversation chooses an audience and people without project or home scope', async ({ page }) => {
  const { record } = await chatWorkspace(page)
  let request: Record<string, unknown> = {}
  await page.route('**/rest/v1/rpc/project_chat_create', async (route) => { request = route.request().postDataJSON(); record.title = String(request.p_title); await route.fulfill({ json: conversation }) })
  await page.goto(`${base}/messages`)
  await page.getByRole('button', { name: 'New conversation', exact: true }).click()
  const form = page.getByRole('form', { name: 'New conversation' })
  await form.getByRole('combobox', { name: 'Conversation audience' }).selectOption('partners')
  await expect(form.getByRole('combobox', { name: 'Project / neighborhood' })).toHaveCount(0)
  await expect(form.getByRole('combobox', { name: 'Home (optional)' })).toHaveCount(0)
  await form.getByRole('textbox', { name: 'Conversation title' }).fill('Kitchen handover')
  await form.getByRole('combobox', { name: 'Search people by name' }).fill('Jamie')
  await form.getByRole('option', { name: 'Jamie Rivera' }).click()
  await expect(form.getByText(/complete shared history/)).toBeVisible()
  await form.getByRole('button', { name: 'Create conversation', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Kitchen handover', exact: true })).toBeVisible()
  expect(request).toMatchObject({ p_org: org, p_audience: 'partners', p_users: [peer] })
  expect(request).not.toHaveProperty('p_neighborhood')
  expect(request).not.toHaveProperty('p_home')
})

test('queued project message survives reload and is sent once after reconnect', async ({ page }) => {
  const { messages } = await chatWorkspace(page)
  let sends = 0
  await page.route('**/functions/v1/command', async (route) => { sends++; const envelope = route.request().postDataJSON().envelope; const sent = { id: 'message-offline', seq: 2, author_id: userId, author_name: 'Alex Morgan', body: String(envelope.payload.body), kind: 'message', reply_to: null, created_at: '2026-10-29T12:10:00Z', operation_id: envelope.operation_id }; messages.unshift(sent); await route.fulfill({ json: { ok: true, data: sent } }) })
  await page.goto(`${base}/messages?conversation=${conversation}`)
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }))
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); window.dispatchEvent(new Event('offline')) })
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Offline update: kitchen access is through the garage.')
  await page.getByRole('button', { name: 'Save message to send' }).click()
  await expect(page.getByText('Waiting to send', { exact: true })).toBeVisible()
  expect(sends).toBe(0)
  await page.reload()
  await expect(page.getByText('Offline update: kitchen access is through the garage.', { exact: true })).toBeVisible()
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }); window.dispatchEvent(new Event('online')) })
  await expect.poll(() => sends, { timeout: 30000 }).toBe(1)
  await expect(page.getByText('Offline update: kitchen access is through the garage.', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Waiting to send', { exact: true })).toHaveCount(0)
})
