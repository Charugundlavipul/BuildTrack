import type { Dispatch, SetStateAction } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { SpaceTypeOptions } from './SpaceTypeOptions'
import { ErrorState } from '../../components/Ui'
import { useSpaceTypes, type MasterPlan, type PlanSpace } from '../inspections/qualityData'

export function HomeLayoutFields({ mode, setMode, spaces, setSpaces, plans, onPlanChange }: { mode: string; setMode: (mode: string) => void; spaces: PlanSpace[]; setSpaces: Dispatch<SetStateAction<PlanSpace[]>>; plans: MasterPlan[]; onPlanChange?: (id: string) => void }) {
  const types = useSpaceTypes()
  const active = types.data?.filter((type) => type.active) ?? []
  function selectMode(value: string) {
    setMode(value)
    if (value === 'manual' && !spaces.length) setSpaces([{ type: '', name: '' }])
  }
  return <section className="full-span home-layout-fields stack-lg" aria-label="Home layout"><div><h3>Home layout</h3><p>Choose a standard floor plan or define this home's rooms manually. A layout is required.</p></div><label className="field">Layout method *<select name="layout_mode" required value={mode} onChange={(event) => selectMode(event.target.value)}><option value="" disabled>Choose how to set up this home</option><option value="plan">Use a standard floor plan</option><option value="manual">No standard plan — enter rooms manually</option></select></label>
    {mode === 'plan' && <label className="field">Floor plan *<select name="master_plan_id" required defaultValue="" onChange={(event) => onPlanChange?.(event.target.value)}><option value="" disabled>Choose a plan from this division</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.spaces.length} spaces</option>)}</select>{!plans.length && <small>No active plans are available in this division. Choose manual rooms or ask your divisional administrator to add a plan.</small>}</label>}
    {mode === 'manual' && <><p className="fine-print">Add at least one named room or exterior area. These rooms belong only to this home.</p>{types.error && <ErrorState message={types.error.message} />}{!active.length && !types.isLoading && <p role="alert">An administrator must make at least one space type available before you can add rooms.</p>}<div className="stack-lg">{spaces.map((space, index) => <div className="plan-space-row" key={index}><label className="field">Room type {index + 1} *<select required value={space.type} onChange={(event) => setSpaces((rows) => rows.map((row, i) => i === index ? { ...row, type: event.target.value } : row))}><SpaceTypeOptions types={types.data} /></select></label><label className="field">Room name {index + 1} *<input required maxLength={120} value={space.name} onChange={(event) => setSpaces((rows) => rows.map((row, i) => i === index ? { ...row, name: event.target.value } : row))} placeholder="Kitchen, Bedroom 1, Exterior…" /></label><button type="button" className="icon-button" aria-label={`Remove room ${index + 1}`} disabled={spaces.length <= 1} onClick={() => setSpaces((rows) => rows.filter((_, i) => i !== index))}><Trash2 /></button></div>)}</div><button type="button" className="button secondary" disabled={!active.length || spaces.length >= 200} onClick={() => setSpaces((rows) => [...rows, { type: '', name: '' }])}><Plus />Add room</button></>}
  </section>
}
