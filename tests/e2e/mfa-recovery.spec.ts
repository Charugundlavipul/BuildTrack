import { expect, test } from '@playwright/test'
import { mockWorkspace, org, userId } from './fixtures/workspace'

for (const status of ['verified', 'unverified']) {
  test(`administrator with a ${status} factor is not forced to enroll while MFA is disabled`, async ({ page }) => {
    await mockWorkspace(page, { aal: 'aal1' })
    let enrollments = 0
    await page.route('**/auth/v1/user', (route) => route.fulfill({ json: { id: userId, email: 'alex@example.test', aud: 'authenticated', role: 'authenticated', user_metadata: { display_name: 'Alex Morgan' }, app_metadata: {}, factors: [{ id: 'existing-factor', factor_type: 'totp', status, friendly_name: 'BuildTrack administrator', created_at: '2026-10-26T12:00:00Z', updated_at: '2026-10-26T12:00:00Z' }] } }))
    await page.route('**/auth/v1/factors', (route) => { enrollments++; return route.fulfill({ status: 400, json: { message: 'Duplicate factor enrollment must not happen' } }) })
    await page.goto(`/org/${org}/admin`)
    await expect(page.getByRole('heading', { name: 'Administration', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Verify with authenticator', exact: true })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Authenticator code', exact: true })).toHaveCount(0)
    expect(enrollments).toBe(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Start setup again', exact: true })).toHaveCount(0)
  })
}
