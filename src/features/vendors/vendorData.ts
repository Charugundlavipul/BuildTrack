import { useQuery, type QueryClient } from '@tanstack/react-query'
import { requireSupabase } from '../../lib/supabase'
import { readAllRows } from '../../lib/queryRows'
import type { Database } from '../../types/database.generated'

export type VendorKind = 'vendors' | 'rosters'
export const vendorTitles: Record<VendorKind, string> = { vendors: 'Vendors', rosters: 'Neighborhood rosters' }
export type Vendor = Database['public']['Tables']['companies']['Row']
export type Roster = Database['public']['Tables']['neighborhood_trade_rosters']['Row']
export type VendorRecord = Vendor | Roster
export const sqlNull = null as unknown as string

export function useVendorDirectory(organizationId?: string) {
  return useQuery({
    queryKey: ['vendor-directory', organizationId], enabled: Boolean(organizationId), refetchInterval: 60_000,
    queryFn: async () => {
      const client = requireSupabase()
      const [vendors, rosters, neighborhoods, divisions, memberships] = await Promise.all([
        readAllRows((from, to) => client.from('companies').select('*').eq('organization_id', organizationId!).order('name').order('id').range(from, to)),
        readAllRows((from, to) => client.from('neighborhood_trade_rosters').select('*').eq('organization_id', organizationId!).order('created_at', { ascending: false }).order('id').range(from, to)),
        readAllRows((from, to) => client.from('neighborhoods').select('id,name,status,division_id').eq('organization_id', organizationId!).order('name').order('id').range(from, to)),
        readAllRows((from, to) => client.from('divisions').select('id,name,status').eq('organization_id', organizationId!).order('name').order('id').range(from, to)),
        readAllRows((from, to) => client.from('company_memberships').select('*').eq('organization_id', organizationId!).is('revoked_at', null).order('id').range(from, to))
      ])
      return { vendors, rosters, neighborhoods, divisions, memberships, checkedAt: Date.now() }
    }
  })
}

export type VendorDirectory = NonNullable<ReturnType<typeof useVendorDirectory>['data']>
export interface VendorAccessContext {
  can_edit: boolean
  can_edit_company_details: boolean
  can_edit_profile: boolean
  can_deactivate: boolean
  can_manage_coverage: boolean
  can_manage_team: boolean
  can_manage_eligibility: boolean
  owner_scope_kind: 'organization' | 'division' | 'neighborhood'
  owner_label: string
  coverage: Array<{ id: string; scope_kind: 'organization' | 'division' | 'neighborhood'; division_id: string | null; neighborhood_id: string | null; label: string; authority_level: number; can_remove: boolean }>
}
export function useVendorAccess(organizationId?: string, companyId?: string) {
  return useQuery({
    queryKey: ['vendor-access-context', organizationId, companyId], enabled: Boolean(organizationId && companyId),
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('vendor_access_context', { p_organization_id: organizationId!, p_company_id: companyId! })
      if (error) throw error
      return data as unknown as VendorAccessContext
    }
  })
}

export function rosterEligibility(row: Roster, directory: VendorDirectory, now = directory.checkedAt) {
  if (row.status !== 'active' || directory.vendors.find((item) => item.id === row.company_id)?.status !== 'active' || directory.neighborhoods.find((item) => item.id === row.neighborhood_id)?.status !== 'active') return 'inactive'
  if (row.active_from && new Date(row.active_from).getTime() > now) return 'scheduled'
  if (row.active_to && new Date(row.active_to).getTime() <= now) return 'expired'
  return 'eligible'
}

export function vendorRecordName(kind: VendorKind, row: VendorRecord, directory: VendorDirectory) {
  if ('name' in row) return row.name
  return kind === 'rosters' ? `${directory.vendors.find((item) => item.id === row.company_id)?.name ?? 'Vendor'} · ${directory.neighborhoods.find((item) => item.id === row.neighborhood_id)?.name ?? 'Neighborhood'}` : 'Vendor record'
}

export function vendorRecordActive(row: VendorRecord) { return 'active' in row ? row.active : row.status === 'active' }
export function vendorRoute(organizationId: string, kind: VendorKind, id?: string) {
  return `/org/${organizationId}/vendors${kind === 'vendors' ? '' : `/${kind}`}${id ? `/${id}` : ''}`
}

export async function refreshVendors(client: QueryClient, organizationId: string) {
  await Promise.all(['vendor-directory', 'vendor-access-context', 'administration-context', 'vendor-work', 'administration-catalogs', 'admin-summary', 'admin-access-catalogs', 'admin-companies', 'catalog-lifecycle', 'roster-companies', 'company-delegation'].map((key) => client.invalidateQueries({ queryKey: [key, organizationId] })))
}
