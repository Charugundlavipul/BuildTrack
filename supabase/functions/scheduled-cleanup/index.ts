import { errorResponse, handleOptions, json, requireWorkerSecret, serviceClient } from '../_shared/http.ts'

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405)
  try {
    requireWorkerSecret(request)
    const service = serviceClient()
    const { data, error } = await service.rpc('run_scheduled_cleanup')
    if (error) throw error
    const { data: expiredAttachments, error: attachmentError } = await service.from('attachments').select('id,object_key,derivative_object_key').eq('status', 'deleted').is('storage_deleted_at', null).limit(100)
    if (attachmentError) throw attachmentError
    const evidenceKeys = (expiredAttachments ?? []).flatMap((item) => [item.object_key, item.derivative_object_key].filter((key): key is string => Boolean(key)))
    if (evidenceKeys.length) {
      const { error: removeError } = await service.storage.from('evidence').remove(evidenceKeys)
      if (removeError) throw removeError
      const { error: markError } = await service.from('attachments').update({ storage_deleted_at: new Date().toISOString() }).in('id', (expiredAttachments ?? []).map((item) => item.id))
      if (markError) throw markError
    }
    const { data: expiredExports, error: exportError } = await service.from('export_jobs').select('id,object_key').eq('status', 'expired').not('object_key', 'is', null).is('storage_deleted_at', null).limit(100)
    if (exportError) throw exportError
    const exportKeys = (expiredExports ?? []).map((item) => item.object_key).filter((key): key is string => Boolean(key))
    if (exportKeys.length) {
      const { error: removeError } = await service.storage.from('exports').remove(exportKeys)
      if (removeError) throw removeError
      const { error: markError } = await service.from('export_jobs').update({ storage_deleted_at: new Date().toISOString() }).in('id', (expiredExports ?? []).map((item) => item.id))
      if (markError) throw markError
    }
    return json(request, { cleanup: data, evidence_objects_removed: evidenceKeys.length, export_objects_removed: exportKeys.length })
  } catch (error) {
    return errorResponse(request, error, 'Cleanup failed')
  }
})
