import Dexie, { type EntityTable } from 'dexie'
import type { AccessContext, CachedRecord, OfflineOperation, OrganizationSummary, QueueState, UUID, WorkItemSummary } from '../types/domain'
import { requireSupabase } from './supabase'
import { uploadWorkEvidence, validateEvidenceFile } from './uploads'

interface LocalBlob {
  id: UUID
  user_id: UUID
  organization_id: UUID
  operation_id: UUID
  file: Blob
  name: string
  mime_type: string
  created_at: string
}

interface SyncMeta {
  key: string
  value: string
}

export interface CachedWorkDetail {
  item: WorkItemSummary
  events: Array<Record<string, unknown>>
  comments: Array<Record<string, unknown>>
  attachments: Array<Record<string, unknown>>
  corrections?: Array<Record<string, unknown>>
  blockers?: Array<Record<string, unknown>>
}

export interface CachedInspectionDetail {
  observations?: Array<Record<string, unknown>>
  inspection: Record<string, unknown> & { id: UUID; version: number; neighborhood_id: UUID; home_id: UUID; status: string }
  questions: Array<Record<string, unknown>>
  responses: Array<Record<string, unknown>>
}

export interface OfflineHomeBundleValue {
  locations?: Array<Record<string, unknown>>
  home: Record<string, unknown> & { id: UUID; neighborhood_id: UUID; version: number }
  neighborhood?: { id: UUID; name: string }
  work: WorkItemSummary[]
  inspections: Array<Record<string, unknown>>
  workDetails?: Record<UUID, CachedWorkDetail>
  inspectionDetails?: Record<UUID, CachedInspectionDetail>
}

class BuildTrackDatabase extends Dexie {
  operations!: EntityTable<OfflineOperation, 'id'>
  cache!: EntityTable<CachedRecord, 'cache_key'>
  blobs!: EntityTable<LocalBlob, 'id'>
  meta!: EntityTable<SyncMeta, 'key'>

  constructor() {
    super('buildtrack-offline-v1')
    this.version(1).stores({
      operations: 'id, [user_id+organization_id], aggregate_id, state, created_at',
      cache: 'cache_key, [user_id+organization_id], entity_type, entity_id, expires_at',
      blobs: 'id, [user_id+organization_id], operation_id, created_at',
      meta: 'key'
    })
    this.version(2).stores({
      operations: 'id, user_id, [user_id+organization_id], aggregate_id, state, created_at',
      cache: 'cache_key, user_id, [user_id+organization_id], entity_type, entity_id, expires_at',
      blobs: 'id, user_id, [user_id+organization_id], operation_id, created_at',
      meta: 'key'
    })
  }
}

export const offlineDb = new BuildTrackDatabase()

