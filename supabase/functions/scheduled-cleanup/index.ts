import { handleOptions, json, requireWorkerSecret, serviceClient } from '../_shared/http.ts'

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405)
  try {
    requireWorkerSecret(request)
    const service = serviceClient()
    const { data, error } = await service.rpc('run_scheduled_cleanup')
    if (error) throw error
    const { data: expired } = await service.from('attachments').select('object_key,derivative_object_key').eq('status', 'deleted').is('ready_at', null).limit(100)
    const keys = (expired ?? []).flatMap((item) => [item.object_key, item.derivative_object_key].filter(Boolean))
    if (keys.length) await service.storage.from('evidence').remove(keys)
    return json(request, { cleanup: data, storage_objects_removed: keys.length })
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : 'Cleanup failed' }, 401)
  }
})
