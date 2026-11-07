import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Building2, CheckCircle2, KeyRound, ShieldCheck } from 'lucide-react'
import { ErrorState, LoadingState } from '../../components/Ui'
import { supabase } from '../../lib/supabase'
import { useAuth } from './AuthProvider'
import { ProfileForm } from './ProfileDetails'
import { profileComplete, useMyProfile } from './profileData'

export function AcceptInvitePage() {
  const { loading, session, refreshOrganizations } = useAuth()
  const [params] = useSearchParams()
  const profile = useMyProfile()
  const navigate = useNavigate()
  const token = params.get('token')
  const requiresPasswordSetup = params.get('setup') === '1'
  const [error, setError] = useState('')
  const [accepting, setAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [passwordReady, setPasswordReady] = useState(!requiresPasswordSetup)

  if (loading) return <main className="centered-page"><LoadingState label="Validating invitation" /></main>
  if (!session) {
    const suffix = `${token ? `token=${encodeURIComponent(token)}` : ''}${requiresPasswordSetup ? `${token ? '&' : ''}setup=1` : ''}`
    return <Navigate to="/login" state={{ from: { pathname: `/accept-invite${suffix ? `?${suffix}` : ''}` } }} />
  }

  async function setPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password'))
    const confirmation = String(form.get('confirmation'))
    if (password !== confirmation) return setError('The passwords do not match.')
    if (password.length < 12) return setError('Use at least 12 characters.')
    setAccepting(true)
    setError('')
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setAccepting(false)
    if (updateError) setError(updateError.message)
    else setPasswordReady(true)
  }

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
      navigate(organizationId ? `/org/${organizationId}/account` : '/organizations/select', { replace: true })
    }
    setAccepting(false)
  }

  return <main className="centered-page"><section className="select-card">
    <span className="icon-tile">{accepted ? <CheckCircle2 /> : <Building2 />}</span>
    <p className="eyebrow">BUILDTRACK INVITATION</p>
    <h1>{accepted ? 'Access activated' : 'Review your invitation'}</h1>
    <p className="lead">{accepted ? 'Your profile and workspace are ready.' : 'Set up your account, complete your basic details, then accept access to the organization.'}</p>
    <div className="notice warning"><ShieldCheck />Only accept invitations from an organization you recognize.</div>
    {!token && <div className="notice danger">The invitation token is missing.</div>}
    {error && <div className="notice danger" role="alert">{error}</div>}
    {requiresPasswordSetup && !passwordReady && <form className="stack-lg" onSubmit={setPassword}>
      <div className="section-heading"><h2><KeyRound />Create your password</h2></div>
      <label className="field">Password<input name="password" type="password" autoComplete="new-password" minLength={12} required /></label>
      <label className="field">Confirm password<input name="confirmation" type="password" autoComplete="new-password" minLength={12} required /></label>
      <button className="button primary full" disabled={accepting}>{accepting ? 'Saving…' : 'Save password'}</button>
    </form>}
    {passwordReady && (profile.isLoading ? <LoadingState label="Loading your details" /> : profile.error ? <ErrorState message={profile.error.message} retry={() => void profile.refetch()} /> : profile.data && !profileComplete(profile.data) ? <section className="stack-lg"><h2>Your basic details</h2><ProfileForm profile={profile.data} onboarding /></section> : null)}
    {passwordReady && profileComplete(profile.data) && <button className="button primary full" disabled={!token || accepting || accepted} onClick={() => void accept()}>{accepting ? 'Activating access…' : accepted ? 'Opening workspace…' : <>Accept invitation <ArrowRight /></>}</button>}
  </section></main>
}