async function sha256(value: string) {
  const encoded = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function enqueueOperation(
  input: Omit<OfflineOperation, 'id' | 'request_hash' | 'state' | 'retries' | 'created_at' | 'updated_at'>
) {
  const now = new Date().toISOString()
  const priorOperations = input.dependencies.length ? [] : await offlineDb.operations
    .where('[user_id+organization_id]').equals([input.user_id, input.organization_id])
    .filter((operation) => operation.aggregate_id === input.aggregate_id && operation.state === 'queued')
    .toArray()
  const prior = priorOperations.sort((left, right) => right.created_at.localeCompare(left.created_at))[0]
  const operation: OfflineOperation = {
    ...input,
    id: input.envelope.operation_id,
    request_hash: await sha256(JSON.stringify(input.envelope)),
    dependencies: input.dependencies.length ? input.dependencies : prior ? [prior.id] : [],
    state: 'queued',
    retries: 0,
    created_at: now,
    updated_at: now
  }
  await offlineDb.operations.put(operation)
  window.dispatchEvent(new Event('buildtrack:queue-changed'))
  return operation
}

export async function stageWorkEvidence(input: {
  userId: UUID
  organizationId: UUID
  neighborhoodId: UUID
  homeId?: UUID | null
  workItemId: UUID
  file: File
  purpose?: 'observation' | 'correction'
  dependencies?: UUID[]
}) {
  validateEvidenceFile(input.file)
  const operationId = crypto.randomUUID()
  const now = new Date().toISOString()
  const envelope = {
    operation_id: operationId,
    captured_at: now,
    payload: {
      neighborhood_id: input.neighborhoodId,
      home_id: input.homeId ?? null,
      work_item_id: input.workItemId,
      purpose: input.purpose ?? 'correction'
    }
  }
  await offlineDb.transaction('rw', offlineDb.operations, offlineDb.blobs, async () => {
    await offlineDb.blobs.put({
      id: crypto.randomUUID(),
      user_id: input.userId,
      organization_id: input.organizationId,
      operation_id: operationId,
      file: input.file,
      name: input.file.name,
      mime_type: input.file.type,
      created_at: now
    })
    await offlineDb.operations.put({
      id: operationId,
      user_id: input.userId,
      organization_id: input.organizationId,
      aggregate_id: input.workItemId,
      command_name: '__upload_evidence',
      request_hash: await sha256(JSON.stringify(envelope)),
      envelope,
      state: 'queued',
      dependencies: input.dependencies ?? [],
      retries: 0,
      created_at: now,
      updated_at: now
    })
  })
  window.dispatchEvent(new Event('buildtrack:queue-changed'))
  return operationId
}

export async function updateQueueState(id: UUID, state: QueueState, lastError?: string) {
  await offlineDb.operations.update(id, {
    state,
    last_error: lastError,
    updated_at: new Date().toISOString()
  })
}

export function dependentOperations(operations: OfflineOperation[], rootId: UUID) {
  const selected = new Set([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const operation of operations) {
      if (operation.state !== 'synced' && !selected.has(operation.id) && operation.dependencies.some((id) => selected.has(id))) {
        selected.add(operation.id); changed = true
      }
    }
  }
  return operations.filter((operation) => selected.has(operation.id))
}

export async function discardLocalOperation(userId: UUID, organizationId: UUID, rootId: UUID) {
  await offlineDb.transaction('rw', offlineDb.operations, offlineDb.blobs, async () => {
    const operations = await offlineDb.operations.where('[user_id+organization_id]').equals([userId, organizationId]).toArray()
    const root = operations.find((operation) => operation.id === rootId)
    if (!root || !['synced', 'failed', 'conflict', 'access_revoked'].includes(root.state)) throw new Error('This operation cannot be discarded in its current state.')
    // Keep acknowledged prerequisites while unresolved local work still depends on them.
    const affected = dependentOperations(operations, rootId)
    if (root.state === 'synced' && affected.length > 1) throw new Error('Dependent local work must finish before this acknowledged operation can be removed.')
    if (affected.some((operation) => ['sending', 'uploading'].includes(operation.state))) throw new Error('Wait for synchronization to finish before discarding this work.')
    for (const operation of affected) {
      await offlineDb.blobs.where('operation_id').equals(operation.id).delete()
      await offlineDb.operations.delete(operation.id)
    }
  })
}

export async function clearAllLocalOperations(userId: UUID, organizationId: UUID) {
  await offlineDb.transaction('rw', offlineDb.operations, offlineDb.blobs, async () => {
    const operations = await offlineDb.operations.where('[user_id+organization_id]').equals([userId, organizationId]).toArray()
    for (const operation of operations) {
      await offlineDb.blobs.where('operation_id').equals(operation.id).delete()
      await offlineDb.operations.delete(operation.id)
    }
  })
}

export function dependencyOrder(operations: OfflineOperation[], automatic = false) {
  const resolved = new Set(operations.filter((operation) => operation.state === 'synced').map((operation) => operation.id))
  const pending = operations.filter((operation) => operation.state === 'queued' || (operation.state === 'failed' && (!automatic || operation.retryable !== false)))
  const ordered: OfflineOperation[] = []

  while (pending.length) {
    const index = pending.findIndex((operation) => operation.dependencies.every((dependency) => resolved.has(dependency)))
    if (index === -1) break
    const [next] = pending.splice(index, 1)
    ordered.push(next)
    resolved.add(next.id)
  }
  return { ordered, blocked: pending }
}

function queueStateForError(code?: string): QueueState {
  if (code === 'VERSION_CONFLICT' || code === 'OPERATION_REUSE' || code === 'INVALID_TRANSITION') return 'conflict'
  if (code === 'FORBIDDEN' || code === 'NOT_FOUND') return 'access_revoked'
  return 'failed'
}

interface SyncResult { synced: number; failed: number; conflicts: number; accessRevoked: number; blocked: number; busy?: boolean }
const runningSyncs = new Map<string, Promise<SyncResult>>()

async function withQueueLock(userId: UUID, organizationId: UUID, run: () => Promise<SyncResult>): Promise<SyncResult> {
  const key = `buildtrack-sync:${userId}:${organizationId}`
  const busy: SyncResult = { synced: 0, failed: 0, conflicts: 0, accessRevoked: 0, blocked: 0, busy: true }
  if (navigator.locks) return navigator.locks.request(key, { ifAvailable: true }, async (lock) => lock ? run() : busy)
  // A short renewed lease protects browsers without the Web Locks API.
  const owner = crypto.randomUUID()
  const ttl = 120_000
  const acquired = await offlineDb.transaction('rw', offlineDb.meta, async () => {
    const previous = await offlineDb.meta.get(key)
    if (previous) {
      try { if ((JSON.parse(previous.value) as { expires: number }).expires > Date.now()) return false } catch { /* replace a damaged lease */ }
    }
    await offlineDb.meta.put({ key, value: JSON.stringify({ owner, expires: Date.now() + ttl }) })
    return true
  })
  if (!acquired) return busy
  const heartbeat = window.setInterval(() => void offlineDb.transaction('rw', offlineDb.meta, async () => {
    const current = await offlineDb.meta.get(key)
    if (current && (JSON.parse(current.value) as { owner: string }).owner === owner) await offlineDb.meta.put({ key, value: JSON.stringify({ owner, expires: Date.now() + ttl }) })
  }).catch(() => undefined), 20_000)
  try { return await run() }
  finally {
    window.clearInterval(heartbeat)
    await offlineDb.transaction('rw', offlineDb.meta, async () => {
      const current = await offlineDb.meta.get(key)
      if (current && (JSON.parse(current.value) as { owner: string }).owner === owner) await offlineDb.meta.delete(key)
    })
  }
}

export function synchronizeQueue(userId: UUID, organizationId: UUID, options: { automatic?: boolean; shouldContinue?: () => boolean } = {}) {
  const key = `${userId}:${organizationId}`
  const existing = runningSyncs.get(key)
  if (existing) return existing
  const task = withQueueLock(userId, organizationId, () => drainQueue(userId, organizationId, options.automatic ?? false, options.shouldContinue ?? (() => true)))
  runningSyncs.set(key, task)
  void task.finally(() => { if (runningSyncs.get(key) === task) runningSyncs.delete(key) }).catch(() => undefined)
  return task
}

async function drainQueue(userId: UUID, organizationId: UUID, automatic: boolean, shouldContinue: () => boolean): Promise<SyncResult> {
  if (!navigator.onLine) throw new Error('The device is offline.')
  const client = requireSupabase()
  const { data: auth, error: authError } = await client.auth.getUser()
  if (authError || !auth.user || auth.user.id !== userId) throw new Error('The queued work belongs to a different or expired session.')

  const { data: membership, error: membershipError } = await client
    .from('my_organizations')
    .select('id')
    .eq('id', organizationId)
    .maybeSingle()

  if (membershipError) throw new Error('Unable to verify organization access. Saved work remains on this device and will retry.')
  const scoped = await offlineDb.operations.where('[user_id+organization_id]').equals([userId, organizationId]).toArray()
  if (!membership) {
    await Promise.all(scoped.filter((operation) => operation.state !== 'synced').map((operation) => updateQueueState(operation.id, 'access_revoked', 'Organization access is no longer active.')))
    await offlineDb.cache.where('[user_id+organization_id]').equals([userId, organizationId]).delete()
    return { synced: 0, failed: 0, conflicts: 0, accessRevoked: scoped.length, blocked: 0 }
  }

  // Once the exclusive lock is held, interrupted operations are safe to resume.
  for (const operation of scoped) {
    if (operation.state === 'sending' || operation.state === 'uploading' || (!automatic && operation.state === 'failed')) {
      operation.state = 'queued'
      operation.retryable = true
      operation.retries = 0
      await updateQueueState(operation.id, 'queued')
    }
  }
  const { ordered, blocked } = dependencyOrder(scoped, automatic)
  const result = { synced: 0, failed: 0, conflicts: 0, accessRevoked: 0, blocked: blocked.length }
  for (const queuedOperation of ordered) {
    if (!shouldContinue() || !navigator.onLine) break
    const operation = await offlineDb.operations.get(queuedOperation.id) ?? queuedOperation
    const prerequisites = await offlineDb.operations.bulkGet(operation.dependencies)
    // A dependency may have failed after ordering; never send its dependent operation.
    if (prerequisites.some((dependency) => !dependency || dependency.state !== 'synced')) {
      result.blocked += 1
      continue
    }
    await offlineDb.operations.update(operation.id, { state: 'sending', updated_at: new Date().toISOString() })
    try {
      if (operation.command_name === '__upload_evidence') {
        const local = await offlineDb.blobs.where('operation_id').equals(operation.id).first()
        if (!local) throw new Error('The local evidence file is no longer available on this device.')
        const payload = operation.envelope.payload
        await offlineDb.operations.update(operation.id, { state: 'uploading', updated_at: new Date().toISOString() })
        await uploadWorkEvidence({
          organizationId,
          neighborhoodId: String(payload.neighborhood_id),
          homeId: payload.home_id ? String(payload.home_id) : null,
          workItemId: String(payload.work_item_id),
          file: new File([local.file], local.name, { type: local.mime_type }),
          purpose: payload.purpose === 'observation' ? 'observation' : 'correction',
          existingAttachmentId: operation.upload_attachment_id,
          operationId: operation.id,
          onReserved: async (attachmentId) => { await offlineDb.operations.update(operation.id, { upload_attachment_id: attachmentId }) }
        })
        await offlineDb.transaction('rw', offlineDb.operations, offlineDb.blobs, async () => {
          await offlineDb.blobs.delete(local.id)
          await updateQueueState(operation.id, 'synced')
        })
        result.synced += 1
        continue
      }
      const { data, error } = await client.functions.invoke('command', {
        body: { command_name: operation.command_name, envelope: operation.envelope }
      })
      let response = data
      if (error) {
        const context = (error as { context?: unknown }).context
        if (context instanceof Response) response = await context.clone().json().catch(() => null)
        if (!response?.error?.code) throw error
      }
      if (response?.ok) {
        await updateQueueState(operation.id, 'synced')
        const nextVersion = response?.data?.version
        if (typeof nextVersion === 'number') {
          const remaining = await offlineDb.operations
            .where('[user_id+organization_id]').equals([userId, organizationId])
            .filter((candidate) => candidate.aggregate_id === operation.aggregate_id && candidate.dependencies.includes(operation.id) && candidate.state === 'queued' && candidate.retries === 0 && candidate.envelope.expected_version !== undefined)
            .toArray()
          for (const candidate of remaining) {
            const envelope = { ...candidate.envelope, expected_version: nextVersion }
            await offlineDb.operations.update(candidate.id, { envelope, request_hash: await sha256(JSON.stringify(envelope)) })
          }
        }
        result.synced += 1
        continue
      }
      const state = queueStateForError(response?.error?.code)
      await offlineDb.operations.update(operation.id, {
        state,
        retries: operation.retries + 1,
        retryable: response?.error?.retryable === true || response?.error?.code === 'UNAUTHENTICATED',
        last_error: response?.error?.message ?? 'The server rejected this operation.',
        updated_at: new Date().toISOString()
      })
      if (state === 'conflict') result.conflicts += 1
      else if (state === 'access_revoked') result.accessRevoked += 1
      else result.failed += 1
    } catch (error) {
      const context = (error as { context?: unknown } | null)?.context
      const status = context instanceof Response ? context.status : Number((error as { status?: number | string } | null)?.status ?? 0)
      const message = context instanceof Response ? await context.clone().json().catch(() => null) as { error?: string } | null : null
      await offlineDb.operations.update(operation.id, {
        state: 'failed',
        retries: operation.retries + 1,
        retryable: !status || status === 401 || status === 408 || status === 429 || status >= 500,
        last_error: typeof message?.error === 'string' ? message.error : error instanceof Error ? error.message : 'Synchronization failed.',
        updated_at: new Date().toISOString()
      })
      result.failed += 1
      if (!navigator.onLine) break
    }
  }
  return result
}

export async function purgeUserData(userId: UUID, organizationId?: UUID) {
  await offlineDb.transaction('rw', offlineDb.operations, offlineDb.cache, offlineDb.blobs, async () => {
    const operationQuery = organizationId
      ? offlineDb.operations.where('[user_id+organization_id]').equals([userId, organizationId])
      : offlineDb.operations.where('user_id').equals(userId)
    const cacheQuery = organizationId
      ? offlineDb.cache.where('[user_id+organization_id]').equals([userId, organizationId])
      : offlineDb.cache.where('user_id').equals(userId)
    const blobQuery = organizationId
      ? offlineDb.blobs.where('[user_id+organization_id]').equals([userId, organizationId])
      : offlineDb.blobs.where('user_id').equals(userId)
    await Promise.all([operationQuery.delete(), cacheQuery.delete(), blobQuery.delete()])
  })
  if (!organizationId) await offlineDb.meta.delete(`organizations:${userId}`)
}

export async function purgeExpiredCache() {
  return offlineDb.cache.where('expires_at').belowOrEqual(new Date().toISOString()).delete()
}

export async function purgeAuthorizedCache(userId: UUID) {
  await Promise.all([
    offlineDb.cache.where('user_id').equals(userId).delete(),
    offlineDb.meta.delete(`organizations:${userId}`)
  ])
}

export async function saveOrganizationSnapshot(userId: UUID, organizations: OrganizationSummary[]) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  await offlineDb.meta.put({
    key: `organizations:${userId}`,
    value: JSON.stringify({ userId, organizations, expiresAt })
  })
}

