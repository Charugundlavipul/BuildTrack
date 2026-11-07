import { useQuery } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireSupabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { listFieldContexts, listHomeOfflineBundles } from '../../lib/offline'
import { readAllRows } from '../../lib/queryRows'

// The same authenticated client is used for all quality modules; RLS applies to
// every directory read and every mutation is checked again by its RPC.
export const qualityClient = () => requireSupabase() as unknown as SupabaseClient
export interface PlanSpace { type: string; name: string; level?: number; square_feet?: number | null; checklist_version_id?: string; checklist_items?: string[] }
export interface MasterPlan { id: string; division_id: string; name: string; spaces: PlanSpace[]; levels: number; active: boolean; version: number }
export interface SpaceType { code: string; label: string; active: boolean }
export interface MasterCatalogEntry { kind: string; code: string; label: string; active: boolean; sort_order: number; version: number }
export function useMasterCatalog(kind: 'company_category' | 'construction_phase', enabled = true) {
  return useQuery({ queryKey: ['master-catalog', kind], enabled, queryFn: async () => {
    const { data, error } = await qualityClient().from('master_catalog_entries').select('*').eq('kind', kind).order('sort_order').order('label')
    if (error) throw error
    return data as MasterCatalogEntry[]
  }, staleTime: 60_000 })
}
export function usePlans(org?: string) {
  return useQuery({ queryKey: ['master-plans', org], enabled: Boolean(org), queryFn: async () => {
    const plans = await readAllRows<MasterPlan>((from, to) => qualityClient().from('master_plans').select('*').eq('organization_id', org!).order('name').order('id').range(from, to))
    return plans
  } })
}
export function useSpaceTypes() {
  return useQuery({ queryKey: ['space-types'], queryFn: async () => {
    const { data, error } = await qualityClient().from('space_types').select('*').order('label')
    if (error) throw error
    return data as SpaceType[]
  } })
}
export interface Observation {
  id: string; home_id: string; neighborhood_id: string; inspection_id: string | null; location_id: string | null;
  title: string; description: string; state: string; version: number; reinspection_status: string | null;
  reinspection_assignee_user_id: string | null; reinspection_assigned_at: string | null; reinspection_completed_at: string | null;
  priority: string; safety_flag: boolean
}
export function useObservations(org?: string, inspectionId?: string, reinspectionUser?: string) {
  const { user } = useAuth()
  return useQuery({ queryKey: ['observations', org, inspectionId, reinspectionUser], enabled: Boolean(org), queryFn: async () => {
    if (!navigator.onLine && user) {
      const bundles = await listHomeOfflineBundles(user.id, org!)
      const fields = await listFieldContexts(user.id, org!)
      const records = [...bundles.flatMap((b) => b.work as unknown as Observation[]), ...fields.flatMap((f) => f.observations as unknown as Observation[])]
      const latest = new Map<string, Observation>()
      for (const record of records) if (!latest.has(record.id) || record.version >= latest.get(record.id)!.version) latest.set(record.id, record)
      return [...latest.values()].filter((w) => (!inspectionId || w.inspection_id === inspectionId) && (!reinspectionUser || w.reinspection_assignee_user_id === reinspectionUser))
    }
    return readAllRows<Observation>((from, to) => {
      let query = qualityClient().from('work_items').select('*').eq('organization_id', org!)
      if (inspectionId) query = query.eq('inspection_id', inspectionId).is('observation_id', null)
      if (reinspectionUser) query = query.eq('reinspection_assignee_user_id', reinspectionUser)
      return query.order('created_at').order('id').range(from, to)
    })
  } })
}


export interface InspectionObservation {
  id: string; organization_id: string; inspection_id: string; home_id: string; neighborhood_id: string;
  question_id: string | null; location_id: string | null; space_name: string;
  title: string; description: string; priority: string; safety_flag: boolean;
  status: 'open' | 'actioned' | 'disregarded'; version: number; review_notes: string | null;
  work_items?: Array<{ id: string; title: string; state: string; version: number; home_id: string; observation_id: string; reinspection_status: string | null }>;
}
