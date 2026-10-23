import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ArrowRight, HardHat, LockKeyhole, ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from './AuthProvider'

export function SignInPage() {
  const { session, activeOrganization } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (session) {
    const requested = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname
    return <Navigate replace to={requested ?? (activeOrganization ? `/org/${activeOrganization.id}/my-work` : '/organizations/select')} />
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
      <section className="auth-story" aria-labelledby="brand-heading">
        <div className="brand-lockup"><span className="brand-mark"><HardHat /></span><span>BuildTrack</span></div>
        <div className="auth-story-copy">
          <p className="eyebrow">FIELD OPERATIONS, ACCOUNTABLE</p>
          <h1 id="brand-heading">Every issue has an owner. Every fix gets verified.</h1>
          <p>Capture work in the field, coordinate trusted trade partners, and see exactly what stands between a home and its next milestone.</p>
          <div className="trust-row">
            <span><ShieldCheck /> Scoped access</span>
            <span><LockKeyhole /> Private evidence</span>
          </div>
        </div>
        <p className="auth-footnote">Development environment · Never use production construction data here.</p>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <p className="eyebrow">WELCOME BACK</p>
          <h2>Sign in to your workspace</h2>
          <p className="muted">Use the verified email from your BuildTrack invitation.</p>
          <form onSubmit={submit} className="stack-lg">
            <label className="field">Email address<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></label>
            <label className="field">Password<input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            {error && <div className="notice danger" role="alert">{error}</div>}
            <button className="button primary full" disabled={submitting}>{submitting ? 'Signing in…' : <>Sign in <ArrowRight size={18} /></>}</button>
          </form>
          <p className="fine-print">Access is invitation-only. Creating an identity does not create tenant access.</p>
        </div>
      </section>
    </main>
  )
}
