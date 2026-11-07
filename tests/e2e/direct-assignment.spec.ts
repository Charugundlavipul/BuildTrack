import { expect, test, type Page } from '@playwright/test'
import { home, mockWorkspace, neighborhood, org, userId, work } from './fixtures/workspace'

async function setup(page: Page, assign = true, draft = false, inspection = false) {
  const calls: Array<{ command_name: string; envelope: { payload: Record<string, unknown> } }> = []
  await mockWorkspace(page, { permissions: ['work.create', 'work.read_scope', ...(assign ? ['work.assign'] : [])], tables: { work_item_list: draft ? { ...work, state: 'draft', inspection_id: inspection ? 'inspection-1' : null } : work } })
  await page.route('**/functions/v1/command', async (route) => {
    const body = route.request().postDataJSON()
    calls.push(body)
    return route.fulfill({ json: { ok: true, data: { id: 'work-1', version: 2, state: body.command_name === 'create_work_item' ? 'draft' : 'assigned' } } })
  })
  return calls
}

async function fillWork(page: Page) {
  await page.goto(`/org/${org}/work/new?neighborhood=${neighborhood.id}&home=${home.id}`)
  await page.getByRole('textbox', { name: 'Short title' }).fill('Repair kitchen cabinet door')
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Replace the damaged panel and check alignment.')
}

test('assignment permission allows creation and assignment in one request', async ({ page }) => {
  const calls = await setup(page)
  await fillWork(page)
  await page.getByRole('combobox', { name: 'Staff member', exact: true }).selectOption(userId)
  await page.getByLabel('Due date and time', { exact: true }).fill('2026-11-04T15:00')
  await page.getByRole('button', { name: 'Create and assign', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/org/${org}/work/work-1$`))
  expect(calls).toHaveLength(1)
  expect(calls[0].command_name).toBe('create_and_assign_work_item')
  expect(calls[0].envelope.payload.assignment).toMatchObject({ accountable_internal_user_id: userId, company_id: null })
})

test('assignment-capable users can still save a draft without assignment details', async ({ page }) => {
  const calls = await setup(page)
  await fillWork(page)
  await page.getByRole('radio', { name: /Save draft/ }).check()
  await expect(page.getByLabel('Due date and time', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/org/${org}/work/work-1$`))
  expect(calls[0].command_name).toBe('create_work_item')
  expect(calls[0].envelope.payload).not.toHaveProperty('assignment')
})

test('failed assignment shows the actionable server error', async ({ page }) => {
  await setup(page)
  await page.route('**/functions/v1/command', (route) => route.fulfill({ status: 422, json: { ok: false, error: { code: 'ASSIGNEE_INELIGIBLE', message: 'The selected staff member is no longer active.' } } }))
  await fillWork(page)
  await page.getByRole('combobox', { name: 'Staff member', exact: true }).selectOption(userId)
  await page.getByLabel('Due date and time', { exact: true }).fill('2026-11-04T15:00')
  await page.getByRole('button', { name: 'Create and assign', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('The selected staff member is no longer active.')
  await expect(page).toHaveURL(/work\/new/)
})

test('reporters retain draft and submit controls without assignment actions', async ({ page }) => {
  await setup(page, false, true)
  await fillWork(page)
  await expect(page.getByRole('button', { name: 'Create and assign', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeVisible()
  await page.goto(`/org/${org}/work/work-1`)
  await expect(page.getByRole('button', { name: 'Submit work item', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Assign work', exact: true })).toHaveCount(0)
})

test('ordinary drafts can be assigned directly but inspection findings cannot', async ({ page }) => {
  const calls = await setup(page, true, true)
  await page.goto(`/org/${org}/work/work-1`)
  await expect(page.getByRole('button', { name: 'Submit work item', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Manage & review', exact: true }).click()
  await page.getByRole('combobox', { name: 'Internal member', exact: true }).selectOption(userId)
  await page.getByLabel('Due date and time', { exact: true }).fill('2026-11-04T15:00')
  await page.getByRole('button', { name: 'Assign work', exact: true }).click()
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0].command_name).toBe('assign_work_item')
  await setup(page, true, true, true)
  await page.goto(`/org/${org}/work/work-1`)
  await expect(page.getByRole('button', { name: 'Assign work', exact: true })).toHaveCount(0)
})

test('assignment form fits desktop tablet and phone', async ({ page }, testInfo) => {
  await setup(page)
  for (const width of testInfo.project.name.startsWith('mobile') ? [390] : [1440, 768]) {
    await page.setViewportSize({ width, height: 1000 })
    await fillWork(page)
    await expect(page.getByRole('button', { name: 'Create and assign', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`create-and-assign-${width}.png`), fullPage: true })
  }
})
