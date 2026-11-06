import type { Page } from '@playwright/test'

// Browser-only fixtures: no requests are sent to the configured backend.
export const org = '11111111-1111-4111-8111-111111111111'
export const userId = '22222222-2222-4222-8222-222222222222'
const now = '2026-10-25T12:00:00Z'
export const neighborhood = { id: 'community-1', organization_id: org, name: 'Cedar Grove', code: 'CG', division_id: 'division-1', supervisor_user_id: 'supervisor-1', version: 1, updated_at: now, timezone: 'America/New_York', status: 'active', home_count: 24, open_count: 12, overdue_count: 3 }
export const home = { id: 'home-1', organization_id: org, neighborhood_id: neighborhood.id, lot_code: '104', address_line1: '104 Cedar Grove Boulevard', address_line2: 'Unit A', external_reference: 'CRM-104', primary_supervisor_user_id: 'supervisor-1', archived_at: null, city: 'Raleigh', state_code: 'NC', postal_code: '27601', phase: 'interior_finishes', readiness: 'open_work', open_count: 3, updated_at: now, version: 1 }
export const work = { id: 'work-1', organization_id: org, neighborhood_id: neighborhood.id, home_id: home.id, lot_code: '104', address: home.address_line1, title: 'Replace damaged kitchen cabinet door and verify hinge alignment', description: 'The upper cabinet door beside the refrigerator is damaged. Replace the panel and check the adjacent hinges before the homeowner walkthrough.', priority: 'high', state: 'in_progress', assigned_party_name: 'Cedar Finish Carpentry', due_at: now, updated_at: now, version: 2, safety_flag: false }
const inspection = { id: 'inspection-1', organization_id: org, neighborhood_id: neighborhood.id, home_id: home.id, type: 'internal_quality', status: 'in_progress', scheduled_at: now, lot_code: home.lot_code, address_line1: home.address_line1, current_revision: 1, updated_at: now, version: 1, template_version_id: 'template-1', lead_inspector_user_id: userId }
const permissions = ['plan.manage', 'structure.manage', 'access.manage', 'roster.manage', 'work.read_scope', 'work.create', 'work.triage', 'work.assign', 'work.execute_assigned', 'work.verify', 'inspection.manage', 'inspection.perform', 'comment.internal', 'comment.create_shared', 'evidence.upload', 'report.read_scope', 'audit.read_scope', 'config.manage', 'milestone.approve']
const roles = [{ id: 'role-1', role_code: 'org_admin', scope_kind: 'organization', neighborhood_id: null, home_id: null }]
const member = { user_id: userId, display_name: 'Alex Morgan', email: 'alex@example.test', affiliation: 'internal', status: 'active', joined_at: now, roles, companies: [] }

