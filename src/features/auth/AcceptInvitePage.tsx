import { useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Building2, CheckCircle2, ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from './AuthProvider'

export function AcceptInvitePage() {
  const { session, refreshOrganizations } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token')
  const [error, setError] = useState('')
  const [accepting, setAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)

  if (!session) return <Navigate to="/login" state={{ from: { pathname: `/accept-invite?token=${encodeURIComponent(token ?? '')}` } }} />

  async function accept() {
    if (!token || !supabase) return
    setAccepting(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('accept_invitation', { p_plaintext_token: token })
    if (rpcError) setError(rpcError.message)
    else {
      setAccepted(true)
      await refreshOrganizations()
      const organizationId = (data as { organization_id?: string })?.organization_id
      setTimeout(() => navigate(organizationId ? `/org/${organizationId}/my-work` : '/organizations/select'), 800)
    }
    setAccepting(false)
  }

  return <main className="centered-page"><section className="select-card">
    <span className="icon-tile">{accepted ? <CheckCircle2 /> : <Building2 />}</span>
    <p className="eyebrow">BUILDTRACK INVITATION</p>
    <h1>{accepted ? 'Access activated' : 'Review your invitation'}</h1>
    <p className="lead">{accepted ? 'Your membership and approved scoped roles are ready.' : 'Acceptance verifies your signed-in email, activates the tenant membership, and applies only the roles approved by the administrator.'}</p>
    <div className="notice warning"><ShieldCheck />The invitation does not grant access until this server-side acceptance completes.</div>
    {!token && <div className="notice danger">The invitation token is missing.</div>}
    {error && <div className="notice danger" role="alert">{error}</div>}
    <button className="button primary full" disabled={!token || accepting || accepted} onClick={() => void accept()}>{accepting ? 'Activating access…' : accepted ? 'Opening workspace…' : <>Accept invitation <ArrowRight /></>}</button>
  </section></main>
}
