import { useQuery } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireSupabase } from './supabase'
import type { DashboardMetrics, UUID, WorkItemSummary } from '../types/domain'

function client(): SupabaseClient {
  return requireSupabase() as unknown as SupabaseClient
}

export interface NeighborhoodRow {
  id: UUID
  organization_id: UUID
  code: string
  name: string
  timezone: string | null
  status: string
  open_count?: number
  overdue_count?: number
  home_count?: number
}

export interface HomeRow {
  id: UUID
  organization_id: UUID
  neighborhood_id: UUID
  lot_code: string
  address_line1: string | null
  city: string | null
  state_code: string | null
  postal_code: string | null
  phase: string
  readiness: string
  open_count?: number
  updated_at: string
  version: number
}

export interface InspectionRow {
  id: UUID
  organization_id: UUID
  neighborhood_id: UUID
  home_id: UUID
  type: string
  status: string
  scheduled_at: string | null
  lot_code?: string
  address_line1?: string | null
  current_revision: number
  updated_at: string
  version: number
}

export interface ChecklistQuestionRow {
  id: UUID
  organization_id: UUID
  version_id: UUID
  ordinal: number
  section: string
  label: string
  category_id: UUID | null
  requires_response: boolean
}

export interface InspectionResponseRow {
  id: UUID
  question_id: UUID
  result: 'pass' | 'fail' | 'not_applicable' | 'not_checked'
  explanation: string | null
  finding_work_item_id: UUID | null
}

export interface ChecklistVersionOption {
  id: UUID
  number: number
  published_at: string
  template_id: UUID
  template_name: string
}

export interface ParticipantOption {
  user_id: UUID
  display_name: string
  affiliation: string
}

export interface CompanyOption {
  id: UUID
  name: string
}

export function useDashboardMetrics(organizationId?: UUID) {
  return useQuery({
    queryKey: ['dashboard-metrics', organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await client().rpc('get_dashboard_metrics', { p_organization_id: organizationId })
      if (error) throw error
      return data as DashboardMetrics
    },
    refetchInterval: 60_000
  })
}

export function useWorkItems(organizationId?: UUID) {
  return useQuery({
    queryKey: ['work-items', organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await client().from('work_item_list').select('*').eq('organization_id', organizationId).order('updated_at', { ascending: false }).limit(250)
      if (error) throw error
      return (data ?? []) as WorkItemSummary[]
    },
    refetchInterval: 60_000
  })
}

export function useWorkItem(organizationId?: UUID, itemId?: UUID) {
  return useQuery({
    queryKey: ['work-item', organizationId, itemId],
    enabled: Boolean(organizationId && itemId),
    queryFn: async () => {
      const [{ data: item, error }, { data: events, error: eventError }, { data: comments, error: commentError }, { data: attachments, error: attachmentError }] = await Promise.all([
        client().from('work_item_list').select('*').eq('organization_id', organizationId).eq('id', itemId).single(),
        client().from('work_events').select('*').eq('organization_id', organizationId).eq('work_item_id', itemId).order('server_at', { ascending: false }),
        client().from('comments').select('id,author_id,visibility,body,created_at').eq('organization_id', organizationId).eq('work_item_id', itemId).order('created_at'),
        client().from('attachments').select('id,original_name,mime_type,byte_size,status,visibility,created_at').eq('organization_id', organizationId).eq('work_item_id', itemId).order('created_at')
      ])
      if (error) throw error
      if (eventError) throw eventError
      if (commentError) throw commentError
      if (attachmentError) throw attachmentError
      return { item: item as WorkItemSummary, events: events ?? [], comments: comments ?? [], attachments: attachments ?? [] }
    }
  })
}

export function useNeighborhoods(organizationId?: UUID) {
  return useQuery({
    queryKey: ['neighborhoods', organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await client().from('neighborhood_summary').select('*').eq('organization_id', organizationId).order('name')
      if (error) throw error
      return (data ?? []) as NeighborhoodRow[]
    }
  })
}

