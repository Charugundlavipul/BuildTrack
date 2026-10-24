import { Database, KeyRound, Settings } from 'lucide-react'

export function SetupPage() {
  return (
    <main className="setup-page">
      <div className="setup-card">
        <div className="brand-lockup dark"><span className="brand-mark"><Database /></span><span>BuildTrack</span></div>
        <p className="eyebrow">SETUP REQUIRED</p>
        <h1>Connect the application to Supabase</h1>
        <p className="lead">BuildTrack needs browser-safe Supabase project credentials before users can sign in.</p>
        <ol className="setup-steps">
          <li><Database /><div><strong>Open the connected Supabase project</strong><span>Copy its project URL and publishable key.</span></div></li>
          <li><KeyRound /><div><strong>Create the environment file</strong><code>Copy-Item .env.example .env.local</code></div></li>
          <li><Settings /><div><strong>Add the URL and publishable key</strong><span>Restart BuildTrack after saving the configuration.</span></div></li>
        </ol>
      </div>
    </main>
  )
}
