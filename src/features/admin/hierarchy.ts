import { useQuery } from '@tanstack/react-query'
import { requireSupabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { AdministrationContext, AccessScope } from './accessCatalogs'

export function useAdministrationContext(organizationId?: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['administration-context', organizationId, user?.id],
    enabled: Boolean(organizationId && user),
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('administration_context', { p_organization_id: organizationId! })
      if (error) throw error
      return data as unknown as AdministrationContext
    }
  })
}

export function managesScope(context: AdministrationContext | undefined, scope: AccessScope, divisionId?: string | null, neighborhoodId?: string | null, permission = 'structure.manage') {
  if (!context) return false
  if (context.organization_admin) return true
  return context.grants.filter((grant) => !grant.permissions || grant.permissions.includes(permission)).some((grant) => grant.scope_kind === 'organization' ? true : scope === 'division'
    ? grant.scope_kind === 'division' && grant.division_id === divisionId
    : ['neighborhood', 'home'].includes(scope) && (grant.scope_kind === 'neighborhood' && grant.neighborhood_id === neighborhoodId || grant.scope_kind === 'division' && grant.division_id === divisionId))
}

export function ownershipScopes(context?: AdministrationContext): AccessScope[] {
  const grants = context?.grants.filter((grant) => !grant.permissions || grant.permissions.includes('roster.manage')) ?? []
  if (context?.organization_admin || grants.some((grant) => grant.scope_kind === 'organization')) return ['organization', 'division', 'neighborhood']
  if (grants.some((grant) => grant.scope_kind === 'division')) return ['division', 'neighborhood']
  return grants.some((grant) => grant.scope_kind === 'neighborhood') ? ['neighborhood'] : []
}
