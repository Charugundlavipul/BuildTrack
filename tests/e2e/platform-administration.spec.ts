import { expect, test, type Page } from '@playwright/test'
import { mockWorkspace, org } from './fixtures/workspace'

const permissionCatalog = [
  { code: 'access.manage', description: 'Manage memberships, invitations, and scoped role grants' },
  { code: 'structure.manage', description: 'Manage divisions, neighborhoods, homes, locations, and milestones' },
  { code: 'work.read_scope', description: 'Read authorized work within a granted scope' },
  { code: 'work.create', description: 'Create field work and inspection findings' },
  { code: 'inspection.perform', description: 'Capture authorized inspection responses' }
]
const adminRole = { code: 'org_admin', label: 'Organization administrator', description: 'Manage the organization and its access.', organization_id: null as string | null, active: true, enabled: true, default_for_new_organizations: true, requires_company: false, allowed_scope_kinds: ['organization'], permissions: ['access.manage', 'structure.manage'], version: 1, assignment_count: 1 }
const fieldRole = { ...adminRole, code: 'field_reviewer', label: 'Field reviewer', description: 'Read work and capture inspection responses.', allowed_scope_kinds: ['neighborhood', 'home'], permissions: ['work.read_scope', 'inspection.perform'], assignment_count: 0 }
const organization = { id: org, name: 'Cedar Homes', timezone: 'America/New_York', status: 'active', onboarding_status: 'ready', version: 1, created_at: '2026-10-26T12:00:00Z', member_count: 3 }

