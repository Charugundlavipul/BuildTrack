import { authenticatedUser, errorResponse, handleOptions, json, serviceClient } from '../_shared/http.ts'
import { detectMime, isCleanScanResult, sha256Hex } from '../_shared/files.ts'

async function cloudmersiveScan(blob: Blob, name: string, apiKey: string) {
  const form = new FormData()
  form.append('inputFile', blob, name)
  const response = await fetch('https://api.cloudmersive.com/virus/scan/file/advanced', { method: 'POST', headers: { Apikey: apiKey }, body: form })
  if (!response.ok) throw new Error(`Cloudmersive scan failed (${response.status})`)
  return await response.json()
}

async function convertHeic(blob: Blob, name: string, apiKey: string) {
  const form = new FormData()
  form.append('imageFile', blob, name)
  const response = await fetch('https://api.cloudmersive.com/image/convert/to/png', { method: 'POST', headers: { Apikey: apiKey }, body: form })
  if (!response.ok) throw new Error(`HEIC conversion failed (${response.status})`)
  return await response.blob()
}

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405)
  try {
    const { client, user } = await authenticatedUser(request)
    const body = await request.json()
    const { data: attachment, error } = await client.from('attachments').select('*').eq('id', body.attachment_id).single()
    if (error || !attachment || attachment.uploader_id !== user.id) throw new Error('Attachment not found')
    if (attachment.status === 'ready') return json(request, { attachment })
    if (!['pending_upload', 'quarantined'].includes(attachment.status)) throw new Error('Attachment is not awaiting finalization')

    const cloudmersiveKey = Deno.env.get('CLOUDMERSIVE_API_KEY')
    if (!cloudmersiveKey) throw new Error('Content-validation provider is not configured')
    const service = serviceClient()
    const { data: object, error: downloadError } = await service.storage.from('evidence').download(attachment.object_key)
    if (downloadError || !object) throw new Error('Uploaded object was not found')
    if (object.size !== attachment.byte_size) throw new Error('Uploaded size does not match the reservation')
    const bytes = new Uint8Array(await object.arrayBuffer())
    if (bytes.byteLength !== attachment.byte_size) throw new Error('Uploaded size does not match the reservation')
    const actualMime = detectMime(bytes)
    if (!actualMime) throw new Error('File signature is unsupported or disguised')
    const reservedMime = attachment.mime_type === 'image/heif' ? 'image/heic' : attachment.mime_type
    if (actualMime !== reservedMime) throw new Error('File signature does not match the reserved content type')

    const { error: quarantineError } = await service.rpc('mark_attachment_quarantined', { p_attachment_id: attachment.id })
    if (quarantineError) throw quarantineError
    const scan = await cloudmersiveScan(object, attachment.original_name, cloudmersiveKey)
    const clean = isCleanScanResult(scan)
    let derivativeKey: string | null = null
    if (clean && actualMime === 'image/heic') {
      const derivative = await convertHeic(object, attachment.original_name, cloudmersiveKey)
      derivativeKey = `${attachment.organization_id}/${attachment.id}/display.png`
      const { error: derivativeError } = await service.storage.from('evidence').upload(derivativeKey, derivative, { contentType: 'image/png', upsert: false })
      if (derivativeError) throw derivativeError
    }
    const { data: finalized, error: finalizeError } = await service.rpc('finalize_attachment_record', {
      p_attachment_id: attachment.id,
      p_sha256: await sha256Hex(bytes),
      p_actual_size: bytes.byteLength,
      p_actual_mime: actualMime,
      p_clean: clean,
      p_provider_reference: request.headers.get('x-request-id') ?? crypto.randomUUID(),
      p_derivative_object_key: derivativeKey,
      p_rejection_reason: clean ? null : 'Malware or unsafe embedded content was detected'
    })
    if (finalizeError) {
      if (derivativeKey) await service.storage.from('evidence').remove([derivativeKey])
      throw finalizeError
    }
    if (!clean) await service.storage.from('evidence').remove([attachment.object_key])
    return json(request, { attachment: finalized }, clean ? 200 : 422)
  } catch (error) {
    return errorResponse(request, error, 'Upload finalization failed')
  }
})
