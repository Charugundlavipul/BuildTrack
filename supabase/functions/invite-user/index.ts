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
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString()
    const { data: invitation, error } = await client.rpc('admin_create_invitation', {
      p_organization_id: body.organization_id, p_email: body.email, p_affiliation: body.affiliation,
      p_grants: body.grants, p_company_id: body.company_id ?? null, p_company_kind: body.company_kind ?? null,
      p_token_hash: await invitationHash(token), p_expires_at: expiresAt
    })
    if (error) throw error
    const existing = await deliverInvitation(invitation.id, String(body.email), token)
    return json(request, { invitation_id: invitation.id, expires_at: expiresAt, existing_identity: existing })
  } catch (caught) { return errorResponse(request, caught, 'Invitation failed') }
})