export async function readOrganizationSnapshot(userId: UUID) {
  const row = await offlineDb.meta.get(`organizations:${userId}`)
  if (!row) return []
  try {
    const snapshot = JSON.parse(row.value) as { userId: UUID; organizations: OrganizationSummary[]; expiresAt: string }
    if (snapshot.userId !== userId || snapshot.expiresAt <= new Date().toISOString()) {
      await offlineDb.meta.delete(row.key)
      return []
    }
    return snapshot.organizations
  } catch {
    await offlineDb.meta.delete(row.key)
    return []
  }
}

export async function saveHomeOfflineBundle(input: {
  userId: UUID
  organizationId: UUID
  homeId: UUID
  serverVersion: number
  value: unknown
}) {
  const cachedAt = new Date()
  const expiresAt = new Date(cachedAt.getTime() + 24 * 60 * 60 * 1000)
  const cacheKey = `${input.userId}:${input.organizationId}:home:${input.homeId}`
  await offlineDb.cache.put({
    cache_key: cacheKey,
    user_id: input.userId,
    organization_id: input.organizationId,
    entity_type: 'home_bundle',
    entity_id: input.homeId,
    server_version: input.serverVersion,
    value: input.value,
    cached_at: cachedAt.toISOString(),
    expires_at: expiresAt.toISOString()
  })
  return cacheKey
}

