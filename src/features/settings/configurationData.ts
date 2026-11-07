import { useQuery } from '@tanstack/react-query'
import { requireSupabase } from '../../lib/supabase'
import { readAllRows } from '../../lib/queryRows'
import type { PermissionCode } from '../../types/domain'

export const configuration = {
  calendars: { title: 'Business calendars', singular: 'Business calendar', table: 'business_calendars', permission: 'config.manage', description: 'Manage working days, hours, timezones, and holidays.', orgAdminOnly: true },
  checklists: { title: 'Checklist categories', singular: 'Checklist category', table: 'checklist_templates', permission: 'config.manage', description: 'Create reusable room checklist categories, then assign them to spaces in each floor plan.', orgAdminOnly: false },
  engagements: { title: 'Inspector engagements', singular: 'Inspector engagement', table: 'inspection_engagements', permission: 'config.manage', description: 'Manage and revoke time-bounded external inspector access.', orgAdminOnly: false },
  escalations: { title: 'Escalation routes', singular: 'Escalation route', table: 'escalation_routes', permission: 'config.manage', description: 'Choose recipients and the order in which they are contacted.', orgAdminOnly: true },
  notifications: { title: 'Notification rules', singular: 'Notification rule', table: 'notification_rules', permission: 'config.manage', description: 'Manage triggers, business-time delays, and escalation routing.', orgAdminOnly: true },
  milestones: { title: 'Home milestones', singular: 'Home milestone', table: 'home_milestones', permission: 'structure.manage', description: 'Manage planned milestone dates by home.', orgAdminOnly: false },
  requirements: { title: 'Inspection requirements', singular: 'Inspection requirement', table: 'milestone_requirements', permission: 'config.manage', description: 'Choose which inspection types are required for a home milestone.', orgAdminOnly: false }
} as const satisfies Record<string, { title: string; singular: string; table: string; permission: PermissionCode; description: string; orgAdminOnly: boolean }>
export type ConfigurationKind = keyof typeof configuration
export type ConfigRecord = { id: string; [key: string]: unknown }
export const textValue = (record: ConfigRecord | undefined, key: string, fallback = '') => record?.[key] == null ? fallback : String(record[key])
export const localTime = (value: string) => { if (!value) return ''; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
export const inspectionTypes = ['internal_quality', 'external_quality', 'pre_walkthrough', 'final_walkthrough', 'reinspection'] as const
export const triggers = ['assignment_unacknowledged', 'work_due', 'attempt_unreviewed', 'blocked', 'critical_created']
export const recipientKinds = ['assigned_company_manager', 'supervisor', 'area_manager', 'specific_user', 'org_admin']
export const sqlNull = null as unknown as string

export function useConfiguration(org: string | undefined, kind: ConfigurationKind) {
  return useQuery({
    queryKey: ['configuration', org, kind], enabled: Boolean(org), refetchOnWindowFocus: false,
    queryFn: async () => {
      const table = configuration[kind].table
      const rows = await readAllRows((from, to) => requireSupabase().from(table).select('*').eq('organization_id', org!).order('id').range(from, to)) as unknown as ConfigRecord[]
      return kind === 'checklists' ? rows.filter((row) => !row.snapshot_home_id) : rows
    }
  })
}

export function useConfigurationOptions(org: string | undefined, kind: ConfigurationKind) {
  return useQuery({
    queryKey: ['configuration-options', org, kind], enabled: Boolean(org), refetchOnWindowFocus: false,
    queryFn: async () => {
      const client = requireSupabase()
      const tables = new Set<'homes' | 'neighborhoods' | 'escalation_routes' | 'escalation_route_steps' | 'checklist_versions' | 'checklist_questions'>()
      if (['engagements', 'milestones', 'requirements'].includes(kind)) { tables.add('homes'); tables.add('neighborhoods') }
      if (kind === 'notifications') { tables.add('neighborhoods'); tables.add('escalation_routes') }
      if (kind === 'escalations') tables.add('escalation_route_steps')
      if (kind === 'checklists') { tables.add('checklist_versions'); tables.add('checklist_questions') }
      const entries = await Promise.all([...tables].map(async (table) => [table, await readAllRows((from, to) => client.from(table).select('*').eq('organization_id', org!).order('id').range(from, to))] as const))
      const result = Object.fromEntries(entries) as unknown as Record<string, ConfigRecord[]>
      if (kind === 'engagements' || kind === 'escalations') {
        const { data, error } = await client.rpc('participant_directory', { p_organization_id: org!, p_neighborhood_id: sqlNull })
        if (error) throw error
        result.members = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({ ...row, id: String(row.user_id) }))
      }
      return result
    }
  })
}

export function configurationName(row: ConfigRecord) {
  return textValue(row, 'name') || textValue(row, 'purpose') || textValue(row, 'trigger').replaceAll('_', ' ') || textValue(row, 'milestone_code').replaceAll('_', ' ') || row.id
}

export function configurationStatus(row: ConfigRecord, now: number) {
  if ('revoked_at' in row) {
    if (row.revoked_at) return 'revoked'
    if (new Date(textValue(row, 'ends_at')).getTime() <= now) return 'expired'
    if (new Date(textValue(row, 'starts_at')).getTime() > now) return 'scheduled'
    return 'active'
  }
  if ('enabled' in row) return row.enabled ? 'enabled' : 'disabled'
  if ('active' in row) return row.active ? 'active' : 'inactive'
  if ('required' in row) return row.required ? 'required' : 'optional'
  return row.actual_at ? 'recorded' : 'configured'
}
