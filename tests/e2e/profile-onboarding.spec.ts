import { expect, test, type Page } from '@playwright/test'
import { mockWorkspace, org } from './fixtures/workspace'

async function setup(page: Page, complete = false, rejectSave = false) {
  let profile = { first_name: complete ? 'Alex' : '', last_name: complete ? 'Morgan' : '', phone_number: '', contact_email: '', timezone: 'America/New_York', display_name: 'Alex Morgan', completed_at: complete ? '2026-10-26T12:00:00Z' : null, version: 1, account_email: 'alex@example.test', email_verified: true }
  const calls: Array<{ action: string; body: Record<string, unknown> }> = []
  await mockWorkspace(page)
  await page.route('**/rest/v1/rpc/my_profile', (route) => route.fulfill({ json: profile }))
  await page.route('**/rest/v1/rpc/save_my_profile', (route) => {
    const body = route.request().postDataJSON()
    calls.push({ action: 'profile', body })
    if (rejectSave) return route.fulfill({ status: 409, json: { message: 'Your profile changed. Reload before saving.' } })
    profile = { ...profile, first_name: body.p_first_name, last_name: body.p_last_name, phone_number: body.p_phone_number, contact_email: body.p_contact_email, timezone: body.p_timezone, completed_at: '2026-10-26T12:00:00Z', version: profile.version + 1 }
    return route.fulfill({ json: profile })
  })
  await page.route('**/rest/v1/rpc/accept_invitation', (route) => {
    calls.push({ action: 'accept', body: route.request().postDataJSON() })
    return route.fulfill({ json: { organization_id: org } })
  })
  return calls
}

test('existing users complete names before entering their account and optional fields can stay blank', async ({ page }) => {
  const calls = await setup(page)
  await page.goto(`/org/${org}/account`)
  await expect(page.getByRole('heading', { name: 'Tell us about yourself' })).toBeVisible()
  await expect(page.getByLabel('First name', { exact: true })).toHaveAttribute('required', '')
  await expect(page.getByLabel('Last name', { exact: true })).toHaveAttribute('required', '')
  await expect(page.getByLabel('Contact email (optional)', { exact: true })).not.toHaveAttribute('required', '')
  await page.getByLabel('First name', { exact: true }).fill('Alex')
  await page.getByLabel('Last name', { exact: true }).fill('Morgan')
  await page.getByRole('button', { name: 'Save details and continue', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/org/${org}/account$`))
  expect(calls[0].body).toMatchObject({ p_first_name: 'Alex', p_last_name: 'Morgan', p_phone_number: '', p_contact_email: '' })
})

test('invitation setup collects basic details before accepting access then opens the profile', async ({ page }) => {
  const calls = await setup(page)
  await page.goto('/accept-invite?token=fixture&setup=1')
  await page.getByLabel('Password', { exact: true }).fill('NewSecurePassword123!')
  await page.getByLabel('Confirm password', { exact: true }).fill('NewSecurePassword123!')
  await page.getByRole('button', { name: 'Save password', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Accept invitation', exact: true })).toHaveCount(0)
  await page.getByLabel('First name', { exact: true }).fill('Alex')
  await page.getByLabel('Last name', { exact: true }).fill('Morgan')
  await page.getByRole('button', { name: 'Save details and continue', exact: true }).click()
  await page.getByRole('button', { name: 'Accept invitation', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/org/${org}/account$`))
  expect(calls.map((call) => call.action)).toEqual(['profile', 'accept'])
  await expect(page.getByLabel('First name', { exact: true })).toHaveValue('Alex')
})

test('account stores optional contacts separately from the sign-in email', async ({ page }) => {
  const calls = await setup(page, true)
  await page.goto(`/org/${org}/account`)
  await page.getByLabel('Phone number (optional)', { exact: true }).fill('+1 (919) 555-0100')
  await page.getByLabel('Contact email (optional)', { exact: true }).fill('contact@example.test')
  await page.getByRole('button', { name: 'Save profile', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Profile updated.')
  expect(calls[0].body).toMatchObject({ p_phone_number: '+1 (919) 555-0100', p_contact_email: 'contact@example.test', p_expected_version: 1 })
  await page.reload()
  await expect(page.getByLabel('Contact email (optional)', { exact: true })).toHaveValue('contact@example.test')
  await expect(page.getByText('alex@example.test', { exact: true }).first()).toBeVisible()
})

test('a rejected profile save keeps onboarding and entered details visible', async ({ page }) => {
  await setup(page, false, true)
  await page.goto(`/org/${org}/account`)
  await page.getByLabel('First name', { exact: true }).fill('Alex')
  await page.getByLabel('Last name', { exact: true }).fill('Morgan')
  await page.getByRole('button', { name: 'Save details and continue', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Reload before saving')
  await expect(page.getByLabel('First name', { exact: true })).toHaveValue('Alex')
  await expect(page).toHaveURL(/complete-profile/)
})

test('users without an organization can manage their personal profile', async ({ page }) => {
  await setup(page, true)
  await page.route('**/rest/v1/my_organizations*', (route) => route.fulfill({ json: [] }))
  await page.goto('/account')
  await expect(page.getByLabel('First name', { exact: true })).toHaveValue('Alex')
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Active access', exact: true })).toHaveCount(0)
})

test('basic details fit desktop tablet and phone', async ({ page }, testInfo) => {
  await setup(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const width of testInfo.project.name.startsWith('mobile') ? [390] : [1440, 768]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(`/org/${org}/account`)
    await expect(page.getByRole('heading', { name: 'Tell us about yourself' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`profile-${width}.png`), fullPage: true })
  }
  expect(errors).toEqual([])
})