export async function mockWorkspace(page: Page, options: { permissions?: string[]; aal?: 'aal1' | 'aal2'; tables?: Record<string, unknown> } = {}) {
  await page.routeWebSocket('**/realtime/v1/websocket**', (socket) => socket.close())
  const user = { id: userId, email: member.email, email_confirmed_at: now, aud: 'authenticated', role: 'authenticated', user_metadata: { display_name: member.display_name }, app_metadata: {}, created_at: now, factors: [] }
  const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600, aal: options.aal ?? 'aal2', role: 'authenticated' })).toString('base64url')}.fixture`
  await page.addInitScript(({ user, token, org }) => {
    localStorage.setItem('buildtrack.auth', JSON.stringify({ access_token: token, refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }))
    localStorage.setItem('buildtrack.activeOrganization', org)
  }, { user, token, org })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith('/rest/v1/') && !url.pathname.startsWith('/auth/v1/') && !url.pathname.startsWith('/functions/v1/')) return route.continue()
    if (!['GET', 'HEAD'].includes(route.request().method()) && !url.pathname.includes('/rpc/')) return route.fulfill({ json: user })
    const resource = url.pathname.split('/').at(-1)!
    const tables: Record<string, unknown> = {
      roles: [
        { code: 'org_admin', label: 'Org Admin', allowed_scope_kinds: ['organization'] },
        { code: 'division_admin', label: 'Divisional Admin', allowed_scope_kinds: ['division'] },
        { code: 'neighborhood_admin', label: 'Area Construction Manager', allowed_scope_kinds: ['neighborhood'] },
        { code: 'superintendent', label: 'Construction Supervisor', allowed_scope_kinds: ['division', 'neighborhood', 'home'] },
        { code: 'internal_contributor', label: 'Internal contributor', allowed_scope_kinds: ['neighborhood', 'home'] },
        { code: 'inspector', label: 'Inspector', allowed_scope_kinds: ['neighborhood', 'home', 'division', 'company'] },
        { code: 'vendor_admin', label: 'Vendor Manager', allowed_scope_kinds: ['company'], requires_company: true },
        { code: 'trade_technician', label: 'Vendor Tradesman', allowed_scope_kinds: ['company'], requires_company: true }
      ],
      user,
      my_profile: { first_name: 'Alex', last_name: 'Morgan', phone_number: null, contact_email: null, completed_at: now, version: 1, account_email: member.email, email_verified: true, display_name: member.display_name, timezone: 'America/New_York' },
      my_organizations: [{ id: org, name: 'Cedar Homes', timezone: 'America/New_York', status: 'active' }, { id: 'other-org', name: 'Cedar Homes South', timezone: 'America/New_York', status: 'active' }],
      current_access: { organization_id: org, user_id: userId, profile: { display_name: member.display_name, timezone: 'America/New_York' }, membership: { affiliation: 'internal', status: 'active' }, permissions: options.permissions ?? permissions, roles, companies: [] },
      administration_context: { organization_admin: true, grants: [{ scope_kind: 'organization' }], companies: [{ id: 'company-1', name: 'Cedar Finish Carpentry' }] },
      vendor_access_context: { can_edit: true, can_edit_company_details: true, can_edit_profile: true, can_deactivate: true, can_manage_coverage: true, can_manage_team: true, can_manage_eligibility: true, owner_scope_kind: 'organization', owner_label: 'Cedar Homes', coverage: [{ id: 'coverage-1', scope_kind: 'organization', division_id: null, neighborhood_id: null, label: 'Entire organization', authority_level: 1, can_remove: true }] },
      get_dashboard_metrics: { open_count: 12, overdue_count: 3, blocked_count: 2, pending_verification_count: 4 },
      get_report_metrics: { open_count: 12, overdue_count: 3, acknowledgment_median_hours: 2.5, acknowledgment_sample: 24, first_pass_acceptance_pct: 92, first_pass_sample: 24, timezone: 'America/New_York', by_state: [{ label: 'Assigned', value: 4 }, { label: 'In progress', value: 6 }, { label: 'Blocked', value: 2 }] },
      divisions: [{ id: 'division-1', organization_id: org, name: 'Triangle region', status: 'active', version: 1, created_at: now, updated_at: now }],
      neighborhood_summary: [neighborhood], neighborhoods: [neighborhood], home_summary: [home], homes: [home],
      work_item_list: url.searchParams.has('id') ? work : [work, { ...work, id: 'work-2', title: 'Repair exterior flashing at garage entry', state: 'blocked', priority: 'critical' }],
      inspection_list: [inspection], inspections: inspection,
      checklist_questions: [{ id: 'question-1', ordinal: 1, section: 'Interior finishes', label: 'Cabinet doors are secure, aligned, and free from damage', requires_response: true }],
      inspection_responses: [],
      participant_directory: [member], admin_list_members: [member],
      inspection_lead_options: [{ user_id: userId, display_name: member.display_name }],
      company_profile_context: { can_edit: true, can_edit_profile: true, can_edit_ein: true, ein: null },
      space_types: [{ code: 'other', label: 'Other', active: true }],
      master_plans: [],
      project_chat_inbox: { rows: [], total: 0, unread: 0 },
      project_chat_people: [],
      observation_activity: { entries: [{ key: 'event:1', at: now, kind: 'event', actor_id: userId, actor_name: member.display_name, event_type: 'work.started', from_state: 'acknowledged', to_state: 'in_progress', details: {}, visibility: 'shared' }, { key: 'comment:1', at: now, kind: 'comment', actor_id: userId, actor_name: member.display_name, event_type: 'comment.added', details: {}, body: 'Replacement panel arrives Monday. Access through the garage.', visibility: 'shared' }], has_more: false },
      company_delegation_options: null,
      notifications: [{ id: 'notice-1', title: 'Correction is ready for verification', body: 'Lot 104 Â· Kitchen cabinetry. Review the correction and evidence before accepting the work.', deep_link: `/org/${org}/work/work-1`, created_at: now, read_at: null }],
      comments: [{ id: 'comment-1', author_id: userId, body: 'Replacement panel arrives Monday. Access through the garage.', visibility: 'shared', created_at: now }],
      work_events: [{ id: 'event-1', event_type: 'work_started', from_state: 'acknowledged', to_state: 'in_progress', server_at: now }],
      companies: [{ id: 'company-1', name: 'Cedar Finish Carpentry', status: 'active' }],
      attachments: [{ id: 'file-1', original_name: 'Kitchen-cabinet-door-before-correction.jpg', byte_size: 1200000, status: 'ready' }],
      ...options.tables
    }
    let result = resource === 'available_roles' ? tables.roles : resource in tables ? tables[resource] : []
    if (Array.isArray(result) && !url.pathname.includes('/rpc/')) {
      let rows = result as Array<Record<string, unknown>>
      for (const [column, expression] of url.searchParams) {
        if (['select', 'order', 'offset', 'limit', 'or'].includes(column)) continue
        rows = rows.filter((row) => {
          if (!(column in row)) return true
          const value = row[column]
          if (expression.startsWith('eq.')) return String(value) === expression.slice(3)
          if (expression === 'is.null') return value == null
          if (expression.startsWith('lt.')) return value != null && String(value) < expression.slice(3)
          if (expression.startsWith('not.in.(')) return !expression.slice(8, -1).split(',').includes(String(value))
          return true
        })
      }
      if (url.searchParams.has('or') && resource === 'work_item_list') {
        const term = url.searchParams.get('or')!.match(/ilike\."%(.+?)%"/)?.[1]?.replace(/\\([%_\\"])/g, '$1').toLowerCase() ?? ''
        rows = rows.filter((row) => ['title', 'lot_code', 'address'].some((column) => String(row[column] ?? '').toLowerCase().includes(term)))
      }
      const total = rows.length
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = Number(url.searchParams.get('limit') ?? rows.length)
      result = rows.slice(offset, offset + limit)
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-expose-headers': 'content-range', 'content-range': `${offset}-${Math.max(offset, offset + (result as unknown[]).length - 1)}/${total}` }, body: route.request().method() === 'HEAD' ? '' : JSON.stringify(result) })
    }
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/1' }, body: JSON.stringify(result) })
  })
}