async function setup(page: Page, options: { platform?: boolean; verified?: boolean; failDelivery?: boolean; unknownCreate?: boolean } = {}) {
  const roles = [{ ...adminRole }, { ...fieldRole }, { ...fieldRole, code: 'private_other', label: 'Other organization only', organization_id: 'other-org' }]
  const organizations = [{ ...organization }]
  const onboardings: Record<string, { administrator_email: string; administrator_role_code: string }> = {}
  const invitations: Array<{ id: string; normalized_email: string; status: string; expires_at: string; created_at: string; delivery_error: string | null }> = []
  const enabled = new Map<string, boolean>()
  const calls: Array<{ name: string; body: Record<string, unknown> }> = []
  const requests = new Map<string, string>()
  let pricing: Record<string, unknown> | null = null
  const members = [{ user_id: 'owner', email: 'owner@example.test', display_name: 'Organization owner', status: 'active', affiliation: 'internal', assigned_work: 0, roles: [{ label: 'Organization administrator', scope: 'organization', effective: true }] }, { user_id: 'member', email: 'member@example.test', display_name: 'Field member', status: 'active', affiliation: 'internal', assigned_work: 2, roles: [{ label: 'Field reviewer', scope: 'organization', effective: true }] }]
  let deliveries = 0
  let interrupted = false
  const catalog = (id?: string) => ({ roles: roles.filter((role) => id ? !role.organization_id || role.organization_id === id : !role.organization_id).map((role) => ({ ...role, enabled: id ? enabled.get(`${id}/${role.code}`) ?? !role.organization_id : role.active })), permissions: permissionCatalog })
  const detail = (id: string) => ({ organization: organizations.find((item) => item.id === id), onboarding: onboardings[id] ?? null, invitations, activity: [{ action: 'organization.created', created_at: '2026-10-26T12:00:00Z' }] })
  await mockWorkspace(page, { aal: options.verified === false ? 'aal1' : 'aal2', tables: { platform_access: { administrator: options.platform !== false, verified: options.verified !== false } } })
  await page.route('**/rest/v1/rpc/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)!
    const body = route.request().postDataJSON() as Record<string, unknown>
    if (!['manage_role_catalog', 'available_roles', 'platform_list_organizations', 'platform_get_organization', 'platform_save_organization', 'save_role_definition', 'set_organization_role', 'platform_get_operations', 'platform_save_pricing', 'platform_set_organization_status', 'platform_set_member_status', 'platform_revoke_invitation'].includes(name)) return route.fallback()
    calls.push({ name, body })
    if (name === 'platform_get_operations') return route.fulfill({ json: { pricing, usage: { users: members.filter((member) => member.status === 'active').length, homes: 12 }, members: members.filter((member) => member.email.includes(String(body.p_search ?? ''))), total: members.length, invitations } })
    if (name === 'platform_save_pricing') { pricing = { ...(body.p_config as object), version: Number(pricing?.version ?? 0) + 1 }; return route.fulfill({ json: pricing }) }
    if (name === 'platform_set_organization_status') { const current = organizations.find((item) => item.id === body.p_organization_id)!; current.status = String(body.p_status); current.version++; if (body.p_status !== 'active') invitations.forEach((invite) => { if (invite.status === 'pending') invite.status = 'revoked' }); return route.fulfill({ json: current }) }
    if (name === 'platform_set_member_status') { if (body.p_user_id === 'owner' && body.p_status !== 'active') return route.fulfill({ status: 409, json: { message: 'Retain at least one active organization-wide access administrator.' } }); const member = members.find((item) => item.user_id === body.p_user_id)!; member.status = String(body.p_status); if (body.p_status === 'removed') member.roles = []; return route.fulfill({ json: { user_id: member.user_id, status: member.status } }) }
    if (name === 'platform_revoke_invitation') { invitations.find((item) => item.id === body.p_invitation_id)!.status = 'revoked'; return route.fulfill({ json: null }) }
    if (name === 'manage_role_catalog') return route.fulfill({ json: catalog(body.p_organization_id ? String(body.p_organization_id) : undefined) })
    if (name === 'available_roles') return route.fulfill({ json: catalog(String(body.p_organization_id)).roles.filter((role) => role.enabled && role.active) })
    if (name === 'platform_list_organizations') {
      const rows = organizations.filter((item) => (!body.p_status || item.status === body.p_status) && item.name.toLowerCase().includes(String(body.p_search ?? '').toLowerCase()))
      return route.fulfill({ json: { rows: rows.slice(Number(body.p_page) * 25, Number(body.p_page) * 25 + 25), total: rows.length } })
    }
    if (name === 'platform_get_organization') return route.fulfill({ json: detail(String(body.p_id)) })
    if (name === 'platform_save_organization') {
      if (body.p_id) {
        const current = organizations.find((item) => item.id === body.p_id)!
        Object.assign(current, { name: body.p_name, timezone: body.p_timezone, status: body.p_status, version: current.version + 1 })
        return route.fulfill({ json: detail(current.id) })
      }
      const key = String(body.p_request_id)
      let id = requests.get(key)
      if (!id) {
        id = 'new-organization'; requests.set(key, id)
        organizations.push({ ...organization, id, name: String(body.p_name), timezone: String(body.p_timezone), onboarding_status: 'pending_admin', member_count: 0 })
        onboardings[id] = { administrator_email: String(body.p_administrator_email), administrator_role_code: String(body.p_administrator_role_code) }
      }
      if (options.unknownCreate && !interrupted) { interrupted = true; return route.fulfill({ status: 500, json: { message: 'Response interrupted. Retry to recover this organization.' } }) }
      return route.fulfill({ json: detail(id) })
    }
    if (name === 'set_organization_role') {
      if (body.p_role_code === 'org_admin' && body.p_enabled === false) return route.fulfill({ status: 409, json: { message: 'Retain at least one active organization-wide access administrator.' } })
      enabled.set(`${body.p_organization_id}/${body.p_role_code}`, Boolean(body.p_enabled))
      return route.fulfill({ json: { enabled: body.p_enabled } })
    }
    const current = roles.find((role) => role.code === body.p_code)
    const saved = { ...(current ?? fieldRole), code: current?.code ?? 'custom_new', label: String(body.p_label), description: String(body.p_description), organization_id: body.p_organization_id ? String(body.p_organization_id) : null, permissions: body.p_permissions as string[], allowed_scope_kinds: body.p_scopes as string[], active: Boolean(body.p_active), default_for_new_organizations: Boolean(body.p_default), requires_company: Boolean(body.p_requires_company), version: (current?.version ?? 0) + 1 }
    if (current) Object.assign(current, saved)
    else { roles.push(saved); if (saved.organization_id) enabled.set(`${saved.organization_id}/${saved.code}`, true) }
    return route.fulfill({ json: saved })
  })
  await page.route('**/functions/v1/platform-invite', async (route) => {
    calls.push({ name: 'platform-invite', body: route.request().postDataJSON() }); deliveries++
    invitations.splice(0, invitations.length, { id: 'invite-new', normalized_email: route.request().postDataJSON().email ?? 'owner@example.test', status: 'pending', expires_at: '2026-11-02T12:00:00Z', created_at: '2026-10-26T12:00:00Z', delivery_error: options.failDelivery && deliveries === 1 ? 'Email provider unavailable' : null })
    if (options.failDelivery && deliveries === 1) return route.fulfill({ status: 503, json: { error: 'Administrator invitation could not be delivered' } })
    return route.fulfill({ json: { invitation_id: 'invite-new', expires_at: '2026-11-02T12:00:00Z' } })
  })
  return { roles, organizations, enabled, calls }
}
test.use({ actionTimeout: 15000 })

