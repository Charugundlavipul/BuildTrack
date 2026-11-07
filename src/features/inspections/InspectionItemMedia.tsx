import { useState, type ChangeEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, FileImage, Paperclip } from 'lucide-react'
import { qualityClient } from './qualityData'
import { validateEvidenceFile, downloadEvidence } from '../../lib/uploads'
import { useAuth } from '../auth/AuthProvider'
import { functionErrorMessage } from '../../lib/functionError'

export function InspectionItemMedia({ org, inspectionId, questionId, label, editable, onBusy }: { org: string; inspectionId: string; questionId: string; label: string; editable: boolean; onBusy?: (busy: boolean) => void }) {
  const { user } = useAuth()
  const cache = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const files = useQuery({ queryKey: ['inspection-media', org, inspectionId], enabled: navigator.onLine, queryFn: async () => {
    const { data, error } = await qualityClient().from('attachments').select('id,question_id,original_name,mime_type,byte_size,status').eq('organization_id', org).eq('inspection_id', inspectionId).eq('status', 'ready').order('created_at')
    if (error) throw error
    return data as Array<{ id: string; question_id: string; original_name: string; mime_type: string; byte_size: number; status: string }>
  }, select: (data) => data.filter((file) => file.question_id === questionId) })
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const selected = [...(event.target.files ?? [])]; event.target.value = ''
    if (!selected.length || busy) return
    setBusy(true); onBusy?.(true); setError('')
    try {
      if (selected.length + (files.data?.length ?? 0) > 20) throw new Error('Choose up to 20 files per checklist item.')
      selected.forEach(validateEvidenceFile)
      const client = qualityClient()
      for (const file of selected) {
        const { data: attachment, error: reserveError } = await client.rpc('request_inspection_item_media', { p_inspection: inspectionId, p_question: questionId, p_name: file.name, p_mime: file.type, p_bytes: file.size })
        if (reserveError) throw reserveError
        const { data: reservation, error: requestError } = await client.functions.invoke('request-upload', { body: { attachment_id: attachment.id, organization_id: org, neighborhood_id: attachment.neighborhood_id, home_id: attachment.home_id, work_item_id: null, inspection_id: inspectionId, original_name: file.name, mime_type: file.type, byte_size: file.size, purpose: 'observation' } })
        if (requestError) throw requestError
        const { error: uploadError } = await client.storage.from('evidence').uploadToSignedUrl(reservation.upload.path, reservation.upload.token, file, { contentType: file.type })
        if (uploadError) throw uploadError
        const { data: finalized, error: finalizeError } = await client.functions.invoke('finalize-upload', { body: { attachment_id: attachment.id } })
        if (finalizeError) throw finalizeError
        if (finalized?.attachment?.status !== 'ready') throw new Error('This file did not pass evidence validation.')
      }
    } catch (caught) { setError(await functionErrorMessage(caught, 'Unable to upload evidence.')) }
    finally { await cache.invalidateQueries({ queryKey: ['inspection-media', org, inspectionId] }); setBusy(false); onBusy?.(false) }
  }
  return <section className="item-media" aria-label={`Media for ${label}`}><div className="item-media-heading"><span><Camera size={16} />Item evidence {files.data?.length ? `(${files.data.length})` : ''}</span>{editable && <label className={`button secondary item-media-upload ${busy || !navigator.onLine ? 'is-disabled' : ''}`}><Paperclip size={16} />{busy ? 'Uploading…' : 'Add photos / files'}<input className="sr-only" aria-label={`Upload media for ${label}`} type="file" multiple accept="image/jpeg,image/png,image/heic,image/heif,application/pdf" disabled={busy || !navigator.onLine} onChange={(event) => void upload(event)} /></label>}</div>{editable && !files.data?.length && <small className="muted">Photos or PDFs · 20 MB each · Evidence stays with this checklist item.{!navigator.onLine && ' Connect to upload media.'}</small>}<div className="item-media-files">{files.data?.map((file) => <button type="button" className="item-media-file" key={file.id} onClick={() => user && void downloadEvidence(file.id, user.id, org).catch((caught) => setError(caught.message))}><FileImage size={18} /><span>{file.original_name}<small>{(file.byte_size / 1024 / 1024).toFixed(1)} MB · Open evidence</small></span></button>)}</div>{(error || files.error) && <p className="notice danger" role="alert">{error || files.error!.message}</p>}</section>
}
