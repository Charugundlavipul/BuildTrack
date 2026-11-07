import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ErrorState, LoadingState, PageHeader } from '../../components/Ui'
import { qualityClient } from '../inspections/qualityData'

interface CatalogEntry { kind: string; code: string; label: string; active: boolean; sort_order: number; version: number }
interface PlatformConfig { settings: { default_timezone: string; version: number }; catalogs: CatalogEntry[] }
const kinds: Record<string, string> = { space_type: 'Space types', company_category: 'Company categories' }
export function PlatformConfiguration() {
  const cache = useQueryClient()
  const [kind, setKind] = useState('space_type')
  const [editing, setEditing] = useState<CatalogEntry | 'new' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const data = useQuery({ queryKey: ['platform-configuration'], queryFn: async () => {
    const { data, error } = await qualityClient().rpc('platform_get_configuration')
    if (error) throw error
    return data as PlatformConfig
  } })
  const current = editing && editing !== 'new' ? editing : null
  async function save(event: FormEvent<HTMLFormElement>, settings = false) {
    event.preventDefault(); if (busy || !data.data) return
    const form = new FormData(event.currentTarget); setBusy(true); setError(''); setMessage('')
    try {
      const result = settings ? await qualityClient().rpc('platform_save_settings', { p_timezone: String(form.get('timezone')).trim(), p_version: data.data.settings.version }) : await qualityClient().rpc('platform_save_catalog_entry', {
        p_kind: kind, p_code: current?.code ?? String(form.get('code')).trim(), p_label: String(form.get('label')).trim(), p_active: form.get('active') === 'on', p_sort_order: Number(form.get('sort') ?? 0), p_version: current?.version ?? null
      })
      if (result.error) throw result.error
      await Promise.all(['platform-configuration', 'workspace-defaults', 'space-types', 'master-catalog'].map((key) => cache.invalidateQueries({ queryKey: [key] })))
      setEditing(null); setMessage(settings ? 'Workspace defaults updated.' : 'Master catalog updated.')
    } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }
  return <div className="stack-xl"><PageHeader eyebrow="PLATFORM STANDARDS" title="Global settings & catalogs" description="Maintain shared choices and defaults for organization onboarding." />
    {data.isLoading && <LoadingState label="Loading platform configuration" />}{data.error && <ErrorState message={data.error.message} retry={() => void data.refetch()} />}{error && <ErrorState message={error} />}{message && <div className="notice" role="status">{message}</div>}
    {data.data && <><form className="panel form-panel stack-lg" onSubmit={(event) => void save(event, true)}><h2>New organization defaults</h2><label className="field">Default timezone<input name="timezone" key={data.data.settings.version} defaultValue={data.data.settings.default_timezone} required placeholder="America/New_York" maxLength={120} /><small>Existing organization timezones remain unchanged.</small></label><div><button className="button primary" disabled={busy}>Save defaults</button></div></form>
      <section className="panel form-panel stack-lg"><div className="section-heading"><div><h2>Master catalogs</h2><p>Retire a choice to remove it from new selections. Existing records retain their history.</p></div><button className="button primary" disabled={busy || Boolean(editing)} onClick={() => { setEditing('new'); setError('') }}>Add catalog entry</button></div><label className="field">Catalog<select value={kind} disabled={Boolean(editing)} onChange={(e) => setKind(e.target.value)}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {editing && <form className="stack-lg" aria-label="Master catalog entry" onSubmit={save}><fieldset className="property-fieldset form-grid two" disabled={busy}><label className="field">Code<input name="code" defaultValue={current?.code ?? ''} disabled={Boolean(current)} required pattern="[a-z][a-z0-9_]{0,63}" maxLength={64} /><small>Stable identifier such as sunroom or third_party_inspection.</small></label><label className="field">Display name<input name="label" defaultValue={current?.label ?? ''} required maxLength={120} /></label>{kind !== 'space_type' && <label className="field">Display order<input name="sort" type="number" required min={0} max={10000} defaultValue={current?.sort_order ?? 0} /></label>}<label className="check-row"><input type="checkbox" name="active" defaultChecked={current?.active ?? true} />Available for new selections</label></fieldset><div className="form-actions"><button type="button" className="button ghost" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save catalog entry'}</button></div></form>}
        <div className="master-catalog-list">{data.data.catalogs.filter((c) => c.kind === kind).map((entry) => <article key={`${entry.kind}-${entry.code}`}><span><strong>{entry.label}</strong><small>{entry.code} · {entry.active ? 'Available' : 'Retired'}</small></span><button className="button secondary" disabled={busy || Boolean(editing)} onClick={() => { setEditing(entry); setError('') }}>Edit {entry.label}</button></article>)}</div>
      </section></>}
  </div>
}