interface CachedEvidence { homeId: UUID; blob: Blob; name: string; mime: string; sourceSize: number }

export async function cacheHomeEvidence(userId: UUID, organizationId: UUID, homeId: UUID, attachments: Array<Record<string, unknown>>, shouldContinue: () => boolean) {
  const ready = attachments.filter((item) => item.status === 'ready' && item.id)
  const available = new Set(ready.map((item) => String(item.id)))
  const existing = await offlineDb.cache.where('[user_id+organization_id]').equals([userId, organizationId]).filter((record) => record.entity_type === 'evidence' && (record.value as CachedEvidence).homeId === homeId).toArray()
  for (const record of existing) if (!available.has(record.entity_id) && shouldContinue()) await offlineDb.cache.delete(record.cache_key)
  let failed = 0
  for (const attachment of ready) {
    if (!shouldContinue() || !navigator.onLine) break
    const id = String(attachment.id)
    const key = `${userId}:${organizationId}:evidence:${id}`
    const prior = await offlineDb.cache.get(key)
    if (prior && prior.expires_at > new Date().toISOString() && (prior.value as CachedEvidence).sourceSize === Number(attachment.byte_size)) continue
    try {
      const { data, error } = await requireSupabase().functions.invoke('request-download', { body: { attachment_id: id } })
      if (error) throw error
      if (!data?.url) throw new Error('File download was not authorized.')
      const response = await fetch(data.url)
      if (!response.ok) throw new Error('File download failed.')
      const blob = await response.blob()
      if (!shouldContinue() || !navigator.onLine) break
      const now = new Date()
      await offlineDb.cache.put({ cache_key: key, user_id: userId, organization_id: organizationId, entity_type: 'evidence', entity_id: id,
        server_version: 1, value: { homeId, blob, name: String(data.original_name ?? attachment.original_name), mime: String(data.mime_type ?? blob.type), sourceSize: Number(attachment.byte_size) } satisfies CachedEvidence,
        cached_at: now.toISOString(), expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString() })
    } catch { failed++ }
  }
  return { failed }
}

