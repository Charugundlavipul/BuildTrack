import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Save } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/Ui'
import { useAuth } from '../auth/AuthProvider'
import { useAdminSession } from '../admin/sessionSecurity'
import { SessionSecurityNotice } from '../admin/SessionSecurityNotice'
import { requireSupabase } from '../../lib/supabase'
import { formatDateTime, humanize } from '../../lib/utils'
import { configuration, configurationName, configurationStatus, inspectionTypes, localTime, recipientKinds, sqlNull, textValue, triggers, useConfiguration, useConfigurationOptions, type ConfigRecord, type ConfigurationKind } from './configurationData'
import { ChecklistVersions } from './ChecklistVersions'
import { InspectionNavigation } from '../inspections/InspectionNavigation'

export function ConfigurationNavigation() {
  const { org } = useParams()
  const { can, access } = useAuth()
  const isOrgAdmin = Boolean(access?.roles.some((role) => role.scope_kind === 'organization') && can('access.manage'))
  return <nav className="configuration-nav" aria-label="Operational settings">{(Object.keys(configuration) as ConfigurationKind[]).filter((kind) => {
    if (configuration[kind].orgAdminOnly && !isOrgAdmin) return false
    return can(configuration[kind].permission)
  }).map((kind) => <NavLink key={kind} to={`/org/${org}/settings/${kind}`}>{configuration[kind].title}</NavLink>)}</nav>
}

