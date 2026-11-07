import { authenticatedUser, errorResponse, handleOptions, json, serviceClient } from '../_shared/http.ts'

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405)
  try {
    const body = await request.json()
    const { client, user } = await authenticatedUser(request)
    const slotArgs = {
      p_organization_id: body.organization_id,
      p_neighborhood_id: body.neighborhood_id,
      p_home_id: body.home_id ?? null,
      p_work_item_id: body.work_item_id ?? null,
      p_inspection_id: body.inspection_id ?? null,
      p_comment_id: body.comment_id ?? null,
      p_visibility: body.visibility ?? 'shared',
      p_original_name: body.original_name,
      p_mime_type: body.mime_type,
      p_byte_size: body.byte_size,
      p_purpose: body.purpose
    }
    const { data: attachment, error } = body.operation_id
      ? await client.rpc('request_offline_work_attachment_slot', { ...slotArgs, p_operation_id: body.operation_id, p_inspection_id: undefined, p_comment_id: undefined })
      : body.attachment_id ? await client.from('attachments').select('*').eq('id', body.attachment_id).single()
        : await client.rpc('request_attachment_slot', slotArgs)
    if (error) throw error
    if (!attachment || attachment.uploader_id !== user.id) throw new Error('Attachment not found')
    const { error: accessError } = await client.rpc('authorize_attachment_upload', { p_attachment_id: attachment.id })
    if (accessError) throw accessError
    if (body.attachment_id && (attachment.id !== body.attachment_id || attachment.organization_id !== body.organization_id || attachment.neighborhood_id !== body.neighborhood_id || attachment.work_item_id !== body.work_item_id || attachment.home_id !== (body.home_id ?? null) || attachment.byte_size !== body.byte_size || attachment.mime_type !== body.mime_type || attachment.purpose !== body.purpose)) throw new Error('Upload reservation does not match this file')
    if (body.attachment_id && attachment.work_item_id) {
      const { data: work, error: workError } = await client.from('work_items').select('id').eq('id', attachment.work_item_id).maybeSingle()
      if (workError || !work) throw new Error('Work item is no longer available')
    }
    if (body.attachment_id && (attachment.inspection_id !== (body.inspection_id ?? null) || attachment.comment_id !== (body.comment_id ?? null))) throw new Error('Upload reservation does not match this parent record')
    if (attachment.status === 'ready' || attachment.status === 'quarantined') return json(request, { attachment, upload: null })
    if (attachment.status !== 'pending_upload') throw new Error('Attachment is not available for upload')
    const { data: upload, error: uploadError } = await serviceClient().storage.from('evidence').createSignedUploadUrl(attachment.object_key)
    if (uploadError) throw uploadError
    return json(request, { attachment, upload: { path: upload.path, token: upload.token, signed_url: upload.signedUrl } })
  } catch (error) {
    return errorResponse(request, error, 'Upload reservation failed')
  }
})
