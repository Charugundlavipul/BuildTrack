import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { requireSupabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'

type RemoveClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }> }

export function RemoveInspectionButton({ org, id, version }: { org: string; id: string; version: number }) {
  const { access, can } = useAuth()
  const navigate = useNavigate()
  const cache = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const authorizedRole = access?.roles.some((role) => ['org_admin', 'division_admin', 'neighborhood_admin', 'superintendent', 'assistant_superintendent'].includes(role.role_code))
  if (!authorizedRole || !can('inspection.manage')) return null

  async function remove() {
    if (!navigator.onLine || busy || !window.confirm('Remove this inspection from active lists? Its submissions, findings, repair tasks, and evidence will be retained.')) return
    setBusy(true)
    setError('')
    try {
      const { error: failure } = await (requireSupabase() as unknown as RemoveClient).rpc('remove_inspection', { p_organization_id: org, p_inspection_id: id, p_expected_version: version })
      if (failure) throw failure
      await cache.invalidateQueries()
      navigate(`/org/${org}/inspections`, { replace: true })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not remove the inspection. Please refresh and try again.')
    } finally { setBusy(false) }
  }

  return <div>{error && <p className="danger-text" role="alert">{error}</p>}<button type="button" className="button secondary" disabled={busy || !navigator.onLine} onClick={() => void remove()}><Trash2 />{busy ? 'Removing…' : 'Delete inspection'}</button></div>
}
