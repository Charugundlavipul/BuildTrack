import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Bell, CheckCheck } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/Ui'
import { requireSupabase } from '../../lib/supabase'
import { formatDateTime } from '../../lib/utils'

export function NotificationsPage() {
  const { org } = useParams()
  const notifications = useQuery({
    queryKey: ['notifications', org],
    enabled: Boolean(org),
    queryFn: async () => {
      const { data, error } = await requireSupabase().from('notifications').select('*').eq('organization_id', org!).is('invalidated_at', null).order('created_at', { ascending: false }).limit(100)
      if (error) throw error
      return data
    },
    refetchInterval: 60_000
  })

  async function markRead(id: string) {
    const { error } = await requireSupabase().from('notifications').update({ read_at: new Date().toISOString() }).eq('organization_id', org!).eq('id', id)
    if (!error) await notifications.refetch()
  }

  async function markAllRead() {
    const { error } = await requireSupabase().from('notifications').update({ read_at: new Date().toISOString() }).eq('organization_id', org!).is('read_at', null)
    if (!error) await notifications.refetch()
  }

  const unread = notifications.data?.filter((item) => !item.read_at).length ?? 0
  return <div className="stack-xl">
    <PageHeader eyebrow="IN-APP INBOX" title="Notifications" description="Alerts are revalidated against your current membership before delivery." actions={<button className="button secondary" disabled={!unread} onClick={() => void markAllRead()}><CheckCheck />Mark all read</button>} />
    {notifications.isLoading && <LoadingState label="Loading notifications" />}
    {notifications.isError && <ErrorState message={notifications.error.message} retry={() => void notifications.refetch()} />}
    {!notifications.isLoading && !notifications.data?.length && <EmptyState title="No notifications" description="Assignment, due-date, verification, and inspection alerts will appear here." />}
    {!!notifications.data?.length && <section className="panel notification-list">{notifications.data.map((item) => <article className={item.read_at ? 'notification-row' : 'notification-row unread'} key={item.id}>
      <span className="icon-tile"><Bell /></span><div><strong>{item.title}</strong><p>{item.body}</p><small>{formatDateTime(item.created_at)}</small></div><div className="inline-actions">{item.deep_link.startsWith(`/org/${org}/`) && <Link className="button secondary" to={item.deep_link} onClick={() => void markRead(item.id)}>Open</Link>}{!item.read_at && <button className="text-button" onClick={() => void markRead(item.id)}>Mark read</button>}</div>
    </article>)}</section>}
  </div>
}
