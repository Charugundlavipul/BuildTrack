import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ErrorState, LoadingState } from '../../components/Ui'
import { qualityClient, usePlans } from '../inspections/qualityData'

export function HomePlanPanel({ org, homeId, disabled }: { org: string; homeId: string; disabled: boolean }) {
  const plans = usePlans(org)
  const cache = useQueryClient()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const home = useQuery({ queryKey: ['home-plan', org, homeId], queryFn: async () => {
    const { data, error } = await qualityClient().from('homes').select('version,master_plan_name,master_plan_version,neighborhoods(division_id)').eq('organization_id', org).eq('id', homeId).single()
    if (error) throw error
    return data as unknown as { version: number; master_plan_name: string | null; master_plan_version: number | null; neighborhoods: { division_id: string | null } | null }
  } })
  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!home.data || busy) return
    const plan = new FormData(event.currentTarget).get('plan')
    setBusy(true); setError('')
    try {
      const { error } = await qualityClient().rpc('apply_home_plan', { p_org: org, p_home: homeId, p_plan: plan, p_home_version: home.data.version })
      if (error) throw error
      await Promise.all([cache.invalidateQueries({ queryKey: ['home-plan', org, homeId] }), cache.invalidateQueries({ queryKey: ['property-locations', org, homeId] }), cache.invalidateQueries({ queryKey: ['home', org, homeId] })])
    } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }
  return <section className="panel form-panel stack-lg"><div className="section-heading"><div><h2>Home floor plan</h2><p>{home.data?.master_plan_name ? `${home.data.master_plan_name} · Version ${home.data.master_plan_version}` : 'Copy a divisional floor plan before adding rooms.'}</p></div><Link className="button ghost" to={`/org/${org}/plans`}>Floor plan catalog</Link></div>
    {home.isLoading && <LoadingState label="Loading home plan" />}{(error || home.error || plans.error) && <ErrorState message={error || (home.error ?? plans.error)!.message} />}
    {home.data?.master_plan_name ? <p className="muted">Customize this home's rooms below. Changes here do not alter the master plan or other homes.</p> : <form onSubmit={apply} className="stack-lg"><label className="field">Floor plan<select name="plan" required defaultValue="" disabled={disabled || busy || home.isLoading}><option value="">Select a floor plan</option>{plans.data?.filter((p) => p.active && p.division_id === home.data?.neighborhoods?.division_id).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.spaces.length} spaces</option>)}</select></label><div><button className="button secondary" disabled={disabled || busy}>{busy ? 'Applying…' : 'Apply floor plan'}</button></div></form>}
  </section>
}
