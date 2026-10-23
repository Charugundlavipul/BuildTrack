import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Camera, ChevronLeft, MapPin, ShieldAlert } from 'lucide-react'
import { PageHeader } from '../../components/Ui'
import { useAuth } from '../auth/AuthProvider'
import { useHomes, useNeighborhoods } from '../../lib/data'
import { newCommand, runCommand } from '../../lib/commands'

export function NewWorkPage() {
  const { org } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const neighborhoods = useNeighborhoods(org)
  const [neighborhoodId, setNeighborhoodId] = useState('')
  const homes = useHomes(org, neighborhoodId || undefined)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!org || !user) return
    const form = new FormData(event.currentTarget)
    const itemId = crypto.randomUUID()
    const payload = {
      id: itemId,
      organization_id: org,
      neighborhood_id: String(form.get('neighborhood_id')),
      home_id: String(form.get('home_id')) || null,
      common_area_location: String(form.get('common_area_location')) || null,
      origin: 'internal_observation',
      title: String(form.get('title')),
      description: String(form.get('description')),
      priority: String(form.get('priority')),
      safety_flag: form.get('safety_flag') === 'on'
    }
    setSaving(true)
    setError('')
    try {
      const result = await runCommand<typeof payload, { id: string }>('create_work_item', newCommand(payload), {
        organizationId: org,
        userId: user.id,
        aggregateId: itemId,
        allowOffline: true
      })
      if ('queued' in result) navigate(`/org/${org}/sync`)
      else if (result.ok) navigate(`/org/${org}/work/${result.data.id}`)
      else setError(result.error.message)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save work item')
    } finally {
      setSaving(false)
    }
  }

  return <div className="stack-xl narrow-page">
    <button className="text-button" onClick={() => navigate(-1)}><ChevronLeft />Back to work</button>
    <PageHeader eyebrow="FIELD CAPTURE" title="Create work item" description="Confirm the location before submitting. Drafts can be completed offline and synchronized later." />
    <form className="panel form-panel stack-lg" onSubmit={submit}>
      <div className="form-section"><div><span className="section-number">1</span><div><h2>Location</h2><p>Choose the neighborhood and home—or identify a common area.</p></div></div>
        <div className="form-grid two">
          <label className="field">Neighborhood<select name="neighborhood_id" required value={neighborhoodId} onChange={(event) => setNeighborhoodId(event.target.value)}><option value="">Select neighborhood</option>{neighborhoods.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="field">Home / lot<select name="home_id" disabled={!neighborhoodId}><option value="">Common area</option>{homes.data?.map((item) => <option key={item.id} value={item.id}>Lot {item.lot_code}{item.address_line1 ? ` · ${item.address_line1}` : ''}</option>)}</select></label>
          <label className="field full-span">Common-area location<input name="common_area_location" placeholder="Required when no home is selected" /></label>
        </div>
      </div>
      <div className="form-section"><div><span className="section-number">2</span><div><h2>Observation</h2><p>Use clear language that tells the responsible party what is wrong.</p></div></div>
        <div className="form-grid two">
          <label className="field full-span">Short title<input name="title" required maxLength={160} placeholder="Example: Damaged cabinet door in kitchen" /></label>
          <label className="field full-span">Description<textarea name="description" required maxLength={10000} rows={5} placeholder="Describe the condition, expected correction, and access notes." /></label>
          <label className="field">Priority<select name="priority" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label>
          <label className="check-card"><input type="checkbox" name="safety_flag" /><ShieldAlert /><span><strong>Safety concern</strong><small>Triggers immediate visibility; existing safety procedures still apply.</small></span></label>
        </div>
      </div>
      <div className="upload-drop"><Camera /><div><strong>Add photos after saving the draft</strong><span>JPEG, PNG, HEIC, or PDF · 20 MB maximum each</span></div></div>
      {error && <div className="notice danger" role="alert">{error}</div>}
      <div className="form-actions"><button type="button" className="button ghost" onClick={() => navigate(-1)}>Cancel</button><button className="button primary" disabled={saving}><MapPin />{saving ? 'Saving…' : 'Save draft'}</button></div>
    </form>
  </div>
}