export function ConfigurationPage({ kind, detail: detailProp = false, creating: creatingProp = false, homeContext }: { kind: ConfigurationKind; detail?: boolean; creating?: boolean; homeContext?: string }) {
  const { org, id } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const recordId = homeContext ? params.get('record') : id
  const detail = homeContext ? Boolean(recordId) : detailProp
  const creating = homeContext ? recordId === 'new' : creatingProp
  const records = useConfiguration(org, kind)
  const options = useConfigurationOptions(org, kind)
  const security = useAdminSession()
  const queryClient = useQueryClient()
  const { can, access } = useAuth()
  const isOrgAdmin = Boolean(access?.roles.some((role) => role.scope_kind === 'organization') && can('access.manage'))
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [confirming, setConfirming] = useState(false)
  const labels = configuration[kind]
  const base = `/org/${org}/settings/${kind}`
  const listPath = homeContext ? `/org/${org}/homes/${homeContext}?tab=milestones&view=${kind}` : base
  const recordPath = (recordId: string) => homeContext ? `${listPath}&record=${encodeURIComponent(recordId)}` : `${base}/${recordId}`
  const record = records.data?.find((row) => row.id === recordId && (!homeContext || row.home_id === homeContext))
  const now = records.dataUpdatedAt
  const disabled = busy || security.data !== true
  const homeLabel = (homeId: string) => {
    const home = options.data?.homes?.find((row) => row.id === homeId)
    const neighborhood = options.data?.neighborhoods?.find((row) => row.id === home?.neighborhood_id)
    return home ? `Lot ${textValue(home, 'lot_code')} · ${textValue(neighborhood, 'name')}` : 'Home unavailable'
  }
  async function refresh() {
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['configuration', org] }), queryClient.invalidateQueries({ queryKey: ['configuration-options', org] }), queryClient.invalidateQueries({ queryKey: ['published-checklists', org] })])
  }
  async function lifecycle() {
    if (!record || !org) return
    setBusy(true); setError(''); setMessage('')
    try {
      const client = requireSupabase()
      const { error } = kind === 'engagements' ? await client.rpc('admin_revoke_inspector_engagement', { p_organization_id: org, p_id: record.id }) : await client.rpc('admin_set_catalog_status', { p_organization_id: org, p_entity: ({ checklists: 'checklist_template', escalations: 'escalation_route', notifications: 'notification_rule' } as Record<string, string>)[kind], p_id: record.id, p_active: !(kind === 'notifications' ? record.enabled : record.active) })
      if (error) throw error
      await refresh(); setMessage('Status updated.'); setConfirming(false)
    } catch (caught) { setError(caught instanceof Error ? caught.message : (caught as { message?: string }).message ?? 'Status could not be updated.') }
    finally { setBusy(false) }
  }
  const inspectorName = (row: ConfigRecord) => textValue(options.data?.members?.find((member) => member.id === row.inspector_user_id), 'display_name')
  const query = params.get('q') ?? ''
  const status = params.get('status') ?? ''
  const home = homeContext ?? params.get('home') ?? ''
  const filtered = (records.data ?? []).filter((row) => (!status || configurationStatus(row, now) === status) && (!home || row.home_id === home) && `${configurationName(row)} ${inspectorName(row)} ${textValue(row, 'code')} ${row.home_id ? homeLabel(String(row.home_id)) : ''}`.toLowerCase().includes(query.toLowerCase().trim()))
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 20) - 1))
  const update = (key: string, value: string) => { setPage(0); setParams((previous) => { const next = new URLSearchParams(previous); if (value) next.set(key, value); else next.delete(key); return next }, { replace: true }) }

  return <div className="stack-xl">
    {(!homeContext || detail) && <Link className="text-button" to={detail ? listPath : `/org/${org}/admin`}>← {detail ? labels.title : 'Administration'}</Link>}
    {homeContext ? <div className="section-heading"><h2>{detail ? creating ? `New ${labels.singular.toLowerCase()}` : record ? configurationName(record) : labels.singular : labels.title}</h2>{!detail && <Link className="button secondary" to={recordPath('new')}><Plus />Add {labels.singular.toLowerCase()}</Link>}</div> : <><PageHeader eyebrow={kind === 'checklists' ? 'QUALITY CONTROL' : 'OPERATIONAL SETTINGS'} title={detail ? creating ? `New ${labels.singular.toLowerCase()}` : record ? configurationName(record) : labels.singular : labels.title} description={labels.description} actions={!detail ? <Link className="button primary" to={`${base}/new${home ? `?home=${encodeURIComponent(home)}` : ''}`}><Plus />Add {labels.singular.toLowerCase()}</Link> : undefined} />{kind === 'checklists' ? <InspectionNavigation /> : <ConfigurationNavigation />}</>}
    <SessionSecurityNotice loading={security.isLoading} error={security.error} verified={security.data} />
    {labels.orgAdminOnly && !isOrgAdmin && <ErrorState message="Only organization administrators can configure this setting." />}
    {(!labels.orgAdminOnly || isOrgAdmin) && (records.isLoading || options.isLoading) && <LoadingState label={`Loading ${labels.title.toLowerCase()}`} />}
    {(records.error || options.error) && <ErrorState message={records.error?.message ?? options.error!.message} retry={() => void Promise.all([records.refetch(), options.refetch()])} />}
    {error && <div className="notice danger" role="alert">{error}</div>}{message && <div className="notice" role="status">{message}</div>}
    {(!labels.orgAdminOnly || isOrgAdmin) && records.isSuccess && options.isSuccess && (!detail ? <section className="panel form-panel stack-lg">
      <div className="form-grid two"><label className="field">Search {labels.title.toLowerCase()}<input type="search" value={query} onChange={(event) => update('q', event.target.value)} /></label><label className="field">Status<select value={status} onChange={(event) => update('status', event.target.value)}><option value="">All statuses</option>{[...new Set(records.data.map((row) => configurationStatus(row, now)))].sort().map((value) => <option key={value}>{value}</option>)}</select></label>{!homeContext && options.data.homes && <label className="field">Home<select value={home} onChange={(event) => update('home', event.target.value)}><option value="">All homes</option>{options.data.homes.map((row) => <option key={row.id} value={row.id}>{homeLabel(row.id)}</option>)}</select></label>}</div>
      {!filtered.length ? <EmptyState title="No matching records" description="Change the filters or add a record." /> : <><div className="configuration-records">{filtered.slice(currentPage * 20, currentPage * 20 + 20).map((row) => <Link key={row.id} to={recordPath(row.id)} className="configuration-row"><span><strong>{configurationName(row)}</strong><small>{inspectorName(row) ? `${inspectorName(row)} · ` : ''}{row.home_id ? homeLabel(String(row.home_id)) : textValue(row, 'code') || textValue(row, 'timezone') || labels.singular}{row.starts_at ? ` · ${formatDateTime(String(row.starts_at))} – ${formatDateTime(String(row.ends_at))}` : ''}</small></span><span className="state-badge">{humanize(configurationStatus(row, now))}</span><span className="configuration-manage">Manage →</span></Link>)}</div><footer className="property-pagination"><span>{currentPage * 20 + 1}–{Math.min(filtered.length, currentPage * 20 + 20)} of {filtered.length}</span><div className="button-row"><button className="button ghost" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button><button className="button ghost" disabled={(currentPage + 1) * 20 >= filtered.length} onClick={() => setPage(currentPage + 1)}>Next</button></div></footer></>}
    </section> : !creating && !record ? <ErrorState message="This record is unavailable in your current scope." /> : <>
      {kind === 'checklists' ? <ChecklistVersions key={record?.id ?? 'new'} organizationId={org!} record={record} options={options.data} disabled={disabled} refresh={refresh} onCreated={(templateId) => navigate(recordPath(templateId))} /> : <ConfigurationEditor key={`${kind}-${record?.id ?? 'new'}-${records.dataUpdatedAt}`} kind={kind} organizationId={org!} record={record} options={options.data} initialHome={home} fixedHome={Boolean(homeContext)} disabled={disabled} onSave={async (savedId) => { await refresh(); if (creating) navigate(recordPath(savedId)); else setMessage(`${labels.singular} saved.`) }} />}
      {!homeContext && record?.home_id ? <div className="button-row"><Link className="button secondary" to={`/org/${org}/homes/${record.home_id}`}>Open home</Link>{['milestones', 'requirements'].includes(kind) && can(configuration[kind === 'milestones' ? 'requirements' : 'milestones'].permission) && <Link className="button secondary" to={`/org/${org}/settings/${kind === 'milestones' ? 'requirements' : 'milestones'}?home=${record.home_id}`}>Related home configuration</Link>}</div> : null}
      {record && kind === 'engagements' && !record.revoked_at && <section className="panel form-panel stack-lg"><h2>Revoke inspector access</h2><p>Revocation remains available if the home is archived or the inspector is no longer active. Unsaved form edits are not applied.</p>{confirming ? <div className="notice warning stack-lg"><p>Revoke this grant now?</p><div className="button-row"><button className="button danger" disabled={disabled} onClick={() => void lifecycle()}>Confirm revocation</button><button className="button ghost" onClick={() => setConfirming(false)}>Cancel</button></div></div> : <button className="button secondary" disabled={disabled} onClick={() => setConfirming(true)}>Revoke grant</button>}</section>}
      {record && ['checklists', 'escalations', 'notifications'].includes(kind) && <section className="panel form-panel stack-lg"><h2>Record status</h2><p>Current status: {humanize(configurationStatus(record, now))}. Existing history remains available.</p>{confirming ? <div className="notice warning stack-lg"><p>Change this record to {record.active || record.enabled ? 'inactive' : 'active'}? Dependent work may be affected.</p><div className="button-row"><button className="button secondary" disabled={disabled} onClick={() => void lifecycle()}>Confirm status change</button><button className="button ghost" onClick={() => setConfirming(false)}>Cancel</button></div></div> : <button className="button secondary" disabled={disabled} onClick={() => setConfirming(true)}>{record.active || record.enabled ? 'Deactivate' : 'Activate'}</button>}</section>}
    </>)}
  </div>
}

