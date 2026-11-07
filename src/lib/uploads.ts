import { requireSupabase } from './supabase'
import { readOfflineEvidence } from './offline'
import type { UUID } from '../types/domain'

const MAX_FILE_BYTES = 20 * 1024 * 1024
const ACCEPTED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf'])

export function isAvailableCompletionEvidence(file: { status?: unknown; visibility?: unknown; purpose?: unknown; correction_attempt_id?: unknown }) {
  return file.status === 'ready' && file.visibility === 'shared' && file.purpose === 'correction' && file.correction_attempt_id == null
}

export function validateEvidenceFile(file: File) {
  if (file.size <= 0) throw new Error('The selected file is empty.')
  if (file.size > MAX_FILE_BYTES) throw new Error('Evidence files must be 20 MB or smaller.')
  if (!ACCEPTED_MIME_TYPES.has(file.type.toLowerCase())) throw new Error('Use a JPEG, PNG, HEIC, HEIF, or PDF file.')
}

export async function uploadWorkEvidence(input: {
  organizationId: UUID
  neighborhoodId: UUID
  homeId?: UUID | null
  workItemId: UUID
  file: File
  purpose?: 'observation' | 'correction'
  existingAttachmentId?: UUID
  operationId?: UUID
  onReserved?: (attachmentId: UUID) => Promise<void>
}) {
  validateEvidenceFile(input.file)
  const client = requireSupabase()
  const { data: reservation, error: reservationError } = await client.functions.invoke('request-upload', {
    body: {
      organization_id: input.organizationId,
      neighborhood_id: input.neighborhoodId,
      home_id: input.homeId ?? null,
      work_item_id: input.workItemId,
      visibility: 'shared',
      original_name: input.file.name,
      mime_type: input.file.type,
      byte_size: input.file.size,
      purpose: input.purpose ?? 'correction',
      ...(input.operationId ? { operation_id: input.operationId } : {}),
      ...(input.existingAttachmentId ? { attachment_id: input.existingAttachmentId } : {})
    }
  })
  if (reservationError) throw reservationError
  if (!reservation?.attachment?.id) throw new Error('The upload reservation was incomplete.')
  await input.onReserved?.(reservation.attachment.id)
  if (reservation.attachment.status === 'ready') return reservation.attachment as { id: UUID; status: string; original_name: string; byte_size: number; created_at: string }

  if (reservation.attachment.status !== 'quarantined') {
    if (!reservation.upload?.path || !reservation.upload?.token) throw new Error('The upload reservation was incomplete.')
    const { error: uploadError } = await client.storage
      .from('evidence')
      .uploadToSignedUrl(reservation.upload.path, reservation.upload.token, input.file, { contentType: input.file.type })
    // A previous attempt may have uploaded the same reserved object before losing its response.
    // Never overwrite uploaded evidence; finalize the existing object after a duplicate response.
    if (uploadError && Number((uploadError as { status?: number | string; statusCode?: number | string }).status ?? (uploadError as { statusCode?: number | string }).statusCode) !== 409) throw uploadError
  }

  const { data: finalized, error: finalizeError } = await client.functions.invoke('finalize-upload', {
    body: { attachment_id: reservation.attachment.id }
  })
  if (finalizeError) throw finalizeError
  if (finalized?.attachment?.status !== 'ready') throw new Error(finalized?.attachment?.rejection_reason ?? 'The evidence file did not pass validation.')
  return finalized.attachment as { id: UUID; status: string; original_name: string; byte_size: number; created_at: string }
}

export async function downloadEvidence(attachmentId: UUID, userId: UUID, organizationId: UUID) {
  if (navigator.onLine) {
    const { data, error } = await requireSupabase().functions.invoke('request-download', { body: { attachment_id: attachmentId } })
    if (!error && data?.url) { window.location.assign(String(data.url)); return }
    const context = (error as { context?: unknown } | null)?.context
    if (context instanceof Response && [401, 403, 404].includes(context.status)) throw new Error('This file is no longer available to your account.')
  }
  const saved = await readOfflineEvidence(userId, organizationId, attachmentId)
  if (!saved) throw new Error('This file is not saved on this device. Open this home while connected to save it for offline use.')
  const url = URL.createObjectURL(saved.blob)
  const link = document.createElement('a')
  link.href = url; link.download = saved.name
  document.body.appendChild(link); link.click(); link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
