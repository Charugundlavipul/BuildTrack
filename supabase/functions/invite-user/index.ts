import { authenticatedUser, errorResponse, handleOptions, json, serviceClient } from '../_shared/http.ts'

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405)
  try {
    const { client } = await authenticatedUser(request)
    const body = await request.json()
    const token = randomToken()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: invitation, error } = await client.rpc('admin_create_invitation', {
      p_organization_id: body.organization_id,
      p_email: body.email,
      p_affiliation: body.affiliation,
      p_grants: body.grants,
      p_company_id: body.company_id ?? null,
      p_company_kind: body.company_kind ?? null,
      p_token_hash: await hashToken(token),
      p_expires_at: expiresAt
    })
    if (error) throw error

    const service = serviceClient()
    const normalizedEmail = String(body.email).trim().toLowerCase()
    let existing = false
    for (let page = 1; page <= 100 && !existing; page += 1) {
      const { data: users, error: usersError } = await service.auth.admin.listUsers({ page, perPage: 1000 })
      if (usersError) throw usersError
      existing = users.users.some((user) => user.email?.toLowerCase() === normalizedEmail)
      if (users.users.length < 1000) break
    }
    const appOrigin = (Deno.env.get('APP_ORIGIN') ?? 'http://localhost:5173').split(',')[0]
    if (!existing) {
      const { error: authInviteError } = await service.auth.admin.inviteUserByEmail(normalizedEmail, { redirectTo: `${appOrigin}/accept-invite?token=${encodeURIComponent(token)}&setup=1` })
      if (authInviteError) {
        await service.from('invites').update({ delivery_error: authInviteError.message.slice(0, 500) }).eq('id', invitation.id)
        throw authInviteError
      }
      return json(request, { invitation_id: invitation.id, expires_at: expiresAt, existing_identity: false })
    }

    // Existing identities do not receive an Auth invite, so deliver the business invitation directly.
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const emailFrom = Deno.env.get('EMAIL_FROM')
    if (!resendKey || !emailFrom) throw new Error('Resend delivery is not configured')
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `buildtrack-invite/${invitation.id}` },
      body: JSON.stringify({
        from: emailFrom,
        to: [normalizedEmail],
        subject: 'You have been invited to BuildTrack',
        html: `<p>You have been invited to a BuildTrack organization.</p><p><a href="${appOrigin}/accept-invite?token=${encodeURIComponent(token)}">Review and accept this invitation</a></p><p>This link expires in seven days.</p>`
      })
    })
    if (!response.ok) {
      const message = await response.text()
      await service.from('invites').update({ delivery_error: message.slice(0, 500) }).eq('id', invitation.id)
      throw new Error('Invitation was created, but email delivery failed')
    }
    return json(request, { invitation_id: invitation.id, expires_at: expiresAt, existing_identity: existing })
  } catch (error) {
    return errorResponse(request, error, 'Invitation failed')
  }
})