type Step = { recipient_kind: string; recipient_user_id: string }
function ConfigurationEditor({ kind, organizationId, record, options, initialHome, fixedHome, disabled, onSave }: { kind: ConfigurationKind; organizationId: string; record?: ConfigRecord; options: Record<string, ConfigRecord[]>; initialHome: string; fixedHome: boolean; disabled: boolean; onSave: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [steps, setSteps] = useState<Step[]>(() => {
    const existing = record ? options.escalation_route_steps?.filter((row) => row.route_id === record.id) ?? [] : []
    return existing.length ? existing.sort((a, b) => Number(a.level) - Number(b.level)).map((row) => ({ recipient_kind: String(row.recipient_kind), recipient_user_id: textValue(row, 'recipient_user_id') })) : [{ recipient_kind: 'supervisor', recipient_user_id: '' }]
  })
  const [quiet, setQuiet] = useState(Boolean(record?.quiet_hours && Object.keys(record.quiet_hours).length))
  const [revoke, setRevoke] = useState(Boolean(record?.revoked_at))
  const homes = options.homes ?? []
  const homeLabel = (row: ConfigRecord) => `Lot ${textValue(row, 'lot_code')} · ${textValue(options.neighborhoods?.find((neighborhood) => neighborhood.id === row.neighborhood_id), 'name')}`
  const field = (label: string, name: string, type = 'text', fallback = '', required = true, extra?: ReactNode) => <label className="field">{label}<input name={name} type={type} defaultValue={textValue(record, name, fallback)} required={required} maxLength={160} />{extra}</label>
  const homeSelect = fixedHome ? <input type="hidden" name="home_id" value={initialHome} /> : <label className="field">Home<select name="home_id" defaultValue={textValue(record, 'home_id', initialHome)} required disabled={Boolean(record && ['milestones', 'requirements'].includes(kind))}><option value="">Choose home</option>{homes.filter((row) => !row.archived_at || row.id === record?.home_id).map((row) => <option key={row.id} value={row.id}>{homeLabel(row)}{row.archived_at ? ' (archived)' : ''}</option>)}</select></label>
  const dates = (label: string, name: string, required = true) => <label className="field">{label}<input name={name} type="datetime-local" defaultValue={localTime(textValue(record, name))} required={required} /></label>

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (disabled || busy) return
    const form = new FormData(event.currentTarget)
    const get = (key: string) => String(form.get(key) ?? '').trim()
    const id = record?.id ?? sqlNull
    const client = requireSupabase()
    setBusy(true); setError('')
    try {
      let response: { data: unknown; error: { message: string } | null }
      if (kind === 'calendars') {
        const weekdays = form.getAll('weekday').map(Number)
        if (!weekdays.length) throw new Error('Choose at least one working day.')
        if (get('local_end_time') <= get('local_start_time')) throw new Error('The business day must end after it starts.')
        const holidays = get('holiday_dates').split(/[\s,]+/).filter(Boolean)
        if (holidays.some((value) => !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error('Enter valid holiday dates in YYYY-MM-DD format.')
        response = await client.rpc('admin_save_business_calendar', { p_organization_id: organizationId, p_id: id, p_name: get('name'), p_timezone: get('timezone'), p_working_weekdays: weekdays, p_local_start_time: get('local_start_time'), p_local_end_time: get('local_end_time'), p_holiday_dates: [...new Set(holidays)] })
      } else if (kind === 'engagements') {
        if (get('ends_at') <= get('starts_at')) throw new Error('The engagement must end after it starts.')
        const home = homes.find((row) => row.id === get('home_id'))
        response = await client.rpc('admin_save_inspector_engagement', { p_organization_id: organizationId, p_id: id, p_home_id: get('home_id'), p_neighborhood_id: String(home?.neighborhood_id ?? ''), p_inspector_user_id: get('inspector_user_id'), p_purpose: get('purpose'), p_starts_at: new Date(get('starts_at')).toISOString(), p_ends_at: new Date(get('ends_at')).toISOString(), p_revoke: revoke })
      } else if (kind === 'escalations') {
        if (!steps.length || steps.length > 10 || steps.some((step) => step.recipient_kind === 'specific_user' && !step.recipient_user_id)) throw new Error('Choose a recipient for each escalation level.')
        response = await client.rpc('admin_save_escalation_route', { p_organization_id: organizationId, p_id: id, p_name: get('name'), p_active: record?.active !== false, p_steps: steps.map((step) => ({ recipient_kind: step.recipient_kind, recipient_user_id: step.recipient_kind === 'specific_user' ? step.recipient_user_id : null })) })
      } else if (kind === 'notifications') response = await client.rpc('admin_save_notification_rule', { p_organization_id: organizationId, p_id: id, p_neighborhood_id: get('neighborhood_id') || sqlNull, p_trigger: get('trigger'), p_business_minutes: get('business_minutes') ? Number(get('business_minutes')) : null as unknown as number, p_repeat_minutes: get('repeat_minutes') ? Number(get('repeat_minutes')) : null as unknown as number, p_max_repeats: Number(get('max_repeats')), p_quiet_hours: quiet ? { start: get('quiet_start'), end: get('quiet_end') } : {}, p_escalation_route_id: get('escalation_route_id'), p_enabled: record?.enabled !== false })
      else if (kind === 'milestones') response = await client.rpc('admin_save_home_milestone', { p_organization_id: organizationId, p_id: id, p_home_id: textValue(record, 'home_id') || get('home_id'), p_milestone_code: get('milestone_code'), p_planned_at: get('planned_at') ? new Date(get('planned_at')).toISOString() : sqlNull })
      else response = await client.rpc('admin_save_milestone_requirement', { p_organization_id: organizationId, p_id: id, p_home_id: textValue(record, 'home_id') || get('home_id'), p_milestone_code: get('milestone_code'), p_required_inspection_type: get('required_inspection_type') as typeof inspectionTypes[number], p_required: form.get('required') === 'on' })
      if (response.error) throw new Error(response.error.message)
      const result = response.data as { id?: string } | null
      if (!result?.id && !record) throw new Error('The save returned no record ID. Refresh the directory before trying again.')
      await onSave(result?.id ?? record!.id)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Record could not be saved.') }
    finally { setBusy(false) }
  }

  return <form className="panel form-panel stack-lg configuration-editor" onSubmit={submit}>
    <h2>{record ? 'Edit details' : 'Record details'}</h2>
    {record?.revoked_at ? <div className="notice warning">Access revoked on {formatDateTime(String(record.revoked_at))}.</div> : null}
    <fieldset disabled={disabled || busy} className="configuration-fields stack-lg">
      {['calendars', 'escalations'].includes(kind) && field('Name', 'name')}
      {kind === 'calendars' && <>{field('Timezone', 'timezone', 'text', 'America/New_York', true, <small>IANA timezone, for example America/New_York.</small>)}<fieldset><legend>Working days</legend><div className="weekday-options">{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, index) => <label className="check-row" key={day}><input name="weekday" type="checkbox" value={index} defaultChecked={((record?.working_weekdays as number[] | undefined) ?? [1, 2, 3, 4, 5]).includes(index)} />{day}</label>)}</div></fieldset><div className="form-grid two">{field('Day starts', 'local_start_time', 'time', '08:00')}{field('Day ends', 'local_end_time', 'time', '17:00')}</div><label className="field">Holiday dates<textarea name="holiday_dates" rows={4} defaultValue={((record?.holiday_dates as string[] | undefined) ?? []).join('\n')} placeholder={'2026-12-25\n2027-01-01'} /><small>One YYYY-MM-DD date per line. Times follow the calendar timezone.</small></label></>}
      {['engagements', 'milestones', 'requirements'].includes(kind) && homeSelect}
      {kind === 'engagements' && <><label className="field">External inspector<select name="inspector_user_id" required defaultValue={textValue(record, 'inspector_user_id')}><option value="">Choose inspector</option>{options.members?.filter((row) => row.affiliation === 'external' || row.id === record?.inspector_user_id).map((row) => <option key={row.id} value={row.id}>{textValue(row, 'display_name')}</option>)}</select></label>{field('Purpose', 'purpose')}<div className="form-grid two">{dates('Starts', 'starts_at')}{dates('Ends', 'ends_at')}</div><p className="fine-print">Times use your device timezone. The access window is saved as an absolute time.</p>{record?.revoked_at ? <label className="check-row"><input type="checkbox" checked={!revoke} onChange={(event) => setRevoke(!event.target.checked)} />Restore this grant when saving (current home, member, and date rules will be checked)</label> : null}</>}
      {kind === 'escalations' && <section className="stack-lg"><h3>Escalation order</h3>{steps.map((step, index) => <fieldset className="stack-lg escalation-step" key={index}><legend>Level {index + 1}</legend><label className="field">Recipient<select value={step.recipient_kind} onChange={(event) => setSteps((current) => current.map((value, position) => position === index ? { recipient_kind: event.target.value, recipient_user_id: '' } : value))}>{recipientKinds.map((value) => <option key={value} value={value}>{value === 'area_manager' ? 'Divisional Admin' : humanize(value)}</option>)}</select></label>{step.recipient_kind === 'specific_user' && <label className="field">Specific user<select required value={step.recipient_user_id} onChange={(event) => setSteps((current) => current.map((value, position) => position === index ? { ...value, recipient_user_id: event.target.value } : value))}><option value="">Choose member</option>{options.members?.map((row) => <option key={row.id} value={row.id}>{textValue(row, 'display_name')}</option>)}</select></label>}<div className="button-row"><button type="button" className="button ghost" disabled={!index} onClick={() => setSteps((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next })}>Move up</button><button type="button" className="button ghost" disabled={index === steps.length - 1} onClick={() => setSteps((current) => { const next = [...current]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next })}>Move down</button><button type="button" className="button ghost" disabled={steps.length === 1} onClick={() => setSteps((current) => current.filter((_, position) => position !== index))}>Remove level</button></div></fieldset>)}<button type="button" className="button secondary" disabled={steps.length >= 10} onClick={() => setSteps((current) => [...current, { recipient_kind: 'org_admin', recipient_user_id: '' }])}><Plus />Add level</button></section>}
      {kind === 'notifications' && <><label className="field">Trigger<select name="trigger" defaultValue={textValue(record, 'trigger', 'work_due')}>{triggers.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label><label className="field">Neighborhood<select name="neighborhood_id" defaultValue={textValue(record, 'neighborhood_id')}><option value="">Organization default</option>{options.neighborhoods?.filter((row) => row.status === 'active' || row.id === record?.neighborhood_id).map((row) => <option key={row.id} value={row.id}>{textValue(row, 'name')}</option>)}</select></label><label className="field">Escalation route<select name="escalation_route_id" defaultValue={textValue(record, 'escalation_route_id')} required><option value="">Choose route</option>{options.escalation_routes?.filter((row) => row.active || row.id === record?.escalation_route_id).map((row) => <option key={row.id} value={row.id}>{textValue(row, 'name')}{!row.active ? ' (inactive)' : ''}</option>)}</select></label><div className="form-grid two"><label className="field">Delay (business minutes, optional)<input type="number" name="business_minutes" min="0" defaultValue={textValue(record, 'business_minutes', record ? '' : '60')} /></label><label className="field">Repeat every (minutes, optional)<input type="number" name="repeat_minutes" min="1" defaultValue={textValue(record, 'repeat_minutes', record ? '' : '1440')} /></label><label className="field">Maximum repeats<input type="number" name="max_repeats" min="0" max="50" required defaultValue={textValue(record, 'max_repeats', '3')} /></label></div><label className="check-row"><input type="checkbox" checked={quiet} onChange={(event) => setQuiet(event.target.checked)} />Use quiet hours</label>{quiet && <div className="form-grid two"><label className="field">Quiet starts<input type="time" name="quiet_start" required defaultValue={String((record?.quiet_hours as { start?: string })?.start ?? '20:00')} /></label><label className="field">Quiet ends<input type="time" name="quiet_end" required defaultValue={String((record?.quiet_hours as { end?: string })?.end ?? '07:00')} /></label></div>}</>}
      {['milestones', 'requirements'].includes(kind) && field('Milestone code', 'milestone_code', 'text', 'operational_readiness')}
      {kind === 'milestones' && <>{dates('Planned date', 'planned_at', false)}{record?.actual_at ? <p>Actual date: {formatDateTime(String(record.actual_at))}. Editing the plan does not record a new approval.</p> : null}</>}
      {kind === 'requirements' && <><label className="field">Required inspection type<select name="required_inspection_type" defaultValue={textValue(record, 'required_inspection_type', 'internal_quality')}>{inspectionTypes.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label><label className="check-row"><input type="checkbox" name="required" defaultChecked={record?.required !== false} />Required for milestone review</label></>}
    </fieldset>
    {error && <div className="notice danger" role="alert">{error}</div>}
    <div className="form-actions"><button className="button primary" disabled={disabled || busy}><Save />{busy ? 'Saving…' : 'Save changes'}</button></div>
  </form>
}