export async function readOfflineEvidence(userId: UUID, organizationId: UUID, attachmentId: UUID) {
  const record = await offlineDb.cache.get(`${userId}:${organizationId}:evidence:${attachmentId}`)
  return record && record.expires_at > new Date().toISOString() ? record.value as CachedEvidence : null
}

export async function readHomeOfflineBundle(userId: UUID, organizationId: UUID, homeId: UUID) {
  const record = await offlineDb.cache.get(`${userId}:${organizationId}:home:${homeId}`)
  if (!record || record.expires_at <= new Date().toISOString()) return null
  return record
}

export async function listHomeOfflineBundles(userId: UUID, organizationId: UUID) {
  const now = new Date().toISOString()
  const records = await offlineDb.cache.where('[user_id+organization_id]').equals([userId, organizationId]).toArray()
  return records
    .filter((record) => record.entity_type === 'home_bundle' && record.expires_at > now)
    .map((record) => record.value as OfflineHomeBundleValue)
}

export async function findOfflineWorkItem(userId: UUID, organizationId: UUID, workItemId: UUID) {
  const bundles = await listHomeOfflineBundles(userId, organizationId)
  for (const bundle of bundles) {
    const detail = bundle.workDetails?.[workItemId]
    if (detail) return detail
    const item = bundle.work.find((candidate) => candidate.id === workItemId)
    if (item) return { item, events: [], comments: [], attachments: [] } satisfies CachedWorkDetail
  }
  return undefined
}

