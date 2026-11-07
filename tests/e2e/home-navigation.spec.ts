import { expect, test } from '@playwright/test'
import { home, mockWorkspace, org } from './fixtures/workspace'

const base = `/org/${org}/homes/${home.id}`
test.use({ actionTimeout: 15_000 })

test('a home has one header and four clear sections at every screen size', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await mockWorkspace(page, { tables: {
    home_milestones: [{ id: 'plan-1', home_id: home.id, milestone_code: 'operational_readiness', planned_at: null }, { id: 'other-plan', home_id: 'other-home', milestone_code: 'other_home_only', planned_at: null }],
    milestone_requirements: [{ id: 'requirement-1', home_id: home.id, milestone_code: 'operational_readiness', required_inspection_type: 'internal_quality', required: true }]
  } })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const width of testInfo.project.name.startsWith('mobile') ? [390] : [1440, 768]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(base)
    for (const label of ['Work', 'Inspections', 'Details & rooms', 'Milestones']) {
      await page.getByRole('navigation', { name: 'Home sections' }).getByRole('link', { name: label, exact: true }).click()
      await expect(page.getByRole('heading', { level: 1, name: 'Lot 104' })).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('link', { name: 'Manage home', exact: true })).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'Open field view', exact: true })).toHaveCount(0)
      if (label === 'Details & rooms') await expect(page.getByRole('textbox', { name: 'Street address', exact: true })).toBeVisible()
      if (label === 'Milestones') {
        await expect(page.getByRole('link', { name: /operational readiness.*Manage/ })).toBeVisible()
        await expect(page.getByText('other home only', { exact: true })).toHaveCount(0)
        await expect(page.getByRole('navigation', { name: 'Operational settings' })).toHaveCount(0)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
      await page.evaluate(() => scrollTo(0, 0))
      await expect(page.getByRole('heading', { level: 1, name: 'Lot 104' })).toBeInViewport()
      await page.screenshot({ path: testInfo.outputPath(`${width}-${label.replaceAll(/[^a-z]/gi, '-')}.png`), fullPage: true })
    }
  }
  expect(errors).toEqual([])
})

test('property and old management links lead to the same home workspace', async ({ page }) => {
  await mockWorkspace(page)
  await page.goto(`/org/${org}/properties/homes`)
  await page.getByRole('link', { name: 'Lot 104', exact: true }).click()
  await expect(page).toHaveURL(base)
  await expect(page.locator(`.sidebar a[href="/org/${org}/properties"]`)).toHaveCount(1)
  await expect(page.locator(`.sidebar a[href="/org/${org}/neighborhoods"]`)).toHaveCount(0)
  await page.goto(`/org/${org}/properties/homes/${home.id}`)
  await expect(page).toHaveURL(`${base}?tab=details`)
  await expect(page.getByRole('textbox', { name: 'Lot code', exact: false })).toBeVisible()
  await page.getByRole('navigation', { name: 'Home sections' }).getByRole('link', { name: 'Work', exact: true }).click()
  await page.goBack()
  await expect(page.getByRole('textbox', { name: 'Street address', exact: true })).toBeVisible()
})

test('milestone create and edit stay within the home and lock its scope', async ({ page }) => {
  const plans: Array<Record<string, unknown>> = []
  await mockWorkspace(page, { tables: { home_milestones: plans } })
  let body: Record<string, unknown> = {}
  await page.route('**/rest/v1/rpc/admin_save_home_milestone', async (route) => {
    body = route.request().postDataJSON()
    const row = { id: 'plan-new', home_id: home.id, milestone_code: body.p_milestone_code, planned_at: body.p_planned_at }
    plans.splice(0, plans.length, row)
    await route.fulfill({ json: row })
  })
  await page.goto(`${base}?tab=milestones`)
  await page.getByRole('link', { name: 'Add home milestone' }).click()
  await expect(page).toHaveURL(/homes\/home-1\?tab=milestones&view=milestones&record=new/)
  await expect(page.getByRole('combobox', { name: 'Home', exact: true })).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Milestone code' }).fill('walkthrough')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page).toHaveURL(/record=plan-new/)
  expect(body.p_home_id).toBe(home.id)
  await expect(page.getByRole('heading', { level: 1, name: 'Lot 104' })).toBeVisible()
  await page.getByRole('link', { name: '← Home milestones', exact: true }).click()
  await page.getByRole('link', { name: /walkthrough.*Manage/ }).click()
  await expect(page.getByRole('textbox', { name: 'Milestone code' })).toHaveValue('walkthrough')
  await page.getByRole('link', { name: 'Required inspections', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Inspection requirements', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/homes\/home-1\?tab=milestones&view=requirements/)
})

test('inspection scheduling keeps the home selection and offline saving has a clear purpose', async ({ page }) => {
  await mockWorkspace(page)
  await page.goto(base)
  await expect(page.getByRole('button', { name: 'Save for offline', exact: true })).toHaveCount(0)
  await expect(page.getByText(/Homes you open are saved automatically/)).toBeVisible({ timeout: 30000 })
  await expect(page.getByRole('button', { name: 'Download home', exact: true })).toHaveCount(0)
  await page.getByRole('navigation', { name: 'Home sections' }).getByRole('link', { name: 'Inspections', exact: true }).click()
  await page.getByRole('button', { name: 'Schedule inspection', exact: true }).first().click()
  await expect(page.getByRole('combobox', { name: 'Home', exact: true })).toHaveCount(0)
  await expect(page).toHaveURL(`${base}?tab=inspections`)
  await expect(page.getByRole('heading', { name: 'Schedule inspection', exact: true })).toBeVisible()
})

test('field-only members see the home sections they can use', async ({ page }) => {
  await mockWorkspace(page, { permissions: ['work.read_scope', 'inspection.perform'] })
  await page.goto(`${base}?tab=details`)
  const nav = page.getByRole('navigation', { name: 'Home sections' })
  await expect(nav.getByRole('link')).toHaveCount(2)
  await expect(nav.getByRole('link', { name: 'Work', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('textbox', { name: 'Street address', exact: true })).toHaveCount(0)
  await expect(page.locator(`.sidebar a[href="/org/${org}/neighborhoods"]`)).toHaveCount(1)
})
