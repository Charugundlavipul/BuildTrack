import { handleOptions, json, requireWorkerSecret, serviceClient } from '../_shared/http.ts'

function messageFor(template: string, payload: Record<string, unknown>, origin: string, organizationId: string) {
  const itemId = String(payload.work_item_id ?? '')
  const deepLink = `${origin}/org/${organizationId}/work/${itemId}`
  if (template === 'work_assigned') return { title: 'New BuildTrack assignment', body: 'A work item has been assigned to you. Sign in to review the location, due date, and instructions.', deepLink }
  if (template === 'work_due') return { title: 'BuildTrack work is due', body: 'Assigned work is due or approaching its due time. Sign in to review the current authoritative status.', deepLink }
  return { title: 'BuildTrack update', body: 'A field operations item needs your attention.', deepLink }
}

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405)
  try {
    requireWorkerSecret(request)
    const service = serviceClient()
    const leaseToken = crypto.randomUUID()
    const { data: jobs, error } = await service.rpc('claim_notification_batch', { p_limit: 50, p_lease_token: leaseToken })
    if (error) throw error
    const origin = (Deno.env.get('APP_ORIGIN') ?? '').split(',')[0]
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const emailFrom = Deno.env.get('EMAIL_FROM')
    const results = []
    for (const job of jobs ?? []) {
      try {
        const { data: membership } = await service.from('organization_memberships').select('status').eq('organization_id', job.organization_id).eq('user_id', job.recipient_user_id).single()
        if (membership?.status !== 'active') {
          await service.from('notification_outbox').update({ status: 'cancelled', lease_token: null, leased_until: null }).eq('id', job.id).eq('lease_token', leaseToken)
          results.push({ id: job.id, status: 'suppressed' })
          continue
        }
        if (job.assignment_episode_id) {
          const { data: work } = await service.from('work_items').select('state,current_assignment_id').eq('id', job.work_item_id).single()
          if (!work || work.current_assignment_id !== job.assignment_episode_id || ['verified','cancelled'].includes(work.state)) {
            await service.from('notification_outbox').update({ status: 'cancelled', lease_token: null, leased_until: null }).eq('id', job.id).eq('lease_token', leaseToken)
            results.push({ id: job.id, status: 'obsolete' })
            continue
          }
        }
        const message = messageFor(job.template_key, job.payload, origin, job.organization_id)
        let providerId = `in-app/${job.id}`
        if (job.channel === 'in_app') {
          const { error: insertError } = await service.from('notifications').insert({ organization_id: job.organization_id, recipient_user_id: job.recipient_user_id, work_item_id: job.work_item_id, ...message })
          if (insertError) throw insertError
        } else {
          if (!resendKey || !emailFrom) throw new Error('Resend is not configured')
          const { data: authUser, error: userError } = await service.auth.admin.getUserById(job.recipient_user_id)
          if (userError || !authUser.user.email) throw new Error('Recipient email is unavailable')
          const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': job.dedupe_key },
            body: JSON.stringify({ from: emailFrom, to: [authUser.user.email], subject: message.title, html: `<p>${message.body}</p><p><a href="${message.deepLink}">Open BuildTrack</a></p>` })
          })
          if (!response.ok) throw new Error(`Email provider returned ${response.status}`)
          const provider = await response.json()
          providerId = provider.id
        }
        await service.rpc('complete_notification', { p_id: job.id, p_lease_token: leaseToken, p_provider_message_id: providerId })
        results.push({ id: job.id, status: 'sent' })
      } catch (jobError) {
        const message = jobError instanceof Error ? jobError.message : 'Notification failed'
        const retryable = !/unavailable|not configured|invalid/i.test(message)
        await service.rpc('fail_notification', { p_id: job.id, p_lease_token: leaseToken, p_error: message, p_retryable: retryable })
        results.push({ id: job.id, status: 'failed' })
      }
    }
    return json(request, { claimed: jobs?.length ?? 0, results })
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : 'Notification dispatch failed' }, 401)
  }
})
