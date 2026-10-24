import { requireSupabase } from './supabase'
import type { UUID } from '../types/domain'

const MAX_FILE_BYTES = 20 * 1024 * 1024
const ACCEPTED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf'])

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
      purpose: 'correction_evidence'
    }
  })
  if (reservationError) throw reservationError
  if (!reservation?.attachment?.id || !reservation?.upload?.path || !reservation?.upload?.token) throw new Error('The upload reservation was incomplete.')

  const { error: uploadError } = await client.storage
    .from('evidence')
    .uploadToSignedUrl(reservation.upload.path, reservation.upload.token, input.file, { contentType: input.file.type })
  if (uploadError) throw uploadError

  const { data: finalized, error: finalizeError } = await client.functions.invoke('finalize-upload', {
    body: { attachment_id: reservation.attachment.id }
  })
  if (finalizeError) throw finalizeError
  if (finalized?.attachment?.status !== 'ready') throw new Error(finalized?.attachment?.rejection_reason ?? 'The evidence file did not pass validation.')
  return finalized.attachment as { id: UUID; status: string; original_name: string; byte_size: number; created_at: string }
}

export async function downloadEvidence(attachmentId: UUID) {
  const { data, error } = await requireSupabase().functions.invoke('request-download', { body: { attachment_id: attachmentId } })
  if (error) throw error
  if (!data?.url) throw new Error('The authorized download link was not created.')
  window.location.assign(String(data.url))
}