export async function findOfflineInspection(userId: UUID, organizationId: UUID, inspectionId: UUID) {
  const field = await offlineDb.cache.get(`${userId}:${organizationId}:field:inspection:${inspectionId}`)
  let latest = field && field.expires_at > new Date().toISOString() ? (field.value as OfflineFieldContext).inspectionDetail : undefined
  const bundles = await listHomeOfflineBundles(userId, organizationId)
  for (const bundle of bundles) {
    const detail = bundle.inspectionDetails?.[inspectionId]
    if (detail && (!latest || detail.inspection.version > latest.inspection.version)) latest = detail
  }
  if (!latest) return latest
  const pending = await offlineDb.operations.where('[user_id+organization_id]').equals([userId, organizationId])
    .filter((operation) => operation.envelope.payload.inspection_id === inspectionId && !['synced', 'access_revoked'].includes(operation.state)).sortBy('created_at')
  return overlayInspectionOperations(latest, pending)
}

export function overlayInspectionOperations(latest: CachedInspectionDetail, pending: OfflineOperation[]) {
  const responses = new Map(latest.responses.map((response) => [String(response.question_id), response]))
  const observations = new Map((latest.observations ?? []).map((observation) => [String(observation.id), observation]))
  function saveObservation(payload: Record<string, unknown>, fallbackId: string) {
    const existing = payload.question_id == null ? undefined : [...observations.values()].find((row) => row.question_id === payload.question_id && row.status === 'open')
    const id = String(existing?.id ?? payload.id ?? fallbackId)
    observations.set(id, { ...existing, ...payload, id, home_id: latest.inspection.home_id, neighborhood_id: latest.inspection.neighborhood_id,
      space_name: latest.questions.find((question) => question.id === payload.question_id)?.section ?? existing?.space_name ?? 'Whole property', status: 'open', version: existing?.version ?? 1 })
  }
  function saveResponse(item: Record<string, unknown>, operationId: string) {
    responses.set(String(item.question_id), { id: `${operationId}-${item.question_id}`, question_id: item.question_id,
      result: item.response, explanation: item.reason ?? null, finding_work_item_id: item.finding_id ?? null })
    if (item.response === 'fail') {
      saveObservation({ id: item.observation_id, inspection_id: latest.inspection.id, question_id: item.question_id,
        title: item.title ?? latest.questions.find((question) => question.id === item.question_id)?.label ?? 'Observation',
        description: item.description ?? item.reason ?? '', priority: item.priority ?? 'normal', safety_flag: Boolean(item.safety_flag) }, `obs-${item.question_id}`)
    } else {
      for (const [id, observation] of observations) if (observation.question_id === item.question_id && observation.status === 'open') {
        observations.set(id, { ...observation, status: 'disregarded', review_notes: 'Response updated from fail' })
      }
    }
  }
  for (const operation of pending) {
    const payload = operation.envelope.payload
    if (operation.command_name === 'upsert_inspection_response') responses.set(String(payload.question_id), {
      id: operation.id, question_id: payload.question_id, result: payload.response, explanation: payload.reason ?? null, finding_work_item_id: payload.finding_id ?? null
    })
    if (operation.command_name === 'save_inspection_responses' && Array.isArray(payload.responses)) {
      for (const item of payload.responses) if (item && typeof item === 'object') saveResponse(item as Record<string, unknown>, operation.id)
    }
    if (operation.command_name === 'record_inspection_observation') saveObservation(payload, String(payload.id ?? operation.id))
  }
  return { ...latest, responses: [...responses.values()], observations: [...observations.values()] }
}

