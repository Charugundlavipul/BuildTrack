import { expect, test, type Page } from '@playwright/test'

test.use({ actionTimeout: 10_000 })

import { mockWorkspace, org, neighborhood, home, work } from './fixtures/workspace'

async function expectPanelInsets(page: Page) {
  const cramped = await page.locator('.panel > .section-heading').evaluateAll((headings) => headings.flatMap((heading) => {
    const panel = heading.parentElement!.getBoundingClientRect()
    if (!heading.getClientRects().length) return []
    return Array.from(heading.children).flatMap((child) => {
      const rect = child.getBoundingClientRect()
      if (!rect.width || !rect.height) return []
      const inset = { left: rect.left - panel.left, right: panel.right - rect.right, top: rect.top - panel.top }
      return inset.left < 12 || inset.right < 12 || inset.top < 10
        ? [{ text: child.textContent?.trim(), inset }]
        : []
    })
  }))
  expect(cramped, 'Panel headings and actions need breathing room inside their borders').toEqual([])
}

const screens = [
  ['my-work', 'My work'], ['neighborhoods', 'Neighborhoods'], ['neighborhoods/community-1', 'Cedar Grove'],
  ['homes/home-1', 'Lot 104'], ['work/new', 'Create work item'],
  ['work/work-1', work.title], ['inspections', 'Inspections'], ['inspections/inspection-1', 'Internal Quality'],
  ['reports', 'Reports'], ['admin', 'Administration'], ['account', 'Alex Morgan'], ['notifications', 'Notifications'], ['sync', 'Sync center']
] as const

test('all workspace pages retain content at desktop, tablet, and mobile widths', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  await mockWorkspace(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const widths = testInfo.project.name.startsWith('mobile') ? [390] : [1440, 768]
  for (const width of widths) {
    await page.setViewportSize({ width, height: 960 })
    for (const [path, title] of screens) {
      await page.goto(`/org/${org}/${path}`)
      await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible()
      await expect(page.locator('.loading-state')).toHaveCount(0)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expectPanelInsets(page)
      if (path === 'inspections') {
        await expect(page.locator('.inspection-table-row').getByText('Lot 104')).toBeVisible()
        await expect(page.locator('.inspection-schedule')).toBeVisible()
        await expect(page.locator('.inspection-revision')).toBeVisible()
      }
      if (path === 'admin') {
        for (const label of ['Structure & settings', 'Import homes', 'Activity & policies', 'People & access']) {
          await page.getByRole('button', { name: label, exact: true }).click()
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await expectPanelInsets(page)
          if (label === 'Structure & settings') {
            await expect(page.getByRole('link', { name: /Manage neighborhoods →/ })).toHaveAttribute('href', `/org/${org}/properties/neighborhoods`)
          }
        }
      }
      await page.screenshot({ path: testInfo.outputPath(`${width}-${path.replaceAll('/', '-')}.png`), fullPage: true })
    }
  }
  expect(errors).toEqual([])
})

