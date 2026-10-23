import { expect, test } from '@playwright/test'

test('shows a safe setup boundary when no backend credentials are provided', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Connect the application to Supabase' })).toBeVisible()
  await expect(page.getByText('Setup required')).toBeVisible()
  await expect(page.getByText('BuildTrack')).toBeVisible()
  await expect(page.locator('main')).toHaveCount(1)
  await expect(page.locator('input, textarea, select')).toHaveCount(0)
})

test('publishes an installable manifest and active service worker', async ({ page, request }) => {
  await page.goto('/')
  const manifestPath = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifestPath).toBeTruthy()

  const manifestResponse = await request.get(manifestPath!)
  expect(manifestResponse.ok()).toBeTruthy()
  const manifest = await manifestResponse.json()
  expect(manifest).toMatchObject({ name: 'BuildTrack', short_name: 'BuildTrack', display: 'standalone' })
  expect(manifest.icons).toEqual(expect.arrayContaining([expect.objectContaining({ purpose: expect.stringContaining('maskable') })]))

  const hasActiveWorker = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false
    const registration = await navigator.serviceWorker.ready
    return Boolean(registration.active)
  })
  expect(hasActiveWorker).toBeTruthy()
})

test('fits the viewport without horizontal overflow', async ({ page }) => {
  await page.goto('/')
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }))
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport)
})
