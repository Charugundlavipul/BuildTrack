import { serviceClient } from './http.ts'

export function invitationToken() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}
export async function invitationHash(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

// Called only after a user-context RPC has authorized and persisted the invitation.
export async function deliverInvitation(id: string, email: string, token: string) {
  const service = serviceClient()
  const normalized = email.trim().toLowerCase()
  try {
    const { data: existing, error } = await service.rpc('invitation_identity_exists', { p_email: normalized })
    if (error) throw error
    const origin = (Deno.env.get('APP_ORIGIN') ?? 'http://localhost:5173').split(',')[0].trim()
    const link = `${origin}/accept-invite?token=${encodeURIComponent(token)}`
    if (!existing) {
      const { error } = await service.auth.admin.inviteUserByEmail(normalized, { redirectTo: `${link}&setup=1` })
      if (error) throw error
    } else {
      const key = Deno.env.get('RESEND_API_KEY')
      const from = Deno.env.get('EMAIL_FROM')
      if (!key || !from) throw new Error('Invitation email delivery is not configured')
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `buildtrack-invite/${id}` },
        body: JSON.stringify({ from, to: [normalized], subject: 'You have been invited to BuildTrack', html: `<p>You have been invited to a BuildTrack organization.</p><p><a href="${link}">Review and accept your invitation</a></p><p>This link expires in seven days.</p>` })
      })
      if (!response.ok) throw new Error('Invitation was saved, but the email provider rejected delivery. Retry from the organization page.')
    }
    return Boolean(existing)
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Invitation delivery failed'
    await service.from('invites').update({ delivery_error: message.slice(0, 500) }).eq('id', id)
    throw caught
  }
}