test('mobile navigation closes with Escape and returns focus', async ({ page }) => {
  await mockWorkspace(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/org/${org}/my-work`)
  const toggle = page.getByRole('button', { name: 'Open navigation' })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(toggle).toBeFocused()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
})

test('directories and settings keep panel content inside their borders', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  await mockWorkspace(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const directories = [
    ['messages', 'Messages'], ['vendors', 'Vendors'], ['vendors/rosters', 'Neighborhood rosters'],
    ['properties/divisions', 'Divisions'], ['properties/neighborhoods', 'Neighborhoods'], ['properties/homes', 'Homes & lots'],
    ['plans', 'Floor plans'], ['settings/calendars', 'Business calendars'], ['settings/checklists', 'Checklist categories'],
    ['settings/engagements', 'Inspector engagements'], ['settings/escalations', 'Escalation routes'],
    ['settings/notifications', 'Notification rules']
  ]
  for (const width of testInfo.project.name.startsWith('mobile') ? [390] : [1440, 768]) {
    await page.setViewportSize({ width, height: 960 })
    for (const [path, title] of directories) {
      await page.goto(`/org/${org}/${path}`)
      await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible()
      await expect(page.locator('.loading-state')).toHaveCount(0)
      await expectPanelInsets(page)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`${width}-${path.replaceAll('/', '-')}.png`), fullPage: true })
    }
  }
  expect(errors).toEqual([])
})

test('account entry pages fit the viewport and keep the form visible', async ({ page }, testInfo) => {
  const width = testInfo.project.name.startsWith('mobile') ? 390 : 1440
  await page.setViewportSize({ width, height: 960 })
  for (const [path, heading] of [['/login', 'Sign in to your workspace'], ['/forgot-password', 'Reset your password'], ['/auth/update-password', 'Choose a new password']]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (path === '/login') await expect(page.getByLabel('Email address')).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath(`${width}-${path.replaceAll('/', '-')}.png`), fullPage: true })
  }
  await mockWorkspace(page)
  for (const [path, heading] of [['/organizations/select', 'Select an organization'], ['/accept-invite?token=fixture&setup=1', 'Review your invitation']]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`${width}-${heading.replaceAll(' ', '-')}.png`), fullPage: true })
  }
})

test('filters, conditional location fields, and evidence removal remain usable', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await mockWorkspace(page)
  await page.goto(`/org/${org}/my-work`)
  await page.getByRole('button', { name: 'blocked', exact: true }).click()
  await expect(page.locator('.work-row')).toHaveCount(1)
  await page.getByLabel('Search work').fill('no matching task')
  await expect(page.getByText('No work in this view')).toBeVisible()

  await page.goto(`/org/${org}/work/new`)
  await page.getByRole('combobox', { name: 'Neighborhood', exact: true }).selectOption(neighborhood.id)
  await page.getByRole('combobox', { name: 'Home / lot', exact: true }).selectOption(home.id)
  await expect(page.getByLabel('Common-area location')).toHaveCount(0)
  await page.locator('input[type="file"]').setInputFiles({ name: 'inspection.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fixture') })
  await expect(page.getByRole('button', { name: 'Remove inspection.jpg' })).toBeVisible()
  await page.getByRole('button', { name: 'Remove inspection.jpg' }).click()
  await expect(page.locator('.selected-files')).toHaveCount(0)
  await page.locator('input[type="file"]').setInputFiles({ name: 'inspection.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fixture') })
  await expect(page.getByRole('button', { name: 'Remove inspection.jpg' })).toBeVisible()
  await page.getByRole('button', { name: 'Remove inspection.jpg' }).click()
  await page.getByRole('textbox', { name: 'Short title', exact: true }).fill('Replace cabinet door')
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Replace the damaged upper cabinet panel.')
  let submittedLocation: unknown = 'not submitted'
  await page.route('**/functions/v1/command', async (route) => {
    submittedLocation = route.request().postDataJSON().envelope.payload.common_area_location
    await route.fulfill({ json: { ok: false, error: { message: 'Fixture: no work was saved.' } } })
  })
  await page.getByRole('radio', { name: /Save draft/ }).check()
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByText('Fixture: no work was saved.')).toBeVisible()
  expect(submittedLocation).toBeNull()

  await page.goto(`/org/${org}/reports`)
  await page.locator('.report-filter-panel > summary').click()
  await page.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('high')
  await expect(page.getByText('1 active filters')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByRole('combobox', { name: 'Priority', exact: true })).toHaveValue('')
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('report-filters-expanded.png'), fullPage: true })

  await page.goto(`/org/${org}/admin`)
  await page.getByRole('button', { name: 'Import homes', exact: true }).click()
  await page.getByLabel('CSV data').fill('lot_code,address_line1\n105,105 Cedar Grove Boulevard')
  await page.getByRole('button', { name: 'People & access', exact: true }).click()
  await page.getByRole('button', { name: 'Import homes', exact: true }).click()
  await expect(page.getByLabel('CSV data')).toHaveValue('lot_code,address_line1\n105,105 Cedar Grove Boulevard')
  await page.screenshot({ path: testInfo.outputPath('admin-import.png'), fullPage: true })
})
