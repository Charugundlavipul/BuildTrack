import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/Ui'
import { usePropertyDirectory } from './propertyData'
import { useAdministrationContext } from '../admin/hierarchy'
import { qualityClient, usePlans, useSpaceTypes, type MasterPlan, type PlanSpace } from '../inspections/qualityData'
import { usePropertySecurity } from './propertyConfig'
import { PropertySecurityNotice } from './PropertyShared'
import { PlanSpaceChecklist } from './PlanSpaceChecklist'
import { usePublishedChecklistVersions } from '../../lib/data'
import { SpaceTypeOptions } from './SpaceTypeOptions'

export function PlansPage() {
  const { org } = useParams()
  const plans = usePlans(org)
  const categories = usePublishedChecklistVersions(org)
  const directory = usePropertyDirectory(org)
  const authority = useAdministrationContext(org)
  const types = useSpaceTypes()
  const security = usePropertySecurity()
  const cache = useQueryClient()
  const [editing, setEditing] = useState<{ source: MasterPlan | null; duplicate: boolean } | null>(null)
  const [spaces, setSpaces] = useState<PlanSpace[]>([])
  const [levels, setLevels] = useState(1)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const current = editing && !editing.duplicate ? editing.source : null
  const template = editing?.source ?? null
  const divisions = directory.data?.divisions.filter((d) => d.status === 'active' && (authority.data?.organization_admin || authority.data?.grants.some((g) => g.scope_kind === 'division' && g.division_id === d.id && (!g.permissions || g.permissions.includes('plan.manage'))))) ?? []
  function beginEdit(plan: MasterPlan | null, duplicate = false) {
    setEditing({ source: plan, duplicate })
    const planLevels = Math.min(50, Math.max(1, plan?.levels ?? Math.max(1, ...(plan?.spaces.map((space) => Number(space.level) || 1) ?? [1]))))
    setLevels(planLevels)
    setSpaces(plan ? plan.spaces.map((space) => ({ ...space, level: Math.min(planLevels, Math.max(1, Number(space.level) || 1)), checklist_items: [...(space.checklist_items ?? [])] })) : [{ type: '', name: '', level: 1, square_feet: null }])
    setError(''); setMessage('')
  }
  function copiedName(name: string, existing: string[]) {
    const base = `${name.trim() || 'Space'} copy`
    if (!existing.some((item) => item.toLowerCase() === base.toLowerCase())) return base
    let number = 2
    while (existing.some((item) => item.toLowerCase() === `${base} ${number}`.toLowerCase())) number += 1
    return `${base} ${number}`
  }
  function duplicateSpace(index: number) {
    setSpaces((all) => {
      if (all.length >= 200) return all
      const copy = { ...all[index], name: copiedName(all[index].name, all.map((space) => space.name)) }
      return [...all.slice(0, index + 1), copy, ...all.slice(index + 1)]
    })
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!org || busy) return
    const form = new FormData(event.currentTarget)
    setBusy(true); setError('')
    try {
      const { error } = await qualityClient().rpc('save_master_plan', { p_org: org, p_id: current?.id ?? null, p_division: form.get('division'), p_name: form.get('name'), p_spaces: spaces, p_active: form.get('active') === 'on', p_version: current?.version ?? null, p_levels: levels })
      if (error) throw error
      await cache.invalidateQueries({ queryKey: ['master-plans', org] }); setEditing(null); setMessage('Plan saved. Existing homes retain their own rooms and areas.')
    } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }
  return <div className="stack-xl"><PageHeader eyebrow="DIVISION CATALOG" title="Floor plans" description="Define standard spaces once. Each home receives its own editable copy." actions={<button className="button primary" disabled={!divisions.length || !security.data || !types.data?.some((t) => t.active) || Boolean(editing)} onClick={() => beginEdit(null)}><Plus />Create floor plan</button>} />
    <Link className="text-button" to={`/org/${org}/properties/divisions`}>← Properties</Link>
    <PropertySecurityNotice loading={security.isLoading} verified={security.data === true} error={security.error} />
    {(plans.isLoading || directory.isLoading) && <LoadingState label="Loading floor plans" />}
    {(plans.error || directory.error || types.error || authority.error) && <ErrorState message={(plans.error ?? directory.error ?? types.error ?? authority.error)!.message} />}
    {categories.error && <ErrorState message={categories.error.message} />}{error && <ErrorState message={error} />}{message && <div className="notice" role="status">{message}</div>}
    {editing && <form className="panel form-panel stack-lg" aria-label="Floor plan editor" onSubmit={save}><h2>{current ? `Edit ${current.name}` : editing.duplicate ? `Duplicate ${template?.name}` : 'Create floor plan'}</h2><fieldset className="property-fieldset stack-lg" disabled={busy || !security.data}><div className="form-grid three"><label className="field">Plan name<input name="name" defaultValue={editing.duplicate && template ? copiedName(template.name, plans.data?.map((plan) => plan.name) ?? []) : current?.name ?? ''} required maxLength={120} /></label><label className="field">Division<select name="division" defaultValue={template?.division_id ?? divisions[0]?.id ?? ''} required disabled={Boolean(current)}>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>{current && <input type="hidden" name="division" value={current.division_id} />}</label><label className="field">No. of levels<select value={levels} onChange={(event) => { const next = Math.min(50, Math.max(1, Number(event.target.value) || 1)); setLevels(next); setSpaces((all) => all.map((space) => ({ ...space, level: Math.min(space.level ?? 1, next) }))) }}>{Array.from({ length: Math.max(10, levels) }, (_, i) => i + 1).map((lvl) => <option key={lvl} value={lvl}>{lvl} {lvl === 1 ? 'level' : 'levels'}</option>)}</select></label></div>
      <div className="plan-space-list">{spaces.map((space, index) => <div className="plan-space-row" key={index}><label className="field plan-space-type">Space type {index + 1}<select required value={space.type} onChange={(e) => setSpaces((all) => all.map((s, i) => i === index ? { ...s, type: e.target.value } : s))}><SpaceTypeOptions types={types.data} current={space.type} /></select></label><label className="field plan-space-name">Space name {index + 1}<input value={space.name} required maxLength={120} onChange={(e) => setSpaces((all) => all.map((s, i) => i === index ? { ...s, name: e.target.value } : s))} placeholder="Bedroom 1, Primary bath…" /></label><label className="field plan-space-level">Level<select required value={space.level ?? 1} onChange={(e) => setSpaces((all) => all.map((s, i) => i === index ? { ...s, level: Number(e.target.value) } : s))}>{Array.from({ length: levels }, (_, level) => level + 1).map((level) => <option key={level} value={level}>Level {level}</option>)}</select></label><label className="field plan-space-footage">Sq. footage<input type="number" min="1" max="1000000" step="1" inputMode="numeric" value={space.square_feet ?? ''} onChange={(e) => setSpaces((all) => all.map((s, i) => i === index ? { ...s, square_feet: e.target.value === '' ? null : e.target.valueAsNumber } : s))} placeholder="250" /></label><div className="plan-space-actions"><button type="button" className="icon-button" title="Duplicate row" aria-label={`Duplicate space ${index + 1}`} disabled={spaces.length >= 200} onClick={() => duplicateSpace(index)}><Copy /></button><button type="button" className="icon-button" title="Remove row" aria-label={`Remove space ${index + 1}`} disabled={spaces.length === 1} onClick={() => setSpaces((all) => all.filter((_, i) => i !== index))}><Trash2 /></button></div><PlanSpaceChecklist space={space} index={index} categories={categories.data ?? []} onChange={(change) => setSpaces((all) => all.map((s, i) => i === index ? { ...s, ...change } : s))} /></div>)}</div>
      <div><button type="button" className="button secondary" disabled={spaces.length >= 200 || !types.data?.some((t) => t.active)} onClick={() => setSpaces((all) => [...all, { type: '', name: '', level: 1, square_feet: null }])}><Plus />Add space</button></div><label className="check-row"><input type="checkbox" name="active" defaultChecked={template?.active ?? true} />Available for new homes</label></fieldset><div className="form-actions"><button type="button" className="button ghost" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button className="button primary" disabled={busy || !security.data}>{busy ? 'Saving…' : editing.duplicate ? 'Create duplicate' : 'Save floor plan'}</button></div></form>}
    {!plans.isLoading && !plans.data?.length && !editing && <EmptyState title="No floor plans yet" description="Create a divisional plan with named rooms and exterior areas." />}
    <div className="stack-lg">{plans.data?.map((plan) => <article className="panel form-panel" key={plan.id}><div className="section-heading"><div><h2>{plan.name}</h2><p>{directory.data?.divisions.find((d) => d.id === plan.division_id)?.name} · {plan.levels} {plan.levels === 1 ? 'level' : 'levels'} · Version {plan.version} · {plan.active ? 'Available' : 'Retired'}</p></div>{divisions.some((d) => d.id === plan.division_id) && <div className="button-row"><button className="button ghost" disabled={!security.data || Boolean(editing)} onClick={() => beginEdit(plan, true)}><Copy />Duplicate</button><button className="button secondary" disabled={!security.data || Boolean(editing)} onClick={() => beginEdit(plan)}>Edit floor plan</button></div>}</div><p>{plan.spaces.map((s) => `${s.name} · Level ${s.level ?? 1}${s.square_feet ? ` · ${s.square_feet.toLocaleString()} sq ft` : ''}`).join('  |  ')}</p></article>)}</div>
  </div>
}
