import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'

export function useAdminSession() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['admin-session-assurance', user?.id],
    enabled: Boolean(user),
    initialData: Boolean(user),
    queryFn: async () => Boolean(user),
  })
}
