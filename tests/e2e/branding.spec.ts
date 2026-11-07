import { expect, test } from '@playwright/test'
import { mockWorkspace, org } from './fixtures/workspace'

test('the sign-in brand fits desktop tablet and mobile', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const width of testInfo.project.name.startsWith('mobile') ? [390] : [1440, 768]) {
    await page.setViewportSize({ width, height: 960 })
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Sign in to your workspace' })).toBeVisible({ timeout: 15000 })
    const mark = page.locator('.auth-story .brand-mark img')
    await expect(mark).toBeVisible()
    expect(await mark.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`signin-${width}.png`), fullPage: true })
  }
  expect(errors).toEqual([])
})

test('the same brand appears in the workspace and platform portal', async ({ page }, testInfo) => {
  await mockWorkspace(page, { tables: { platform_access: { administrator: true, verified: true } } })
  await page.route('**/rest/v1/rpc/platform_list_organizations', (route) => route.fulfill({ json: { rows: [], total: 0 } }))
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const width of testInfo.project.name.startsWith('mobile') ? [390] : [1440, 768]) {
    await page.setViewportSize({ width, height: 960 })
    await page.goto(`/org/${org}/my-work`)
    await expect(page.getByRole('heading', { name: 'My work', exact: true })).toBeVisible({ timeout: 15000 })
    if (width < 900) await page.getByRole('button', { name: 'Open navigation' }).click()
    await expect(page.locator('.sidebar .brand-mark img')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`workspace-${width}.png`), fullPage: true })
    await page.goto('/platform/organizations')
    await expect(page.getByRole('heading', { name: 'Organizations', exact: true })).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.platform-brand .brand-mark img')).toBeVisible()
    if (width < 600) {
      await page.locator('summary[aria-label="Platform navigation"]').click()
      await expect(page.getByRole('link', { name: 'My profile' })).toBeVisible()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`platform-${width}.png`), fullPage: true })
  }
  expect(errors).toEqual([])
})
