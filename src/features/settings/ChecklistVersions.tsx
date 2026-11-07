import { useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { requireSupabase } from '../../lib/supabase'
import { formatDateTime } from '../../lib/utils'
import { sqlNull, textValue, type ConfigRecord } from './configurationData'

type Question = { section: string; label: string; requires_response: boolean }
const emptyQuestion = (): Question => ({ section: 'General', label: '', requires_response: true })

export function ChecklistVersions({ organizationId, record, options, disabled, refresh, onCreated }: { organizationId: string; record?: ConfigRecord; options: Record<string, ConfigRecord[]>; disabled: boolean; refresh: () => Promise<void>; onCreated: (id: string) => void }) {
  const [adding, setAdding] = useState(!record)
  const [questions, setQuestions] = useState<Question[]>([emptyQuestion()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [publishing, setPublishing] = useState<string | null>(null)
  const versions = (options.checklist_versions ?? []).filter((row) => row.template_id === record?.id).sort((a, b) => Number(b.number) - Number(a.number))
  const versionQuestions = (id: string) => (options.checklist_questions ?? []).filter((row) => row.version_id === id).sort((a, b) => Number(a.ordinal) - Number(b.ordinal))
  const update = (index: number, change: Partial<Question>) => setQuestions((current) => current.map((row, position) => position === index ? { ...row, ...change } : row))

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || disabled) return
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
    setBusy(true); setError(''); setMessage('')
    try {
      const { data, error } = await requireSupabase().rpc('admin_create_checklist_version', { p_organization_id: organizationId, p_template_id: record?.id ?? sqlNull, p_template_name: name, p_questions: questions.map((row) => ({ ...row, label: row.label.trim(), section: row.section.trim() || 'General' })) })
      if (error) throw new Error(error.message)
      const result = data as { template_id?: string; number?: number }
      setAdding(false); setQuestions([emptyQuestion()]); setMessage(`Draft version ${result.number ?? ''} created. Preview it before publishing.`)
      await refresh()
      if (!record && result.template_id) onCreated(result.template_id)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Draft could not be created.') }
    finally { setBusy(false) }
  }
  async function publish(id: string) {
    if (busy || disabled) return
    setBusy(true); setError(''); setMessage('')
    try {
      const { error } = await requireSupabase().rpc('admin_publish_checklist_version', { p_organization_id: organizationId, p_version_id: id })
      if (error) throw new Error(error.message)
      await refresh(); setPublishing(null); setMessage('Version published. It is now available for new inspections.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Publication failed. The draft remains available; retry publication here.') }
    finally { setBusy(false) }
  }
  return <section className="panel form-panel stack-lg">
    <div className="section-heading"><div><h2>Checklist category versions</h2><p>Published versions remain unchanged. Create a new version to revise the checklist.</p></div>{record && !adding && <button className="button secondary" disabled={disabled || record.active === false} onClick={() => setAdding(true)}><Plus />New draft version</button>}</div>
    {error && <div className="notice danger" role="alert">{error}</div>}{message && <div className="notice" role="status">{message}</div>}
    {!versions.length && record && <p>No versions have been created.</p>}
    {versions.map((version) => <details className="command-disclosure" key={version.id}><summary>Version {String(version.number)} · {version.published_at ? `Published ${formatDateTime(String(version.published_at))}` : 'Draft'} · {versionQuestions(version.id).length} questions</summary><div className="stack-lg"><ol className="checklist-preview">{versionQuestions(version.id).map((question) => <li key={question.id}><small>{textValue(question, 'section')} · {question.requires_response ? 'Required' : 'Optional'}</small><strong>{textValue(question, 'label')}</strong></li>)}</ol><div className="button-row">{!version.published_at && (publishing === version.id ? <div className="notice warning stack-lg"><p>Publish version {String(version.number)}? Its questions cannot be changed after publication.</p><div className="button-row"><button className="button primary" disabled={disabled || busy || record?.active === false} onClick={() => void publish(version.id)}>Confirm publication</button><button className="button ghost" onClick={() => setPublishing(null)}>Cancel</button></div></div> : <button className="button primary" disabled={disabled || busy || record?.active === false} onClick={() => setPublishing(version.id)}>Publish version</button>)}<button className="button secondary" disabled={disabled || busy || record?.active === false} onClick={() => { setQuestions(versionQuestions(version.id).map((row) => ({ section: textValue(row, 'section', 'General'), label: textValue(row, 'label'), requires_response: row.requires_response !== false }))); setAdding(true) }}>Copy to new draft</button></div></div></details>)}
    {adding && <form className="stack-lg" onSubmit={create}><h3>{record ? 'New version' : 'New checklist category'}</h3><fieldset className="configuration-fields stack-lg" disabled={disabled || busy}>{!record && <label className="field">Checklist category name<input name="name" required maxLength={160} /></label>}{questions.map((question, index) => <fieldset className="stack-lg escalation-step" key={index}><legend>Question {index + 1}</legend><div className="form-grid two"><label className="field">Section<input value={question.section} maxLength={160} onChange={(event) => update(index, { section: event.target.value })} /></label></div><label className="field">Question<input value={question.label} minLength={2} maxLength={1000} required onChange={(event) => update(index, { label: event.target.value })} /></label><label className="check-row"><input type="checkbox" checked={question.requires_response} onChange={(event) => update(index, { requires_response: event.target.checked })} />Response required</label><div className="button-row"><button type="button" className="button ghost" disabled={!index} onClick={() => setQuestions((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next })}>Move up</button><button type="button" className="button ghost" disabled={questions.length === 1} onClick={() => setQuestions((current) => current.filter((_, position) => position !== index))}>Remove question</button></div></fieldset>)}<button type="button" className="button secondary" disabled={questions.length >= 250} onClick={() => setQuestions((current) => [...current, emptyQuestion()])}><Plus />Add question</button></fieldset><div className="form-actions">{record && <button type="button" className="button ghost" disabled={busy} onClick={() => setAdding(false)}>Cancel</button>}<button className="button primary" disabled={disabled || busy || record?.active === false}>{busy ? 'Creating…' : 'Create draft version'}</button></div></form>}
  </section>
}
