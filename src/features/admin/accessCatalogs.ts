import { useQuery } from '@tanstack/react-query'
import { requireSupabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'

export type AccessScope = 'organization' | 'division' | 'neighborhood' | 'home' | 'company'
export interface AccessRoleOption { code: string; label: string; allowed_scope_kinds: AccessScope[]; requires_company?: boolean; permissions?: string[] }
export const scopeLabels: Record<AccessScope, string> = { organization: 'Entire organization', division: 'Division', neighborhood: 'Neighborhood', home: 'Single home', company: 'Vendor company' }
export interface AdministrationContext {
  organization_admin: boolean
  grants: Array<{ scope_kind: AccessScope; division_id?: string | null; neighborhood_id?: string | null; company_id?: string | null; ends_at?: string | null; permissions?: string[] }>
  companies: Array<{ id: string; name: string }>
}

export function delegableScopes(role: AccessRoleOption, context: AdministrationContext): AccessScope[] {
  if (role.code === 'vendor_admin') role = { ...role, allowed_scope_kinds: role.allowed_scope_kinds.filter((scope) => scope === 'company') }
  if (context.organization_admin) return role.allowed_scope_kinds
  const grants = context.grants.filter((grant) => !grant.permissions || grant.permissions.includes('access.manage')).filter((grant) => !role.permissions || !grant.permissions || role.permissions.every((permission) => permission === 'company.users.manage' || grant.permissions!.includes(permission)))
  const division = grants.some((grant) => grant.scope_kind === 'division')
  const neighborhood = grants.some((grant) => grant.scope_kind === 'neighborhood')
  const company = context.companies.length > 0 && (division || neighborhood || context.grants.some((grant) => grant.scope_kind === 'company' && (!grant.permissions || grant.permissions.includes('company.users.manage'))))
  return role.allowed_scope_kinds.filter((scope) => scope === 'company' ? company : scope === 'division' ? division : scope === 'neighborhood' || scope === 'home' ? division || neighborhood : false)
}

export function useAccessCatalogs(organizationId: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['admin-access-catalogs', organizationId, user?.id],
    queryFn: async () => {
      const client = requireSupabase()
      const [roleResult, divisionResult, neighborhoodResult, contextResult] = await Promise.all([
        client.rpc('available_roles', { p_organization_id: organizationId }),
        client.from('divisions').select('id,name,status').eq('organization_id', organizationId).eq('status', 'active').order('name'),
        client.from('neighborhoods').select('id,name,division_id,status').eq('organization_id', organizationId).eq('status', 'active').order('name'),
        client.rpc('administration_context', { p_organization_id: organizationId })
      ])
      if (roleResult.error) throw roleResult.error
      if (divisionResult.error) throw divisionResult.error
      if (neighborhoodResult.error) throw neighborhoodResult.error
      if (contextResult.error) throw contextResult.error
      const context = contextResult.data as unknown as AdministrationContext
      const roles = (roleResult.data as unknown as AccessRoleOption[]).map((role) => ({ ...role, allowed_scope_kinds: delegableScopes(role, context) })).filter((role) => role.allowed_scope_kinds.length > 0)
      const peopleGrants = context.grants.filter((grant) => !grant.permissions || grant.permissions.includes('access.manage'))
      const divisions = (divisionResult.data ?? []).filter((division) => context.organization_admin || peopleGrants.some((grant) => grant.scope_kind === 'division' && grant.division_id === division.id))
      const neighborhoods = (neighborhoodResult.data ?? []).filter((area) => context.organization_admin || peopleGrants.some((grant) => grant.scope_kind === 'neighborhood' && grant.neighborhood_id === area.id || grant.scope_kind === 'division' && grant.division_id === area.division_id))
      return { roles: roles.sort((a, b) => a.label.localeCompare(b.label)), companies: context.companies, divisions, neighborhoods, context }
    }
  })
}

export function localDateTime(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