export interface OfflineFieldContext {
  home: Record<string, unknown> & { id: UUID; neighborhood_id: UUID; version: number }
  locations: Array<Record<string, unknown>>
  observations: Array<Record<string, unknown>>
  inspectionDetail?: CachedInspectionDetail
}
export async function saveFieldContext(userId: UUID, organizationId: UUID, key: string, value: OfflineFieldContext) {
  const now = new Date()
  await offlineDb.cache.put({ cache_key: `${userId}:${organizationId}:field:${key}`, user_id: userId, organization_id: organizationId, entity_type: 'field_context', entity_id: key,
    server_version: value.inspectionDetail?.inspection.version ?? value.home.version, value, cached_at: now.toISOString(), expires_at: new Date(now.getTime() + 86400000).toISOString() })
}
export async function listFieldContexts(userId: UUID, organizationId: UUID) {
  return (await offlineDb.cache.where('[user_id+organization_id]').equals([userId, organizationId]).filter((r) => r.entity_type === 'field_context' && r.expires_at > new Date().toISOString()).toArray()).sort((a, b) => b.cached_at.localeCompare(a.cached_at)).map((r) => r.value as OfflineFieldContext)
}
export function offlineAccessExpiry(access: AccessContext, now = Date.now()) {
  const expiries = access.roles.map((role) => role.ends_at ? Date.parse(role.ends_at) : Infinity).filter(Number.isFinite)
  return new Date(Math.min(now + 86400000, ...expiries)).toISOString()
}
export async function saveAccessSnapshot(userId: UUID, access: AccessContext) {
  await offlineDb.cache.put({ cache_key: `${userId}:${access.organization_id}:access`, user_id: userId, organization_id: access.organization_id, entity_type: 'access_snapshot', entity_id: access.organization_id,
    server_version: 1, value: access, cached_at: new Date().toISOString(), expires_at: offlineAccessExpiry(access) })
}
export async function readAccessSnapshot(userId: UUID, organizationId: UUID) {
  const row = await offlineDb.cache.get(`${userId}:${organizationId}:access`)
  return row && row.expires_at > new Date().toISOString() ? row.value as AccessContext : null
}
export async function purgeOrganizationCache(userId: UUID, organizationId: UUID) {
  await offlineDb.cache.where('[user_id+organization_id]').equals([userId, organizationId]).delete()
}

export async function pendingInspectionDependencies(userId: UUID, organizationId: UUID, inspectionId: UUID) {
  const operations = await offlineDb.operations
    .where('[user_id+organization_id]').equals([userId, organizationId])
    .filter((operation) => ['queued', 'sending', 'uploading'].includes(operation.state))
    .toArray()
  return inspectionOperationDependencies(operations, inspectionId)
}

export function inspectionOperationDependencies(operations: OfflineOperation[], inspectionId: UUID) {
  const creations = operations.filter((operation) => operation.envelope.payload.inspection_id === inspectionId)
  const itemIds = new Set(creations.filter((operation) => operation.command_name === 'create_work_item').map((operation) => operation.envelope.payload.id))
  return [...new Set([...creations.map((operation) => operation.id), ...operations.filter((operation) => itemIds.has(operation.envelope.payload.work_item_id)).map((operation) => operation.id)])]
}
