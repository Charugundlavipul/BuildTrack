import { useQuery } from '@tanstack/react-query'
import { requireSupabase } from '../../lib/supabase'
import { useAuth } from './AuthProvider'

export interface MyProfile {
  first_name?: string; last_name?: string; phone_number?: string | null; contact_email?: string | null;
  timezone?: string | null; display_name?: string; completed_at?: string | null; version?: number;
  account_email: string; email_verified: boolean
}
export const completionKey = (userId: string) => `buildtrack.profile-complete.${userId}`
export function profileComplete(profile?: MyProfile | null) { return Boolean(profile?.completed_at && profile.first_name?.trim() && profile.last_name?.trim()) }

export function useMyProfile() {
  const { user } = useAuth()
  return useQuery({ queryKey: ['my-profile', user?.id], enabled: Boolean(user), staleTime: 60_000, queryFn: async () => {
    const { data, error } = await requireSupabase().rpc('my_profile')
    if (error) throw error
    const profile = data as unknown as MyProfile
    localStorage.setItem(completionKey(user!.id), profileComplete(profile) ? '1' : '0')
    return profile
  } })
}

