import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Camera, ChevronLeft, CloudOff, MapPin, ShieldAlert } from 'lucide-react'
import { PageHeader } from '../../components/Ui'
import { useAuth } from '../auth/AuthProvider'
import { useHomes, useNeighborhoods } from '../../lib/data'
import { newCommand, runCommand } from '../../lib/commands'
import { listHomeOfflineBundles, stageWorkEvidence } from '../../lib/offline'
import { uploadWorkEvidence, validateEvidenceFile } from '../../lib/uploads'
import type { HomeRow, NeighborhoodRow } from '../../lib/data'

export function NewWorkPage() {
  const { org } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const neighborhoods = useNeighborhoods(org)
  const [neighborhoodId, setNeighborhoodId] = useState(searchParams.get('neighborhood') ?? '')
  const [homeId, setHomeId] = useState(searchParams.get('home') ?? '')
  const [files, setFiles] = useState<File[]>([])
  const homes = useHomes(org, neighborhoodId || undefined)
  const cachedHomes = useQuery({
    queryKey: ['offline-home-list', user?.id, org],
    enabled: Boolean(user && org),
    queryFn: () => listHomeOfflineBundles(user!.id, org!)
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const neighborhoodOptions = useMemo(() => {
    if (neighborhoods.data?.length) return neighborhoods.data
    const values = new Map<string, NeighborhoodRow>()
    for (const bundle of cachedHomes.data ?? []) {
      const id = String(bundle.home.neighborhood_id)
      values.set(id, { id, organization_id: org ?? '', code: id.slice(0, 8), name: bundle.neighborhood?.name ?? `Downloaded area ${id.slice(0, 8)}`, timezone: null, status: 'active' })
    }
    return [...values.values()]
  }, [cachedHomes.data, neighborhoods.data, org])

  const homeOptions = useMemo(() => {
    if (homes.data?.length) return homes.data
    return (cachedHomes.data ?? [])
      .filter((bundle) => String(bundle.home.neighborhood_id) === neighborhoodId)
      .map((bundle) => bundle.home as unknown as HomeRow)
  }, [cachedHomes.data, homes.data, neighborhoodId])

  function selectEvidence(event: ChangeEvent<HTMLInputElement>) {
    try {
      const selected = Array.from(event.target.files ?? [])
      if (selected.length > 20) throw new Error('A work item can contain at most 20 files.')
      selected.forEach(validateEvidenceFile)
      setFiles(selected)
      setError('')
    } catch (caught) {
      setFiles([])
      setError(caught instanceof Error ? caught.message : 'The selected evidence is not supported.')
    }
  }

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
      const command = newCommand(payload)
      const result = await runCommand<typeof payload, { id: string }>('create_work_item', command, {
        organizationId: org,
        userId: user.id,
        aggregateId: itemId,
        allowOffline: true
      })
      if ('queued' in result) {
        for (const file of files) {
          await stageWorkEvidence({
            userId: user.id,
            organizationId: org,
            neighborhoodId: payload.neighborhood_id,
            homeId: payload.home_id,
            workItemId: itemId,
            file,
            dependencies: [command.operation_id]
          })
        }
        navigate(`/org/${org}/sync`)
      }
      else if (result.ok) {
        for (const file of files) {
          await uploadWorkEvidence({ organizationId: org, neighborhoodId: payload.neighborhood_id, homeId: payload.home_id, workItemId: result.data.id, file })
        }
        navigate(`/org/${org}/work/${result.data.id}`)
      }
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
    {!navigator.onLine && <div className="notice warning"><CloudOff />Offline capture is active. Only downloaded locations are shown; the draft and selected evidence will stay on this device until reconnect.</div>}
    <form className="panel form-panel stack-lg" onSubmit={submit}>
      <div className="form-section"><div><span className="section-number">1</span><div><h2>Location</h2><p>Choose the neighborhood and home—or identify a common area.</p></div></div>
        <div className="form-grid two">
          <label className="field">Neighborhood<select name="neighborhood_id" required value={neighborhoodId} onChange={(event) => { setNeighborhoodId(event.target.value); setHomeId('') }}><option value="">Select neighborhood</option>{neighborhoodOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="field">Home / lot<select name="home_id" disabled={!neighborhoodId} value={homeId} onChange={(event) => setHomeId(event.target.value)}><option value="">Common area</option>{homeOptions.map((item) => <option key={item.id} value={item.id}>Lot {item.lot_code}{item.address_line1 ? ` · ${item.address_line1}` : ''}</option>)}</select></label>
          <label className="field full-span">Common-area location<input name="common_area_location" required={!homeId} placeholder="Required when no home is selected" /></label>
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
      <label className="upload-drop interactive"><Camera /><div><strong>{files.length ? `${files.length} evidence file${files.length === 1 ? '' : 's'} selected` : 'Add photos or evidence'}</strong><span>Camera capture, JPEG, PNG, HEIC, HEIF, or PDF · 20 MB each · 20 files maximum</span></div><input className="sr-only" type="file" multiple capture="environment" accept="image/jpeg,image/png,image/heic,image/heif,application/pdf" onChange={selectEvidence} /></label>
      {error && <div className="notice danger" role="alert">{error}</div>}
      <div className="form-actions"><button type="button" className="button ghost" onClick={() => navigate(-1)}>Cancel</button><button className="button primary" disabled={saving}><MapPin />{saving ? 'Saving…' : 'Save draft'}</button></div>
    </form>
  </div>
}
