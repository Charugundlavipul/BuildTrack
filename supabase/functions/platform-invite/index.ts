import { authenticatedUser, errorResponse, handleOptions, json } from '../_shared/http.ts'
import { deliverInvitation, invitationHash, invitationToken } from '../_shared/invitations.ts'

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405)
  try {
    const { client } = await authenticatedUser(request)
    const body = await request.json()
    const token = invitationToken()
    const expires = new Date(Date.now() + 7 * 86400000).toISOString()
    const invitation = { p_organization_id: body.organization_id, p_token_hash: await invitationHash(token), p_expires_at: expires }
    const { data, error } = body.email
      ? await client.rpc('platform_prepare_member_invitation', { ...invitation, p_email: body.email, p_role_code: body.role_code })
      : await client.rpc('platform_prepare_administrator_invitation', invitation)
    if (error) throw error
    const existing = await deliverInvitation(data.id, data.email, token)
    return json(request, { invitation_id: data.id, expires_at: data.expires_at, existing_identity: existing })
  } catch (caught) { return errorResponse(request, caught, 'Administrator invitation could not be delivered') }
})
