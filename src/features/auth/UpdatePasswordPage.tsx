import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, KeyRound } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { LoadingState } from '../../components/Ui'
import { useAuth } from './AuthProvider'

export function UpdatePasswordPage() {
  const { loading, session } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password'))
    const confirmation = String(form.get('confirmation'))
    if (password !== confirmation) return setError('The passwords do not match.')
    if (password.length < 12) return setError('Use at least 12 characters.')
    setBusy(true)
    setError('')
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (updateError) setError(updateError.message)
    else setComplete(true)
  }

  if (loading) return <main className="centered-page"><LoadingState label="Validating recovery link" /></main>
  return <main className="centered-page"><section className="select-card auth-card compact-auth-card">
    <span className="icon-tile">{complete ? <CheckCircle2 /> : <KeyRound />}</span>
    <p className="eyebrow">SECURE ACCOUNT</p>
    <h1>{complete ? 'Password updated' : 'Choose a new password'}</h1>
    {!session && !complete ? <>
      <div className="notice danger">This recovery link is invalid or expired. Request a new one without revealing whether an account exists.</div>
      <Link className="button primary full" to="/forgot-password">Request another link</Link>
    </> : complete ? <>
      <p className="lead">Your new password is active.</p>
      <button className="button primary full" onClick={() => navigate('/organizations/select')}>Continue to BuildTrack</button>
    </> : <form className="stack-lg" onSubmit={submit}>
      <label className="field">New password<input name="password" type="password" autoComplete="new-password" minLength={12} required /></label>
      <label className="field">Confirm password<input name="confirmation" type="password" autoComplete="new-password" minLength={12} required /></label>
      <p className="fine-print">Use at least 12 characters and a password manager-generated value where possible.</p>
      {error && <div className="notice danger" role="alert">{error}</div>}
      <button className="button primary full" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
    </form>}
  </section></main>
}
