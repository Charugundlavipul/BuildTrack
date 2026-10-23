import { Database, KeyRound, TerminalSquare } from 'lucide-react'

export function SetupPage() {
  return (
    <main className="setup-page">
      <div className="setup-card">
        <div className="brand-lockup dark"><span className="brand-mark"><Database /></span><span>BuildTrack</span></div>
        <p className="eyebrow">SETUP REQUIRED</p>
        <h1>Connect the application to Supabase</h1>
        <p className="lead">The interface is built, but persistence is intentionally unavailable until browser-safe project credentials are configured.</p>
        <ol className="setup-steps">
          <li><TerminalSquare /><div><strong>Start the local backend</strong><code>npm run db:start</code></div></li>
          <li><KeyRound /><div><strong>Create a local environment file</strong><code>Copy-Item .env.example .env.local</code></div></li>
          <li><Database /><div><strong>Add the printed API URL and anon key</strong><span>Then restart the Vite development server.</span></div></li>
        </ol>
      </div>
    </main>
  )
}
