import { errorResponse, handleOptions, json, requireWorkerSecret, serviceClient } from '../_shared/http.ts'

function messageFor(template: string, payload: Record<string, unknown>, origin: string, organizationId: string) {
  const itemId = String(payload.work_item_id ?? '')
  const deepLink = `${origin}/org/${organizationId}/work/${itemId}`
  if (template === 'work_assigned') return { title: 'New BuildTrack assignment', body: 'A work item has been assigned to you. Sign in to review the location, due date, and instructions.', deepLink }
  if (template === 'work_due') return { title: 'BuildTrack work is due', body: 'Assigned work is due or approaching its due time. Sign in to review the current authoritative status.', deepLink }
  if (template === 'assignment_unacknowledged') return { title: 'Assignment needs acknowledgment', body: 'An assignment remains unacknowledged and needs attention.', deepLink }
  if (template === 'attempt_unreviewed') return { title: 'Correction is waiting for review', body: 'A submitted correction has not yet received an independent verification decision.', deepLink }
  if (template === 'blocked') return { title: 'Blocked work needs attention', body: 'A work item remains blocked and needs an escalation response.', deepLink }
  if (template === 'critical_created') return { title: 'Critical work item', body: 'A critical field issue needs immediate review.', deepLink }
  return { title: 'BuildTrack update', body: 'A field operations item needs your attention.', deepLink }
}

interface NotificationJob {
  organization_id: string
  recipient_user_id: string
  work_item_id: string | null
  assignment_episode_id: string | null
  template_key: string
  payload: Record<string, unknown>
}

async function stillEligible(service: ReturnType<typeof serviceClient>, job: NotificationJob) {
  const payload = job.payload as Record<string, unknown>
  const trigger = String(payload.trigger ?? job.template_key ?? '')
  const eventKey = String(payload.event_key ?? '')
  if (job.work_item_id) {
    const { data: work } = await service.from('work_items').select('state,current_assignment_id').eq('organization_id', job.organization_id).eq('id', job.work_item_id).single()
    if (!work || ['verified','cancelled'].includes(work.state)) return false
    if (job.assignment_episode_id && ['work_assigned','assignment_unacknowledged','work_due'].includes(trigger) && work.current_assignment_id !== job.assignment_episode_id) return false
  }
  if (trigger === 'assignment_unacknowledged' && job.assignment_episode_id) {
    const { data } = await service.from('assignment_episodes').select('acknowledged_at,ended_at').eq('organization_id', job.organization_id).eq('id', job.assignment_episode_id).single()
    if (!data || data.acknowledged_at || data.ended_at) return false
  }
  if (trigger === 'attempt_unreviewed' && eventKey.startsWith('attempt:')) {
    const attemptId = eventKey.slice('attempt:'.length)
    const { count } = await service.from('verifications').select('id', { count: 'exact', head: true }).eq('organization_id', job.organization_id).eq('correction_attempt_id', attemptId)
    if ((count ?? 0) > 0) return false
  }
  if (trigger === 'blocked' && eventKey.startsWith('blocker:')) {
    const blockerId = eventKey.slice('blocker:'.length)
    const { data } = await service.from('blocker_events').select('resolved_at').eq('organization_id', job.organization_id).eq('id', blockerId).single()
    if (!data || data.resolved_at) return false
  }
  const recipientKind = String(payload.recipient_kind ?? '')
  if (recipientKind === 'assigned_company_manager') {
    const { count } = await service.from('company_memberships').select('id', { count: 'exact', head: true }).eq('organization_id', job.organization_id).eq('company_id', payload.company_id).eq('user_id', job.recipient_user_id).eq('kind', 'manager').is('revoked_at', null).lte('active_from', new Date().toISOString()).or(`active_to.is.null,active_to.gt.${new Date().toISOString()}`)
    if ((count ?? 0) === 0) return false
  }
  if (recipientKind === 'org_admin' || recipientKind === 'area_manager') {
    const { data: assignments } = await service.from('role_assignments').select('scope_kind,neighborhood_id,home_id').eq('organization_id', job.organization_id).eq('user_id', job.recipient_user_id).eq('role_code', recipientKind).is('revoked_at', null).lte('starts_at', new Date().toISOString()).or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`)
    const scoped = (assignments ?? []).some((assignment) => recipientKind === 'org_admin'
      ? assignment.scope_kind === 'organization'
      : assignment.scope_kind === 'organization' || (assignment.scope_kind === 'neighborhood' && assignment.neighborhood_id === payload.neighborhood_id) || (assignment.scope_kind === 'home' && assignment.home_id === payload.home_id))
    if (!scoped) return false
  }
  if (recipientKind === 'supervisor') {
    const [{ data: neighborhood }, { data: home }] = await Promise.all([
      service.from('neighborhoods').select('supervisor_user_id').eq('organization_id', job.organization_id).eq('id', payload.neighborhood_id).maybeSingle(),
      payload.home_id ? service.from('homes').select('primary_supervisor_user_id').eq('organization_id', job.organization_id).eq('id', payload.home_id).maybeSingle() : Promise.resolve({ data: null })
    ])
    if ((home?.primary_supervisor_user_id ?? neighborhood?.supervisor_user_id) !== job.recipient_user_id) return false
  }
  return true
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
        if (!await stillEligible(service, job)) {
          await service.from('notification_outbox').update({ status: 'cancelled', lease_token: null, leased_until: null }).eq('id', job.id).eq('lease_token', leaseToken)
          results.push({ id: job.id, status: 'obsolete' })
          continue
        }
        const message = messageFor(job.template_key, job.payload, origin, job.organization_id)
        let providerId = `in-app/${job.id}`
        if (job.channel === 'in_app') {
          const { error: insertError } = await service.from('notifications').upsert({ organization_id: job.organization_id, recipient_user_id: job.recipient_user_id, work_item_id: job.work_item_id, outbox_id: job.id, ...message }, { onConflict: 'organization_id,outbox_id', ignoreDuplicates: true })
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
    return errorResponse(request, error, 'Notification dispatch failed')
  }
})
