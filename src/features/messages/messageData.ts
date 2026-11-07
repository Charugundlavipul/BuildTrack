import { useEffect } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { qualityClient } from '../inspections/qualityData'
import { useAuth } from '../auth/AuthProvider'
import { offlineDb, offlineAccessExpiry, purgeOrganizationCache } from '../../lib/offline'

export interface Conversation { id: string; title: string; unread: number; can_manage?: boolean; audience?: 'partners' | 'internal' }
export interface ChatPerson { user_id: string; display_name: string; affiliation?: string; has_access?: boolean; last_read_seq?: number; role_label?: string }
export interface ChatMessage { id: string; seq: number; author_id: string; author_name: string; body: string; kind: 'message' | 'system'; reply_to: string | null; created_at: string; reply_name?: string | null; reply_body?: string | null; operation_id?: string }
export interface ChatThread { conversation: Conversation; members: ChatPerson[]; messages: ChatMessage[]; has_more: boolean }
interface ChatInbox { rows: Conversation[]; total: number; unread: number }

async function cachedRpc<T>(userId: string, org: string, key: string, rpc: string, args: Record<string, unknown>, expires: string): Promise<T> {
  const cacheKey = `${userId}:${org}:messages:${key}`
  if (!navigator.onLine) {
    const saved = await offlineDb.cache.get(cacheKey)
    if (!saved || saved.expires_at <= new Date().toISOString()) throw new Error('Connect to load this conversation. Only conversations opened on this device are available offline.')
    return saved.value as T
  }
  const { data, error } = await qualityClient().rpc(rpc, args)
  if (error) { if (['42501', 'PGRST301'].includes(error.code)) await purgeOrganizationCache(userId, org); throw error }
  await offlineDb.cache.put({ cache_key: cacheKey, user_id: userId, organization_id: org, entity_type: 'project_messages', entity_id: key, server_version: 1, value: data, cached_at: new Date().toISOString(), expires_at: expires }).catch(() => undefined)
  return data as T
}
export function useChatInbox(org?: string, page = 0, search = '') {
  const { user, access } = useAuth()
  return useQuery({ queryKey: ['project-inbox', org, page, search], networkMode: 'always', enabled: Boolean(org && user && access?.organization_id === org), queryFn: () => cachedRpc<ChatInbox>(user!.id, org!, `inbox:${page}:${search}`, 'project_chat_inbox', { p_org: org, p_page: page, p_search: search }, offlineAccessExpiry(access!)), refetchInterval: 15000 })
}
export function useChatThread(org: string, conversation?: string) {
  const { user, access } = useAuth()
  const cache = useQueryClient()
  useEffect(() => {
    if (!conversation || !navigator.onLine) return
    const client = qualityClient()
    const subscription = client.channel(`project-chat:${org}:${conversation}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'project_messages', filter: `conversation_id=eq.${conversation}` }, () => {
      void cache.invalidateQueries({ queryKey: ['project-thread', org, conversation] })
      void cache.invalidateQueries({ queryKey: ['project-inbox', org] })
    }).subscribe()
    return () => { void client.removeChannel(subscription) }
  }, [cache, conversation, org])
  return useInfiniteQuery({
    queryKey: ['project-thread', org, conversation], networkMode: 'always', enabled: Boolean(user && conversation && access?.organization_id === org), initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => cachedRpc<ChatThread>(user!.id, org, `${conversation}:${pageParam ?? 'latest'}`, 'project_chat_read', { p_org: org, p_conversation: conversation, p_before: pageParam }, offlineAccessExpiry(access!)),
    getNextPageParam: (last) => last.has_more && last.messages?.length ? last.messages.at(-1)!.seq : undefined, refetchInterval: 15000
  })
}
export function useChatPeople(org: string, audience = 'partners') {
  return useQuery({
    queryKey: ['project-chat-people', org, audience], enabled: Boolean(org && navigator.onLine), queryFn: async () => {
      const { data, error } = await qualityClient().rpc('project_chat_people', { p_org: org, p_audience: audience })
      if (error) throw error
      return data as ChatPerson[]
    }
  })
}
