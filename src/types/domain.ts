export type UUID = string

export const WORK_STATES = [
  'draft',
  'submitted',
  'assigned',
  'acknowledged',
  'in_progress',
  'blocked',
  'ready_for_verification',
  'rework_required',
  'verified',
  'cancelled'
] as const

export type WorkState = (typeof WORK_STATES)[number]
export type InspectionState = 'draft' | 'in_progress' | 'submitted' | 'amended' | 'cancelled'
export type AttachmentStatus = 'pending_upload' | 'quarantined' | 'ready' | 'rejected' | 'deleted'
export type QueueState =
  | 'local_draft'
  | 'queued'
  | 'uploading'
  | 'sending'
  | 'synced'
  | 'conflict'
  | 'failed'
  | 'access_revoked'

export type DomainErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'INVALID_TRANSITION'
  | 'VERSION_CONFLICT'
  | 'EVIDENCE_NOT_READY'
  | 'ASSIGNEE_INELIGIBLE'
  | 'INDEPENDENCE_REQUIRED'
  | 'OPERATION_REUSE'
  | 'OPERATION_EXPIRED'
  | 'RATE_LIMITED'
  | 'TEMPORARY_FAILURE'

export interface CommandEnvelope<TPayload> {
  operation_id: UUID
  expected_version?: number
  captured_at?: string
  payload: TPayload
}

export interface CommandFailure {
  ok: false
  error: {
    code: DomainErrorCode
    message: string
    field_errors?: Record<string, string>
    current_version?: number
    retryable: boolean
  }
  operation_id: UUID
}

export interface CommandSuccess<T> {
  ok: true
  data: T
  operation_id: UUID
  server_time: string
  replayed: boolean
}

export type CommandResult<T> = CommandSuccess<T> | CommandFailure

export interface OrganizationSummary {
  id: UUID
  name: string
  timezone: string
  status: 'active' | 'suspended' | 'archived'
}

export type PermissionCode =
  | 'structure.manage'
  | 'access.manage'
  | 'roster.manage'
  | 'work.read_scope'
  | 'work.create'
  | 'work.triage'
  | 'work.assign'
  | 'work.execute_assigned'
  | 'work.verify'
  | 'inspection.manage'
  | 'inspection.perform'
  | 'comment.internal'
  | 'comment.create_shared'
  | 'evidence.upload'
  | 'report.read_scope'
  | 'audit.read_scope'
  | 'config.manage'
  | 'milestone.approve'

export interface AccessRole {
  id: UUID
  role_code: string
  scope_kind: 'organization' | 'neighborhood' | 'home'
  neighborhood_id: UUID | null
  home_id: UUID | null
  starts_at: string
  ends_at: string | null
}

export interface AccessContext {
  organization_id: UUID
  user_id: UUID
  membership: { affiliation: 'internal' | 'external'; status: string }
  profile: { display_name: string; preferred_locale: string; timezone: string | null }
  roles: AccessRole[]
  permissions: PermissionCode[]
  companies: Array<{ company_id: UUID; kind: 'manager' | 'technician' }>
}

export interface WorkItemSummary {
  id: UUID
  organization_id: UUID
  neighborhood_id: UUID
  home_id: UUID | null
  lot_code?: string | null
  address?: string | null
  title: string
  description: string
  priority: 'low' | 'normal' | 'high' | 'critical'
  state: WorkState
  safety_flag: boolean
  category_id: UUID | null
  due_at: string | null
  assigned_party_name?: string | null
  updated_at: string
  version: number
}

export interface DashboardMetrics {
  open_count: number
  overdue_count: number
  blocked_count: number
  pending_verification_count: number
  critical_count: number
}

export interface OfflineOperation {
  id: UUID
  user_id: UUID
  organization_id: UUID
  aggregate_id: UUID
  command_name: string
  request_hash: string
  envelope: CommandEnvelope<Record<string, unknown>>
  state: QueueState
  dependencies: UUID[]
  retries: number
  last_error?: string
  created_at: string
  updated_at: string
}

export interface CachedRecord {
  cache_key: string
  user_id: UUID
  organization_id: UUID
  entity_type: string
  entity_id: UUID
  server_version: number
  value: unknown
  cached_at: string
  expires_at: string
}
