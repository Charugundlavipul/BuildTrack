import { errorResponse, handleOptions, json, userClient } from '../_shared/http.ts'

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405)
  try {
    const body = await request.json()
    if (typeof body.command_name !== 'string' || !body.envelope) return json(request, { error: 'command_name and envelope are required' }, 422)
    const { data, error } = await userClient(request).rpc('execute_command', {
      p_command_name: body.command_name,
      p_envelope: body.envelope
    })
    if (error) throw error
    const status = data?.ok ? 200 : ({ UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION_ERROR: 422, INVALID_TRANSITION: 409, VERSION_CONFLICT: 409, EVIDENCE_NOT_READY: 409, ASSIGNEE_INELIGIBLE: 422, INDEPENDENCE_REQUIRED: 403, OPERATION_REUSE: 409, OPERATION_EXPIRED: 409, RATE_LIMITED: 429, TEMPORARY_FAILURE: 503 }[data?.error?.code as string] ?? 400)
    return json(request, data, status)
  } catch (error) {
    return errorResponse(request, error, 'Command failed')
  }
})
