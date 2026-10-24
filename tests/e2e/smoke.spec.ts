import { expect, test } from '@playwright/test'

test('shows the invitation-only sign-in boundary when configured', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sign in to your workspace' })).toBeVisible()
  await expect(page.getByText('Access is invitation-only')).toBeVisible()
  await expect(page.getByText('BuildTrack', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Email address')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible()
  await expect(page.getByText(/development environment|synthetic data|testing only/i)).toHaveCount(0)
})

test('publishes an installable manifest and active service worker', async ({ page, request }) => {
  await page.goto('/')
  const manifestPath = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifestPath).toBeTruthy()

  const manifestResponse = await request.get(manifestPath!)
  expect(manifestResponse.ok()).toBeTruthy()
  const manifest = await manifestResponse.json()
  expect(manifest).toMatchObject({ name: 'BuildTrack', short_name: 'BuildTrack', display: 'standalone', id: '/', scope: '/' })
  expect(manifest.icons).toEqual(expect.arrayContaining([expect.objectContaining({ purpose: expect.stringContaining('maskable') })]))
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: '192x192', type: 'image/png' }),
    expect.objectContaining({ sizes: '512x512', type: 'image/png' })
  ]))
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes')

  const hasActiveWorker = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false
    const registration = await navigator.serviceWorker.ready
    return Boolean(registration.active)
  })
  expect(hasActiveWorker).toBeTruthy()
})

test('reopens the application shell without internet after the first visit', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Sign in to your workspace' })).toBeVisible()
  await context.setOffline(false)
})

test('offers a privacy-preserving password recovery flow', async ({ page }) => {
  await page.goto('/forgot-password')
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
  await expect(page.getByLabel('Email address')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible()
})

test('fits the viewport without horizontal overflow', async ({ page }) => {
  await page.goto('/')
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }))
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport)
})
