import { useQuery } from '@tanstack/react-query'
import { qualityClient } from '../inspections/qualityData'
import { requireSupabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { AccessScope } from '../admin/accessCatalogs'

export interface PlatformAccess { administrator: boolean; verified: boolean }
export interface CatalogPermission { code: string; description: string }
export interface CatalogRole {
  code: string; label: string; description: string; organization_id: string | null;
  active: boolean; enabled: boolean; default_for_new_organizations: boolean; requires_company: boolean;
  release_state?: 'available' | 'planned';
  allowed_scope_kinds: AccessScope[]; permissions: string[]; version: number; assignment_count: number
}
export interface RoleCatalog { roles: CatalogRole[]; permissions: CatalogPermission[] }
export interface PlatformOrganization {
  id: string; name: string; timezone: string; status: 'active' | 'suspended' | 'archived';
  onboarding_status: 'pending_admin' | 'ready'; version: number; created_at: string; member_count?: number; administrator_email?: string
}
export interface OrganizationDetail {
  organization: PlatformOrganization;
  onboarding: { administrator_email: string; administrator_role_code: string } | null;
  roles: RoleCatalog;
  invitations: Array<{ id: string; normalized_email: string; status: string; expires_at: string; created_at: string; delivery_error: string | null }>;
  activity: Array<{ action: string; created_at: string }>
}
export function usePlatformAccess() {
  const { user } = useAuth()
  return useQuery({ queryKey: ['platform-access', user?.id], enabled: Boolean(user), queryFn: async () => {
    const { data, error } = await requireSupabase().rpc('platform_access')
    if (error) throw error
    return data as unknown as PlatformAccess
  }, staleTime: 30_000 })
}
export function useRoleCatalog(organizationId?: string, enabled = true) {
  return useQuery({ queryKey: ['role-catalog', organizationId ?? 'platform'], enabled, refetchOnWindowFocus: false, queryFn: async () => {
    const { data, error } = await requireSupabase().rpc('manage_role_catalog', { p_organization_id: organizationId })
    if (error) throw error
    return data as unknown as RoleCatalog
  } })
}
export function useWorkspaceDefaults() {
  return useQuery({ queryKey: ['workspace-defaults'], queryFn: async () => {
    const { data, error } = await qualityClient().rpc('workspace_defaults')
    if (error) throw error
    return data as { default_timezone: string }
  }, staleTime: 300_000 })
}
