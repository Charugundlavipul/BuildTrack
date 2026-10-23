import Dexie, { type EntityTable } from 'dexie'
import type { CachedRecord, OfflineOperation, QueueState, UUID } from '../types/domain'
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
  const operation: OfflineOperation = {
    ...input,
    id: input.envelope.operation_id,
    request_hash: await sha256(JSON.stringify(input.envelope)),
    state: 'queued',
    retries: 0,
    created_at: now,
    updated_at: now
  }
  await offlineDb.operations.put(operation)
  return operation
}

export async function stageWorkEvidence(input: {
  userId: UUID
  organizationId: UUID
  neighborhoodId: UUID
  homeId?: UUID | null
  workItemId: UUID
  file: File
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
      work_item_id: input.workItemId
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
      dependencies: [],
      retries: 0,
      created_at: now,
      updated_at: now
    })
  })
  return operationId
}

export async function updateQueueState(id: UUID, state: QueueState, lastError?: string) {
  await offlineDb.operations.update(id, {
    state,
    last_error: lastError,
    updated_at: new Date().toISOString()
  })
}

export function dependencyOrder(operations: OfflineOperation[]) {
  const byId = new Map(operations.map((operation) => [operation.id, operation]))
  const complete = new Set(operations.filter((operation) => operation.state === 'synced').map((operation) => operation.id))
  const pending = operations.filter((operation) => ['queued', 'failed'].includes(operation.state))
  const ordered: OfflineOperation[] = []

  while (pending.length) {
    const index = pending.findIndex((operation) => operation.dependencies.every((dependency) => complete.has(dependency) || !byId.has(dependency)))
    if (index === -1) break
    const [next] = pending.splice(index, 1)
    ordered.push(next)
    complete.add(next.id)
  }
  return { ordered, blocked: pending }
}

function queueStateForError(code?: string): QueueState {
  if (code === 'VERSION_CONFLICT' || code === 'OPERATION_REUSE') return 'conflict'
  if (code === 'FORBIDDEN' || code === 'NOT_FOUND' || code === 'UNAUTHENTICATED') return 'access_revoked'
  return 'failed'
}

export async function synchronizeQueue(userId: UUID, organizationId: UUID) {
  if (!navigator.onLine) throw new Error('The device is offline.')
  const client = requireSupabase()
  const { data: auth, error: authError } = await client.auth.getUser()
  if (authError || !auth.user || auth.user.id !== userId) throw new Error('The queued work belongs to a different or expired session.')

  const { data: membership, error: membershipError } = await client
    .from('my_organizations')
    .select('id')
    .eq('id', organizationId)
    .maybeSingle()

  const scoped = await offlineDb.operations.where('[user_id+organization_id]').equals([userId, organizationId]).toArray()
  if (membershipError || !membership) {
    await Promise.all(scoped.filter((operation) => operation.state !== 'synced').map((operation) => updateQueueState(operation.id, 'access_revoked', 'Organization access is no longer active.')))
    await offlineDb.cache.where('[user_id+organization_id]').equals([userId, organizationId]).delete()
    await offlineDb.blobs.where('[user_id+organization_id]').equals([userId, organizationId]).delete()
    return { synced: 0, failed: 0, conflicts: 0, accessRevoked: scoped.length, blocked: 0 }
  }

  const { ordered, blocked } = dependencyOrder(scoped)
  const result = { synced: 0, failed: 0, conflicts: 0, accessRevoked: 0, blocked: blocked.length }
  for (const operation of ordered) {
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
          file: new File([local.file], local.name, { type: local.mime_type })
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
      if (error) throw error
      if (data?.ok) {
        await updateQueueState(operation.id, 'synced')
        result.synced += 1
        continue
      }
      const state = queueStateForError(data?.error?.code)
      await offlineDb.operations.update(operation.id, {
        state,
        retries: operation.retries + 1,
        last_error: data?.error?.message ?? 'The server rejected this operation.',
        updated_at: new Date().toISOString()
      })
      if (state === 'conflict') result.conflicts += 1
      else if (state === 'access_revoked') result.accessRevoked += 1
      else result.failed += 1
    } catch (error) {
      await offlineDb.operations.update(operation.id, {
        state: 'failed',
        retries: operation.retries + 1,
        last_error: error instanceof Error ? error.message : 'Synchronization failed.',
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
}

export async function purgeExpiredCache() {
  return offlineDb.cache.where('expires_at').belowOrEqual(new Date().toISOString()).delete()
}

export async function purgeAuthorizedCache(userId: UUID) {
  return offlineDb.cache.where('user_id').equals(userId).delete()
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

export async function readHomeOfflineBundle(userId: UUID, organizationId: UUID, homeId: UUID) {
  const record = await offlineDb.cache.get(`${userId}:${organizationId}:home:${homeId}`)
  if (!record || record.expires_at <= new Date().toISOString()) return null
  return record
}
