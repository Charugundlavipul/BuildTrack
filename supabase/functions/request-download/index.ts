import { errorStatus, handleOptions, json, serviceClient, userClient } from '../_shared/http.ts'

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405)
  try {
    const { attachment_id } = await request.json()
    const { data: attachment, error } = await userClient(request).from('attachments').select('*').eq('id', attachment_id).eq('status', 'ready').single()
    if (error || !attachment) throw new Error('Attachment not found')
    const path = attachment.derivative_object_key ?? attachment.object_key
    const { data, error: signedError } = await serviceClient().storage.from(attachment.bucket).createSignedUrl(path, 60, { download: attachment.mime_type === 'application/pdf' ? attachment.original_name : false })
    if (signedError) throw signedError
    return json(request, { url: data.signedUrl, expires_in: 60, original_name: attachment.original_name, mime_type: attachment.derivative_object_key ? 'image/png' : attachment.mime_type })
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : 'Download authorization failed' }, errorStatus(error))
  }
})
