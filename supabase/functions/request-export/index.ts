import { authenticatedUser, errorResponse, handleOptions, json, serviceClient } from '../_shared/http.ts'
import { csvCell } from '../_shared/files.ts'
import { readExportRows } from '../_shared/query.ts'

const headers = ['record_id','lot_code','address','title','priority','state','due_at_utc','due_at_local','assigned_party','created_at_utc','created_at_local','updated_at_utc','updated_at_local']

function localTimestamp(value: string | null, timezone: string) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(new Date(value))
}

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405)
  let jobId: string | null = null
  try {
    const { client } = await authenticatedUser(request)
    const body = await request.json()
    const filters = body.filters && typeof body.filters === 'object' ? body.filters : {}
    const { data: job, error: jobError } = await client.rpc('create_export_job', {
      p_organization_id: body.organization_id,
      p_export_kind: 'work_items_csv',
      p_filters: filters
    })
    if (jobError) throw jobError
    jobId = job.id

    let query = client.from('work_item_list').select('*').eq('organization_id', body.organization_id).order('updated_at', { ascending: false }).order('id')
    if (filters.state) query = query.eq('state', filters.state)
    if (filters.priority) query = query.eq('priority', filters.priority)
    if (filters.neighborhood_id) query = query.eq('neighborhood_id', filters.neighborhood_id)
    if (filters.home_id) query = query.eq('home_id', filters.home_id)
    if (filters.date_from) query = query.gte('created_at', `${filters.date_from}T00:00:00.000Z`)
    if (filters.date_to) query = query.lt('created_at', new Date(new Date(`${filters.date_to}T00:00:00.000Z`).getTime() + 86400000).toISOString())
    const rows = await readExportRows((from, to) => query.range(from, to))
    const { data: organization, error: organizationError } = await client.from('organizations').select('timezone').eq('id', body.organization_id).single()
    if (organizationError) throw organizationError
    const timezone = organization.timezone || 'UTC'
    const generatedAt = new Date().toISOString()
    const metadataRows = [
      ['generated_at_utc', generatedAt],
      ['generated_at_local', localTimestamp(generatedAt, timezone)],
      ['timezone', timezone],
      ['filters', JSON.stringify(filters)],
      ['denominator_rows', rows?.length ?? 0]
    ].map((row) => row.map(csvCell).join(','))
    const csvRows = [...metadataRows, '', headers.join(','), ...(rows ?? []).map((row) => [
      row.id, row.lot_code, row.address, row.title, row.priority, row.state, row.due_at, localTimestamp(row.due_at, timezone),
      row.assigned_party_name, row.created_at, localTimestamp(row.created_at, timezone), row.updated_at, localTimestamp(row.updated_at, timezone)
    ].map(csvCell).join(','))]
    const csv = `sep=,\r\n${csvRows.join('\r\n')}\r\n`
    const objectKey = `${body.organization_id}/${job.id}/work-items.csv`
    const service = serviceClient()
    const { error: uploadError } = await service.storage.from('exports').upload(objectKey, new Blob([csv], { type: 'text/csv;charset=utf-8' }), { contentType: 'text/csv;charset=utf-8', upsert: false })
    if (uploadError) throw uploadError
    const { error: completionError } = await service.rpc('complete_export_job', { p_job_id: job.id, p_status: 'ready', p_object_key: objectKey, p_row_count: rows.length, p_error: null })
    if (completionError) throw completionError
    const { data: signed, error: signedError } = await service.storage.from('exports').createSignedUrl(objectKey, 60, { download: 'buildtrack-work-items.csv' })
    if (signedError) throw signedError
    return json(request, { job_id: job.id, row_count: rows?.length ?? 0, url: signed.signedUrl, expires_in: 60 })
  } catch (error) {
    if (jobId) await serviceClient().rpc('complete_export_job', { p_job_id: jobId, p_status: 'failed', p_object_key: null, p_row_count: null, p_error: error instanceof Error ? error.message.slice(0, 500) : 'Export failed' })
    return errorResponse(request, error, 'Export failed')
  }
})
