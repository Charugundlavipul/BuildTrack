import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { MapPin, Pencil, Plus, Trash2, X } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, StateBadge } from '../../components/Ui'
import { qualityClient, useSpaceTypes } from '../inspections/qualityData'
import { SpaceTypeOptions } from './SpaceTypeOptions'
import { sqlNull, useHomeLocations, type HomeLocation } from './propertyData'

export function HomeLocationsPanel({ organizationId, homeId, disabled }: { organizationId: string; homeId: string; disabled: boolean }) {
  const types = useSpaceTypes()
  const locations = useHomeLocations(organizationId, homeId)
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<HomeLocation | 'new' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const current = editing && editing !== 'new' ? editing : null
  const excluded = new Set(current ? [current.id] : [])
  // A parent cannot be this location or any descendant of it.
  if (current) {
    let grew = true
    while (grew) {
      grew = false
      for (const location of locations.data ?? []) {
        if (location.parent_location_id && excluded.has(location.parent_location_id) && !excluded.has(location.id)) { excluded.add(location.id); grew = true }
      }
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true); setError(''); setMessage('')
    try {
      const { error: saveError } = await qualityClient().rpc('save_home_space', {
        p_org: organizationId, p_id: current?.id ?? sqlNull, p_home: homeId,
        p_name: String(form.get('name')).trim(), p_parent: String(form.get('parent') ?? '') || sqlNull,
        p_active: form.get('active') === 'on', p_type: form.get('space_type') || null,
        p_level: String(form.get('level') ?? '').trim() || null,
        p_square_feet: String(form.get('square_feet') ?? '') ? Number(form.get('square_feet')) : null
      })
      if (saveError) throw saveError
      await queryClient.invalidateQueries({ queryKey: ['property-locations', organizationId, homeId] })
      setMessage(current ? 'Location updated.' : 'Location added.'); setEditing(null)
    } catch (caught) { setError(caught instanceof Error ? caught.message : (caught as { message?: string }).message ?? 'Unable to save this location.') }
    finally { setBusy(false) }
  }

  async function removeLocation(location: HomeLocation) {
    if (!window.confirm(`Delete ${location.name}? This removes the room from this property.`)) return
    setBusy(true); setError(''); setMessage('')
    try {
      const { error: deleteError } = await qualityClient().rpc('delete_home_space', {
        p_org: organizationId,
        p_id: location.id,
        p_home: homeId
      })
      if (deleteError) throw deleteError
      await queryClient.invalidateQueries({ queryKey: ['property-locations', organizationId, homeId] })
      setMessage(`Deleted ${location.name}.`)
      if (editing && editing !== 'new' && editing.id === location.id) setEditing(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : (caught as { message?: string }).message ?? 'Unable to delete this location.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="panel property-locations" aria-labelledby="home-locations-heading">
    <div className="section-heading"><div><h2 id="home-locations-heading"><MapPin />Rooms & areas</h2><p>Name the places where work and inspection findings are recorded.</p></div><button className="button secondary" disabled={disabled || busy} onClick={() => { setEditing('new'); setError(''); setMessage('') }}><Plus />Add location</button></div>
    {message && <div className="notice" role="status">{message}</div>}
    {locations.isLoading && <LoadingState label="Loading home locations" />}
    {locations.isError && <ErrorState message={locations.error.message} retry={() => void locations.refetch()} />}
    {editing && <form key={current?.id ?? 'new'} className="property-location-form stack-lg" onSubmit={save}>
      <div className="section-heading"><h3>{current ? `Edit ${current.name}` : 'Add home location'}</h3><button type="button" className="icon-button" disabled={busy} aria-label="Close location editor" onClick={() => setEditing(null)}><X /></button></div>
      <fieldset disabled={disabled || busy} className="property-fieldset form-grid two">
        <label className="field">Location name<input name="name" defaultValue={current?.name ?? ''} placeholder="Kitchen, garage, second floor…" maxLength={120} required autoFocus /></label>
        <label className="field">Space type<select name="space_type" required={!current || Boolean(current.space_type_code)} defaultValue={current?.space_type_code ?? ''}><SpaceTypeOptions types={types.data} current={current?.space_type_code ?? undefined} /></select></label>
        <label className="field">Within area<select name="parent" defaultValue={current?.parent_location_id ?? ''}><option value="">Top-level location</option>{locations.data?.filter((location) => location.active && !excluded.has(location.id)).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <label className="field">Level<input name="level" defaultValue={current?.level ?? ''} maxLength={60} placeholder="Main, Level 2, Basement…" /></label>
        <label className="field">Square footage<input name="square_feet" type="number" min="1" max="1000000" step="1" inputMode="numeric" defaultValue={current?.square_feet ?? ''} placeholder="250" /></label>
        <label className="check-row full-span"><input name="active" type="checkbox" defaultChecked={current?.active ?? true} /><span>Active location</span></label>
      </fieldset>
      {error && <ErrorState message={error} />}
      <div className="form-actions">{current && <button type="button" className="button ghost danger" disabled={disabled || busy} onClick={() => void removeLocation(current)}><Trash2 />Delete room</button>}<button type="button" className="button ghost" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button className="button primary" disabled={disabled || busy}>{busy ? 'Saving…' : 'Save location'}</button></div>
    </form>}
    {!locations.isLoading && !locations.isError && !locations.data?.length && !editing && <EmptyState title="No home locations yet" description="Add rooms, floors, or exterior areas so field teams can identify exactly where work is needed." />}
    <div className="property-location-list">{locations.data?.map((location) => <div key={location.id}><span className="icon-tile"><MapPin /></span><span><strong>{location.name}</strong><small>{[locations.data?.find((parent) => parent.id === location.parent_location_id)?.name ?? 'Top-level location', location.level, location.square_feet ? `${Number(location.square_feet).toLocaleString()} sq ft` : null].filter(Boolean).join(' · ')}</small></span><StateBadge state={location.active ? 'active' : 'inactive'} /><div className="button-row"><button className="button ghost" disabled={disabled || busy} aria-label={`Edit ${location.name}`} onClick={() => { setEditing(location); setError(''); setMessage('') }}><Pencil />Edit</button><button className="button ghost danger" disabled={disabled || busy} aria-label={`Delete ${location.name}`} onClick={() => void removeLocation(location)}><Trash2 />Delete</button></div></div>)}</div>
  </section>
}
