import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.generated'

// PostgreSQL accepts SQL null for required RPC UUID/text arguments; generated types omit that possibility.
export const rpcNull = null as unknown as string

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const isSupabaseConfigured = Boolean(
  url &&
  publishableKey &&
  !publishableKey.includes('replace-with')
)

export const supabase: SupabaseClient<Database> | null = isSupabaseConfigured
  ? createClient<Database>(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'buildtrack.auth'
      },
      realtime: { params: { eventsPerSecond: 0 } }
    })
  : null

export function requireSupabase(): SupabaseClient<Database> {
  if (!supabase) {
    throw new Error('BuildTrack is not connected to Supabase. Configure the VITE_SUPABASE_* values.')
  }
  return supabase
}
