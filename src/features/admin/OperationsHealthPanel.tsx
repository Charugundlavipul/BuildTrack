import { useQuery } from '@tanstack/react-query'
import { Activity, AlertTriangle, History } from 'lucide-react'
import { requireSupabase } from '../../lib/supabase'
import { formatDateTime, humanize } from '../../lib/utils'

export function OperationsHealthPanel({ organizationId, canAudit, canConfig }: { organizationId: string; canAudit: boolean; canConfig: boolean }) {
  const audit = useQuery({
    queryKey: ['audit-events', organizationId], enabled: canAudit,
    queryFn: async () => { const { data, error } = await requireSupabase().from('audit_events').select('id,event_type,entity_type,entity_id,actor_id,occurred_at,metadata').eq('organization_id', organizationId).order('occurred_at', { ascending: false }).limit(50); if (error) throw error; return data }
  })
  const delivery = useQuery({
    queryKey: ['delivery-health', organizationId], enabled: canConfig,
    queryFn: async () => { const { data, error } = await requireSupabase().from('notification_outbox').select('id,channel,template_key,status,attempts,last_error,created_at,sent_at').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(100); if (error) throw error; return data }
  })
  const dead = delivery.data?.filter((item) => item.status === 'dead').length ?? 0
  const retrying = delivery.data?.filter((item) => ['pending', 'failed', 'leased'].includes(item.status)).length ?? 0
  if (!canAudit && !canConfig) return null
  return <section className="panel form-panel stack-lg">
    <div className="section-heading admin-section-heading"><div><h2><Activity />Operational health and audit</h2><p>Recent immutable administrative events and notification delivery state.</p></div>{dead > 0 && <span className="state-badge state-blocked"><span />{dead} dead-letter</span>}</div>
    {canConfig && <div className="metrics-grid"><div className="metric-card"><span>Pending/retrying</span><strong>{retrying}</strong><small>Worker queue</small></div><div className="metric-card"><span>Dead-letter</span><strong>{dead}</strong><small>Requires operator review</small></div><div className="metric-card"><span>Sent</span><strong>{delivery.data?.filter((item)=>item.status==='sent').length ?? 0}</strong><small>Latest 100 rows</small></div><div className="metric-card"><span>Total sampled</span><strong>{delivery.data?.length ?? 0}</strong><small>Latest 100 rows</small></div></div>}
    {dead > 0 && <div className="notice danger"><AlertTriangle />Notification delivery has dead-letter rows. Keep delivery disabled until provider/DNS configuration is verified, then follow the notification recovery runbook.</div>}
    {canConfig && !!delivery.data?.length && <details className="command-disclosure"><summary>Delivery details</summary><div className="member-list">{delivery.data.slice(0,25).map((item)=><div key={item.id}><span><strong>{humanize(item.template_key)} · {item.channel}</strong><small>{item.status} · attempt {item.attempts} · {formatDateTime(item.created_at)}{item.last_error ? ` · ${item.last_error}` : ''}</small></span></div>)}</div></details>}
    {canAudit && <div><div className="section-heading"><h2><History />Recent audit trail</h2><span>{audit.data?.length ?? 0} events</span></div><div className="member-list">{audit.data?.map((event)=><div key={event.id}><span><strong>{humanize(event.event_type)}</strong><small>{event.entity_type} {event.entity_id?.slice(0,8) ?? 'n/a'} · actor {event.actor_id?.slice(0,8) ?? 'system'} · {formatDateTime(event.occurred_at)}</small></span></div>)}</div></div>}
  </section>
}
