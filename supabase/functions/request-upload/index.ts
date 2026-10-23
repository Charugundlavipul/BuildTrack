import { errorStatus, handleOptions, json, serviceClient, userClient } from '../_shared/http.ts'

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405)
  try {
    const body = await request.json()
    const { data: attachment, error } = await userClient(request).rpc('request_attachment_slot', {
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
    })
    if (error) throw error
    const { data: upload, error: uploadError } = await serviceClient().storage.from('evidence').createSignedUploadUrl(attachment.object_key)
    if (uploadError) throw uploadError
    return json(request, { attachment, upload: { path: upload.path, token: upload.token, signed_url: upload.signedUrl } })
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : 'Upload reservation failed' }, errorStatus(error))
  }
})
