import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { MessageSquare } from 'lucide-react'
import { qualityClient } from '../inspections/qualityData'
import { useChatInbox } from './messageData'

export function ProjectMessagesButton({ org }: { org: string }) {
  const inbox = useChatInbox(org)
  const cache = useQueryClient()
  useEffect(() => {
    const client = qualityClient()
    const channel = client.channel(`project-message-notices:${org}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'project_messages', filter: `organization_id=eq.${org}` }, () => { void cache.invalidateQueries({ queryKey: ['project-inbox', org] }) }).subscribe()
    return () => { void client.removeChannel(channel) }
  }, [cache, org])
  const count = inbox.error ? 0 : inbox.data?.unread ?? 0
  return <Link className="icon-button project-messages-button" aria-label={count ? `Messages, ${count} unread` : 'Messages'} to={`/org/${org}/messages`}><MessageSquare />{count > 0 && <span aria-hidden="true">{count > 99 ? '99+' : count}</span>}</Link>
}
