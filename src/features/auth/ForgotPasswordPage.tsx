import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, KeyRound, Mail } from 'lucide-react'
import { supabase } from '../../lib/supabase'

export function ForgotPasswordPage() {
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    const email = String(new FormData(event.currentTarget).get('email')).trim()
    setBusy(true)
    setError('')
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/update-password`
    })
    setBusy(false)
    if (resetError) setError(resetError.message)
    else setSent(true)
  }

  return <main className="centered-page"><section className="select-card auth-card compact-auth-card">
    <span className="icon-tile"><KeyRound /></span>
    <p className="eyebrow">ACCOUNT RECOVERY</p>
    <h1>Reset your password</h1>
    <p className="lead">Enter the verified email you use to sign in to BuildTrack.</p>
    {sent ? <div className="notice"><Mail />If that account exists, a secure reset link has been sent. Check spam before requesting another link.</div> : <form className="stack-lg" onSubmit={submit}>
      <label className="field">Email address<input name="email" type="email" autoComplete="email" required /></label>
      {error && <div className="notice danger" role="alert">{error}</div>}
      <button className="button primary full" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
    </form>}
    <Link className="text-button" to="/login"><ArrowLeft />Back to sign in</Link>
  </section></main>
}