export function useHomes(organizationId?: UUID, neighborhoodId?: UUID) {
  return useQuery({
    queryKey: ['homes', organizationId, neighborhoodId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = client().from('home_summary').select('*').eq('organization_id', organizationId).order('lot_code')
      if (neighborhoodId) query = query.eq('neighborhood_id', neighborhoodId)
      const { data, error } = await query.limit(500)
      if (error) throw error
      return (data ?? []) as HomeRow[]
    }
  })
}

export function useInspections(organizationId?: UUID) {
  return useQuery({
    queryKey: ['inspections', organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await client().from('inspection_list').select('*').eq('organization_id', organizationId).order('updated_at', { ascending: false }).limit(250)
      if (error) throw error
      return (data ?? []) as InspectionRow[]
    }
  })
}

export function useInspection(organizationId?: UUID, inspectionId?: UUID) {
  return useQuery({
    queryKey: ['inspection', organizationId, inspectionId],
    enabled: Boolean(organizationId && inspectionId),
    queryFn: async () => {
      const { data: inspection, error } = await client().from('inspections').select('*').eq('organization_id', organizationId).eq('id', inspectionId).single()
      if (error) throw error
      const [{ data: questions, error: questionError }, { data: responses, error: responseError }] = await Promise.all([
        client().from('checklist_questions').select('*').eq('organization_id', organizationId).eq('version_id', inspection.template_version_id).order('ordinal'),
        client().from('inspection_responses').select('id,question_id,result,explanation,finding_work_item_id').eq('organization_id', organizationId).eq('inspection_id', inspectionId)
      ])
      if (questionError) throw questionError
      if (responseError) throw responseError
      return {
        inspection: inspection as InspectionRow & { template_version_id: UUID; lead_inspector_user_id: UUID },
        questions: (questions ?? []) as ChecklistQuestionRow[],
        responses: (responses ?? []) as InspectionResponseRow[]
      }
    }
  })
}

export function usePublishedChecklistVersions(organizationId?: UUID) {
  return useQuery({
    queryKey: ['published-checklists', organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await client().from('checklist_versions').select('id,number,published_at,template_id,checklist_templates(name)').eq('organization_id', organizationId).not('published_at', 'is', null).order('published_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((row) => ({
        id: String(row.id),
        number: Number(row.number),
        published_at: String(row.published_at),
        template_id: String(row.template_id),
        template_name: String((row.checklist_templates as { name?: string } | null)?.name ?? 'Checklist')
      })) as ChecklistVersionOption[]
    }
  })
}

export function useParticipants(organizationId?: UUID, neighborhoodId?: UUID) {
  return useQuery({
    queryKey: ['participants', organizationId, neighborhoodId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await client().rpc('participant_directory', { p_organization_id: organizationId, p_neighborhood_id: neighborhoodId ?? null })
      if (error) throw error
      return (data ?? []) as ParticipantOption[]
    }
  })
}

export function useRosterCompanies(organizationId?: UUID, neighborhoodId?: UUID) {
  return useQuery({
    queryKey: ['roster-companies', organizationId, neighborhoodId],
    enabled: Boolean(organizationId && neighborhoodId),
    queryFn: async () => {
      const { data, error } = await client().from('neighborhood_trade_rosters').select('company_id,companies(id,name)').eq('organization_id', organizationId).eq('neighborhood_id', neighborhoodId).eq('status', 'active')
      if (error) throw error
      const companies = new Map<string, CompanyOption>()
      for (const row of data ?? []) {
        const company = row.companies as { id?: string; name?: string } | null
        if (company?.id && company.name) companies.set(company.id, { id: company.id, name: company.name })
      }
      return [...companies.values()].sort((left, right) => left.name.localeCompare(right.name))
    }
  })
}

export interface ReportFilters {
  neighborhood_id?: UUID
  home_id?: UUID
  state?: string
  priority?: string
  date_from?: string
  date_to?: string
}

export function useReportMetrics(organizationId?: UUID, filters: ReportFilters = {}) {
  return useQuery({
    queryKey: ['report-metrics', organizationId, filters],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await client().rpc('get_report_metrics', { p_organization_id: organizationId, p_filters: filters })
      if (error) throw error
      return data as Record<string, unknown>
    }
  })
}
