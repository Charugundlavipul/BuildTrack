import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { SignInVisual } from './SignInVisual'
import { LoadingState } from '../../components/Ui'
import { supabase } from '../../lib/supabase'
import { usePlatformAccess } from '../platform/platformData'
import { useAuth } from './AuthProvider'

export function SignInPage() {
  const { session, activeOrganization } = useAuth()
  const platform = usePlatformAccess()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (session) {
    if (platform.isLoading) return <main className="centered-page"><LoadingState label="Opening your workspace" /></main>
    const requested = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname
    return <Navigate replace to={requested ?? (platform.data?.administrator ? '/platform' : activeOrganization ? `/org/${activeOrganization.id}` : '/organizations/select')} />
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setSubmitting(true)
    setError('')
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) setError(signInError.message)
    setSubmitting(false)
  }

  return (
    <main className="auth-page">
      <SignInVisual />
      <section className="auth-panel">
        <div className="auth-card">
          <p className="eyebrow">WELCOME BACK</p>
          <h1>Sign in to your workspace</h1>
          <p className="muted">Use the verified email from your BuildTrack invitation.</p>
          <form onSubmit={submit} className="stack-lg">
            <label className="field">Email address<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></label>
            <label className="field">Password<input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <div className="form-assist"><Link className="text-button" to="/forgot-password">Forgot password?</Link></div>
            {error && <div className="notice danger" role="alert">{error}</div>}
            <button className="button primary full" disabled={submitting}>{submitting ? 'Signing in…' : <>Sign in <ArrowRight size={18} /></>}</button>
          </form>
          <p className="fine-print">Access is invitation-only. Contact your organization administrator if you need an invitation.</p>
        </div>
      </section>
    </main>
  )
}
