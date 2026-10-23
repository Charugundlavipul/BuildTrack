import { authenticatedUser, errorStatus, handleOptions, json, serviceClient } from '../_shared/http.ts'
import { csvCell } from '../_shared/files.ts'

const headers = ['record_id','lot_code','address','title','priority','state','due_at_utc','assigned_party','updated_at_utc']

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405)
  let jobId: string | null = null
  try {
    const { client } = await authenticatedUser(request)
    const body = await request.json()
    const { data: job, error: jobError } = await client.rpc('create_export_job', {
      p_organization_id: body.organization_id,
      p_export_kind: 'work_items_csv',
      p_filters: body.filters ?? {}
    })
    if (jobError) throw jobError
    jobId = job.id

    let query = client.from('work_item_list').select('*').eq('organization_id', body.organization_id).order('updated_at', { ascending: false })
    if (body.filters?.state) query = query.eq('state', body.filters.state)
    if (body.filters?.priority) query = query.eq('priority', body.filters.priority)
    const { data: rows, error: rowError } = await query.limit(10000)
    if (rowError) throw rowError
    const csvRows = [headers.join(','), ...(rows ?? []).map((row) => [
      row.id, row.lot_code, row.address, row.title, row.priority, row.state, row.due_at,
      row.assigned_party_name, row.updated_at
    ].map(csvCell).join(','))]
    const csv = `sep=,\r\n${csvRows.join('\r\n')}\r\n`
    const objectKey = `${body.organization_id}/${job.id}/work-items.csv`
    const service = serviceClient()
    const { error: uploadError } = await service.storage.from('exports').upload(objectKey, new Blob([csv], { type: 'text/csv;charset=utf-8' }), { contentType: 'text/csv;charset=utf-8', upsert: false })
    if (uploadError) throw uploadError
    await service.rpc('complete_export_job', { p_job_id: job.id, p_status: 'ready', p_object_key: objectKey, p_row_count: rows?.length ?? 0, p_error: null })
    const { data: signed, error: signedError } = await service.storage.from('exports').createSignedUrl(objectKey, 60, { download: 'buildtrack-work-items.csv' })
    if (signedError) throw signedError
    return json(request, { job_id: job.id, row_count: rows?.length ?? 0, url: signed.signedUrl, expires_in: 60 })
  } catch (error) {
    if (jobId) await serviceClient().rpc('complete_export_job', { p_job_id: jobId, p_status: 'failed', p_object_key: null, p_row_count: null, p_error: error instanceof Error ? error.message.slice(0, 500) : 'Export failed' })
    return json(request, { error: error instanceof Error ? error.message : 'Export failed' }, errorStatus(error))
  }
})
