import { useQuery, type QueryClient } from '@tanstack/react-query'
import { requireSupabase } from '../../lib/supabase'
import { readAllRows as readAll } from '../../lib/queryRows'
import { useAuth } from '../auth/AuthProvider'
import { listFieldContexts, readHomeOfflineBundle } from '../../lib/offline'
import type { Database } from '../../types/database.generated'

export type PropertyKind = 'divisions' | 'neighborhoods' | 'homes'
export type Division = Database['public']['Tables']['divisions']['Row']
export type Neighborhood = Database['public']['Tables']['neighborhoods']['Row']
export type PropertyHome = Database['public']['Tables']['homes']['Row']
export type HomeLocation = Database['public']['Tables']['home_locations']['Row']
export type PropertyRecord = Division | Neighborhood | PropertyHome

// RPCs accept SQL null, although the generated argument types declare string.
export const sqlNull = null as unknown as string

export function usePropertyDirectory(organizationId?: string) {
  return useQuery({
    queryKey: ['property-directory', organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const client = requireSupabase()
      const [divisions, neighborhoods, homes] = await Promise.all([
        readAll<Division>((from, to) => client.from('divisions').select('*').eq('organization_id', organizationId!).order('name').order('id').range(from, to)),
        readAll<Neighborhood>((from, to) => client.from('neighborhoods').select('*').eq('organization_id', organizationId!).order('name').order('id').range(from, to)),
        readAll<PropertyHome>((from, to) => client.from('homes').select('*').eq('organization_id', organizationId!).order('lot_code').order('id').range(from, to))
      ])
      return { divisions, neighborhoods, homes }
    }
  })
}

export type PropertyDirectory = NonNullable<ReturnType<typeof usePropertyDirectory>['data']>

export function useHomeLocations(organizationId?: string, homeId?: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['property-locations', organizationId, homeId],
    enabled: Boolean(organizationId && homeId),
    queryFn: async () => {
      if (!navigator.onLine && user) { const bundle = await readHomeOfflineBundle(user.id, organizationId!, homeId!); if (bundle) return ((bundle.value as { locations?: HomeLocation[] }).locations ?? []); const contexts = await listFieldContexts(user.id, organizationId!); return (contexts.find((c) => c.home.id === homeId)?.locations ?? []) as HomeLocation[] }
      return readAll<HomeLocation>((from, to) => requireSupabase().from('home_locations').select('*').eq('organization_id', organizationId!).eq('home_id', homeId!).order('name').order('id').range(from, to))
    }
  })
}

export function recordName(record: PropertyRecord) {
  return 'lot_code' in record ? `Lot ${record.lot_code}` : record.name
}

export function isArchived(record: PropertyRecord) {
  return 'archived_at' in record ? Boolean(record.archived_at) : record.status !== 'active'
}

export async function refreshProperties(queryClient: QueryClient, organizationId: string) {
  await Promise.all(['property-directory', 'neighborhoods', 'homes', 'home', 'administration-catalogs', 'catalog-lifecycle', 'admin-summary', 'property-locations'].map((key) => queryClient.invalidateQueries({ queryKey: [key, organizationId] })))
}