test('platform pages and organization role management fit all viewport sizes', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  await setup(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const paths = ['/platform/organizations', '/platform/organizations/new', `/platform/organizations/${org}`, `/platform/organizations/${org}/activity`, `/org/${org}/roles`, `/org/${org}/roles/field_reviewer`, `/org/${org}/roles/new`]
  for (const width of testInfo.project.name.startsWith('mobile') ? [390] : [1440, 768]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const path of paths) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('.loading-state')).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
    }
    await page.goto(`/org/${org}/roles/org_admin`)
    await expect(page.getByRole('textbox', { name: 'Role name' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`role-editor-${width}.png`), fullPage: true })
    await page.goto('/platform/organizations')
    await expect(page.getByRole('link', { name: 'Shared role catalog' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: /Cedar Homes.*active members/ })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`organizations-${width}.png`), fullPage: true })
  }
  expect(errors).toEqual([])
})

test('onboarding recovers an unknown create outcome and sends a separate confirmed invitation', async ({ page }) => {
  const state = await setup(page, { unknownCreate: true, failDelivery: true })
  await page.goto('/platform/organizations/new')
  await page.getByRole('textbox', { name: 'Organization name' }).fill('Harborline Residential')
  await page.getByRole('textbox', { name: 'First administrator email' }).fill('owner@example.test')
  await page.getByRole('combobox', { name: 'First administrator role' }).selectOption('org_admin')
  await page.getByRole('button', { name: 'Create organization', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Response interrupted')
  await page.getByRole('button', { name: 'Create organization', exact: true }).click()
  await expect(page).toHaveURL(/platform\/organizations\/new-organization$/)
  expect(state.organizations.filter((item) => item.name === 'Harborline Residential')).toHaveLength(1)
  const creates = state.calls.filter((call) => call.name === 'platform_save_organization')
  expect(creates[0].body.p_request_id).toBe(creates[1].body.p_request_id)
  expect(state.calls.filter((call) => call.name === 'platform-invite')).toHaveLength(0)
  await page.getByRole('button', { name: 'Send administrator invitation', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm and send invitation', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('could not be delivered')
  await expect(page.getByText('Email provider unavailable', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Confirm and send invitation', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Administrator invitation sent')
  expect(state.calls.filter((call) => call.name === 'platform-invite')).toHaveLength(2)
})

test('organization suspension requires review and preserves the existing record', async ({ page }) => {
  const state = await setup(page)
  await page.goto(`/platform/organizations/${org}/access`)
  await page.getByRole('combobox', { name: 'Change access' }).selectOption('suspended')
  await page.getByRole('textbox', { name: 'Reason', exact: true }).fill('Subscription contract paused by operator')
  await page.getByRole('button', { name: 'Review access change', exact: true }).click()
  expect(state.calls.filter((call) => call.name === 'platform_set_organization_status')).toHaveLength(0)
  await page.getByRole('button', { name: 'Confirm access change', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Organization access updated')
  expect(state.calls.find((call) => call.name === 'platform_set_organization_status')?.body).toMatchObject({ p_organization_id: org, p_expected_version: 1, p_status: 'suspended', p_reason: 'Subscription contract paused by operator' })
})

test('org admin role catalog configures permissions and scopes for organization roles', async ({ page }) => {
  const state = await setup(page, { platform: false })
  await page.goto(`/org/${org}/roles/new`)
  await page.getByRole('textbox', { name: 'Role name' }).fill('Regional onboarding administrator')
  await page.getByRole('checkbox', { name: permissionCatalog[0].description, exact: true }).check()
  await page.getByRole('checkbox', { name: 'Entire organization', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Neighborhood', exact: true }).uncheck()
  await expect(page.getByRole('checkbox', { name: 'Single home', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Create role', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/org/${org}/roles/custom_new$`))
  expect(state.calls.find((call) => call.name === 'save_role_definition')?.body).toMatchObject({ p_organization_id: org, p_scopes: ['organization'], p_permissions: ['access.manage'], p_default: false, p_active: true })
  await page.getByRole('checkbox', { name: 'Role is active', exact: true }).uncheck()
  await page.getByRole('button', { name: 'Review changes', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm role changes', exact: true }).click()
  expect(state.calls.filter((call) => call.name === 'save_role_definition').at(-1)?.body).toMatchObject({ p_organization_id: org, p_active: false, p_expected_version: 1 })
})

test('organization admins remove defaults with lockout protection and create private roles from templates', async ({ page }) => {
  const state = await setup(page, { platform: false })
  await page.goto(`/org/${org}/roles`)
  await expect(page.getByText('Other organization only', { exact: true })).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Show', exact: true }).selectOption('all')
  const fieldRow = page.locator('.role-directory-row').filter({ hasText: 'Field reviewer' })
  await fieldRow.getByRole('button', { name: 'Remove from organization', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Confirm role availability' })).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Show', exact: true }).selectOption('all')
  await expect(fieldRow.getByRole('button', { name: 'Enable role', exact: true })).toBeVisible()
  const adminRow = page.locator('.role-directory-row').filter({ hasText: 'Organization administrator' })
  await adminRow.getByRole('button', { name: 'Remove from organization', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Retain at least one')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await fieldRow.getByRole('link', { name: 'View role', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Role name' })).toBeDisabled()
  await page.getByRole('button', { name: 'Copy as organization role', exact: true }).click()
  await page.getByRole('textbox', { name: 'Role name' }).fill('Closeout reviewer')
  await page.getByRole('button', { name: 'Create role', exact: true }).click()
  await expect(page).toHaveURL(/roles\/custom_new$/)
  expect(state.calls.find((call) => call.name === 'save_role_definition')?.body.p_organization_id).toBe(org)
  await page.goto(`/org/${org}/admin`)
  await page.getByRole('button', { name: 'Invite user', exact: true }).click()
  await page.getByRole('combobox', { name: 'Role', exact: true }).selectOption('custom_new')
  await expect(page.getByRole('combobox', { name: 'Role', exact: true })).toHaveValue('custom_new')
  await expect(page.getByRole('combobox', { name: 'Role', exact: true }).getByRole('option', { name: 'Field reviewer', exact: true })).toHaveCount(0)
})

test('normal tenant roles cannot open platform pages and unverified platform sessions cannot load tenant data', async ({ page }) => {
  const state = await setup(page, { platform: false })
  await page.goto('/platform/organizations')
  await expect(page.getByRole('heading', { name: 'Platform access not granted', exact: true })).toBeVisible({ timeout: 15_000 })
  expect(state.calls.filter((call) => call.name === 'platform_list_organizations')).toHaveLength(0)
})

test('authorized platform administrators can browse with the current MFA-disabled policy', async ({ page }) => {
  const state = await setup(page, { verified: false })
  await page.goto('/platform/organizations')
  await expect(page.getByRole('heading', { name: 'Organizations', exact: true })).toBeVisible()
  expect(state.calls.some((call) => call.name === 'platform_list_organizations')).toBe(true)
})

test('combined pricing uses allowances and requires review without charging', async ({ page }) => {
  const state = await setup(page)
  await page.goto(`/platform/organizations/${org}/pricing`)
  await page.getByRole('textbox', { name: 'Plan name' }).fill('Builder combined plan')
  await page.getByRole('spinbutton', { name: 'Base subscription' }).fill('100')
  await page.getByRole('spinbutton', { name: 'Per active user' }).fill('10')
  await page.getByRole('spinbutton', { name: 'Per active home' }).fill('2')
  await page.getByRole('spinbutton', { name: 'Included users' }).fill('1')
  await page.getByRole('spinbutton', { name: 'Included homes' }).fill('10')
  await expect(page.getByText('USD 114.00 / month', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Review pricing', exact: true }).click()
  expect(state.calls.filter((call) => call.name === 'platform_save_pricing')).toHaveLength(0)
  await page.getByRole('button', { name: 'Confirm pricing', exact: true }).click()
  await expect(page.getByText('Organization pricing saved.', { exact: true })).toBeVisible()
  expect(state.calls.find((call) => call.name === 'platform_save_pricing')?.body.p_config).toMatchObject({ base_rate: 100, user_rate: 10, home_rate: 2, included_users: 1, included_homes: 10 })
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Plan name' })).toHaveValue('Builder combined plan')
})

test('people controls preserve last administrator and confirm removal with a reason', async ({ page }) => {
  const state = await setup(page)
  await page.goto(`/platform/organizations/${org}/people`)
  await page.locator('.platform-member').filter({ hasText: 'owner@example.test' }).getByRole('button', { name: 'Remove', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Reason' }).fill('Administrator handover requested')
  await dialog.getByRole('button', { name: 'Confirm change' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Retain at least one')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.locator('.platform-member').filter({ hasText: 'member@example.test' }).getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(dialog).toContainText('Organization administrators may need to reassign responsibilities.')
  await expect(dialog).not.toContainText('current assignments')
  await dialog.getByRole('textbox', { name: 'Reason' }).fill('Member no longer works with this organization')
  await dialog.getByRole('button', { name: 'Confirm change' }).click()
  await expect(page.locator('.platform-member').filter({ hasText: 'member@example.test' })).toContainText('Removed')
  expect(state.calls.filter((call) => call.name === 'platform_set_member_status').at(-1)?.body).toMatchObject({ p_organization_id: org, p_user_id: 'member', p_status: 'removed', p_expected_status: 'active' })
})

test('platform user invitation requires confirmation and supports revocation', async ({ page }) => {
  const state = await setup(page)
  await page.goto(`/platform/organizations/${org}/people`)
  await page.getByRole('button', { name: 'Invite user', exact: true }).click()
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('new-member@example.test')
  await page.getByRole('combobox', { name: 'Organization-wide role' }).selectOption('org_admin')
  await page.getByRole('button', { name: 'Review invitation', exact: true }).click()
  expect(state.calls.filter((call) => call.name === 'platform-invite')).toHaveLength(0)
  await page.getByRole('button', { name: 'Confirm and send invitation' }).click()
  await expect(page.locator('.platform-invitation')).toContainText('new-member@example.test')
  await page.getByRole('button', { name: 'Revoke invitation', exact: true }).click()
  await page.getByRole('dialog').getByRole('textbox', { name: 'Reason' }).fill('Invitation sent to wrong person')
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm change' }).click()
  await expect(page.locator('.platform-invitation')).toContainText('Revoked')
})

test('organization operations fit desktop tablet and phone', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  await setup(page)
  for (const width of testInfo.project.name.startsWith('mobile') ? [390] : [1440, 768]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const section of ['people', 'pricing', 'access']) {
      await page.goto(`/platform/organizations/${org}/${section}`)
      await expect(page.getByRole('heading', { name: section === 'people' ? 'People & invitations' : section === 'pricing' ? 'Contract pricing' : 'Access & lifecycle', exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`${section}-${width}.png`), fullPage: true })
    }
  }
})
