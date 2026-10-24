import { useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Building2, CalendarDays, ClipboardList, MapPin, Plus, Wrench } from 'lucide-react'
import { requireSupabase } from '../../lib/supabase'

interface CatalogProps { organizationId: string; aal: string }
interface Option { id: string; name: string }
interface Neighborhood extends Option { code: string }
interface Home { id: string; neighborhood_id: string; lot_code: string }
interface Specialty extends Option { code: string }
interface Template extends Option { versions: Array<{ id: string; number: number; published_at: string | null }> }
interface Member { user_id: string; display_name: string; affiliation: string; status: string }
interface EscalationRoute extends Option { active: boolean }
const sqlNull = null as unknown as string
const inspectionTypes = ['internal_quality', 'external_quality', 'pre_walkthrough', 'final_walkthrough', 'reinspection'] as const

function useCatalogs(organizationId: string) {
  return useQuery({
    queryKey: ['administration-catalogs', organizationId],
    queryFn: async () => {
      const client = requireSupabase()
      const results = await Promise.all([
        client.from('divisions').select('id,name,status').eq('organization_id', organizationId).order('name'),
        client.from('neighborhoods').select('id,name,code').eq('organization_id', organizationId).eq('status', 'active').order('name'),
        client.from('homes').select('id,neighborhood_id,lot_code').eq('organization_id', organizationId).is('archived_at', null).order('lot_code'),
        client.from('companies').select('id,name').eq('organization_id', organizationId).eq('status', 'active').order('name'),
        client.from('trade_specialties').select('id,name,code').eq('organization_id', organizationId).eq('active', true).order('name'),
        client.from('work_categories').select('id,name,code').eq('organization_id', organizationId).eq('active', true).order('name'),
        client.from('business_calendars').select('id,name,timezone').eq('organization_id', organizationId).order('name'),
        client.from('checklist_templates').select('id,name,checklist_versions(id,number,published_at)').eq('organization_id', organizationId).eq('active', true).order('name'),
        client.from('neighborhood_trade_rosters').select('id,neighborhood_id,company_id,specialty_id,status,active_from,active_to').eq('organization_id', organizationId).order('created_at', { ascending: false }),
        client.from('inspection_engagements').select('id,home_id,inspector_user_id,purpose,starts_at,ends_at,revoked_at').eq('organization_id', organizationId).order('starts_at', { ascending: false }),
        client.from('escalation_routes').select('id,name,active').eq('organization_id', organizationId).eq('active', true).order('name'),
        client.from('notification_rules').select('id,trigger,enabled').eq('organization_id', organizationId).order('created_at', { ascending: false }),
        client.rpc('admin_list_members', { p_organization_id: organizationId })
      ])
      const failed = results.find((result) => result.error)
      if (failed?.error) throw failed.error
      return {
        divisions: results[0].data as Option[], neighborhoods: results[1].data as Neighborhood[], homes: results[2].data as Home[],
        companies: results[3].data as Option[], specialties: results[4].data as Specialty[], categories: results[5].data as Specialty[],
        calendars: results[6].data as Array<Option & { timezone: string }>, templates: results[7].data as unknown as Template[],
        rosters: results[8].data ?? [], engagements: results[9].data ?? [], routes: results[10].data as EscalationRoute[], rules: results[11].data ?? [], members: results[12].data as unknown as Member[]
      }
    }
  })
}

function AdminForm({ title, description, children, onSubmit, disabled }: { title: string; description: string; children: ReactNode; onSubmit: (event: FormEvent<HTMLFormElement>) => void; disabled: boolean }) {
  return <form className="admin-catalog-form stack-lg" onSubmit={onSubmit}><div><h3>{title}</h3><p>{description}</p></div>{children}<button className="button primary" disabled={disabled}><Plus />Save</button></form>
}

interface LifecycleItem { id: string; label: string; entity: string; active: boolean }

function CatalogLifecycle({ organizationId, disabled, onMessage }: { organizationId: string; disabled: boolean; onMessage: (message: string) => void }) {
  const records = useQuery({
    queryKey: ['catalog-lifecycle', organizationId],
    queryFn: async () => {
      const client=requireSupabase()
      const results=await Promise.all([
        client.from('divisions').select('id,name,status').eq('organization_id',organizationId).order('name'),
        client.from('neighborhoods').select('id,name,status').eq('organization_id',organizationId).order('name'),
        client.from('homes').select('id,lot_code,archived_at').eq('organization_id',organizationId).order('lot_code'),
        client.from('companies').select('id,name,status').eq('organization_id',organizationId).order('name'),
        client.from('trade_specialties').select('id,name,active').eq('organization_id',organizationId).order('name'),
        client.from('work_categories').select('id,name,active').eq('organization_id',organizationId).order('name'),
        client.from('checklist_templates').select('id,name,active').eq('organization_id',organizationId).order('name'),
        client.from('escalation_routes').select('id,name,active').eq('organization_id',organizationId).order('name'),
        client.from('notification_rules').select('id,trigger,enabled').eq('organization_id',organizationId).order('created_at',{ascending:false})
      ])
      const failed=results.find((result)=>result.error); if(failed?.error)throw failed.error
      return [
        ...(results[0].data??[]).map((row)=>({id:row.id,label:`Division · ${row.name}`,entity:'division',active:row.status==='active'})),
        ...(results[1].data??[]).map((row)=>({id:row.id,label:`Neighborhood · ${row.name}`,entity:'neighborhood',active:row.status==='active'})),
        ...(results[2].data??[]).map((row)=>({id:row.id,label:`Home · Lot ${row.lot_code}`,entity:'home',active:!row.archived_at})),
        ...(results[3].data??[]).map((row)=>({id:row.id,label:`Company · ${row.name}`,entity:'company',active:row.status==='active'})),
        ...(results[4].data??[]).map((row)=>({id:row.id,label:`Specialty · ${row.name}`,entity:'specialty',active:row.active})),
        ...(results[5].data??[]).map((row)=>({id:row.id,label:`Category · ${row.name}`,entity:'work_category',active:row.active})),
        ...(results[6].data??[]).map((row)=>({id:row.id,label:`Checklist · ${row.name}`,entity:'checklist_template',active:row.active})),
        ...(results[7].data??[]).map((row)=>({id:row.id,label:`Escalation · ${row.name}`,entity:'escalation_route',active:row.active})),
        ...(results[8].data??[]).map((row)=>({id:row.id,label:`Notification · ${row.trigger.replaceAll('_',' ')}`,entity:'notification_rule',active:row.enabled}))
      ] as LifecycleItem[]
    }
  })
  const [changing,setChanging]=useState<string|null>(null)
  async function change(item:LifecycleItem){
    const next=!item.active
    if(!window.confirm(`${next?'Activate':'Deactivate'} ${item.label}?`))return
    setChanging(item.id)
    const {error}=await requireSupabase().rpc('admin_set_catalog_status',{p_organization_id:organizationId,p_entity:item.entity,p_id:item.id,p_active:next})
    setChanging(null)
    if(error){onMessage(error.message);return}
    onMessage(`${item.label} ${next?'activated':'deactivated'}.`);await records.refetch()
  }
  return <section className="panel form-panel stack-lg"><div className="section-heading"><div><h2>Catalog lifecycle</h2><p>Deactivate obsolete configuration without deleting history. Open-work and dependency guards are enforced by the database.</p></div><span>{records.data?.length??0} records</span></div><div className="member-list">{records.data?.map((item)=><div key={`${item.entity}-${item.id}`}><span><strong>{item.label}</strong><small>{item.active?'Active':'Inactive / archived'}</small></span><button className="button ghost" disabled={disabled||changing===item.id} onClick={()=>void change(item)}>{item.active?'Deactivate':'Activate'}</button></div>)}</div></section>
}

export function AdministrationCatalogs({ organizationId, aal }: CatalogProps) {
  const catalogs = useCatalogs(organizationId)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const disabled = busy || aal !== 'aal2'

  async function execute(label: string, operation: () => PromiseLike<{ error: { message: string } | null }>, form?: HTMLFormElement) {
    setBusy(true); setMessage('')
    try {
      const { error } = await operation()
      if (error) throw error
      setMessage(`${label} saved.`)
      form?.reset()
      await catalogs.refetch()
    } catch (error) { setMessage(error instanceof Error ? error.message : `${label} could not be saved.`) }
    finally { setBusy(false) }
  }

  function data(event: FormEvent<HTMLFormElement>) { event.preventDefault(); return new FormData(event.currentTarget) }

  return <div className="stack-xl">
    {message && <div className="notice" role="status">{message}</div>}
    <section className="panel form-panel stack-lg">
      <div className="section-heading admin-section-heading"><div><h2><Building2 />Organization structure</h2><p>Create divisions, neighborhoods, homes, and named home locations through audited commands.</p></div><span>{catalogs.data?.neighborhoods.length ?? 0} neighborhoods</span></div>
      <div className="admin-form-grid">
        <AdminForm title="Division" description="Top-level operating area." disabled={disabled} onSubmit={(event) => { const form=event.currentTarget; const f=data(event); void execute('Division', () => requireSupabase().rpc('admin_save_division',{ p_organization_id:organizationId,p_id:sqlNull,p_name:String(f.get('name')),p_status:'active' }),form) }}><label className="field">Name<input name="name" required maxLength={120} /></label></AdminForm>
        <AdminForm title="Neighborhood" description="Code, division, and local timezone." disabled={disabled} onSubmit={(event) => { const form=event.currentTarget; const f=data(event); void execute('Neighborhood', () => requireSupabase().rpc('admin_save_neighborhood',{ p_organization_id:organizationId,p_id:sqlNull,p_division_id:String(f.get('division_id'))||sqlNull,p_code:String(f.get('code')),p_name:String(f.get('name')),p_timezone:String(f.get('timezone')),p_status:'active' }),form) }}>
          <label className="field">Division<select name="division_id"><option value="">No division</option>{catalogs.data?.divisions.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field">Code<input name="code" required maxLength={40}/></label><label className="field">Name<input name="name" required/></label><label className="field">Timezone<input name="timezone" defaultValue="America/New_York" required/></label>
        </AdminForm>
        <AdminForm title="Home" description="Create a lot/address in a neighborhood." disabled={disabled} onSubmit={(event) => { const form=event.currentTarget; const f=data(event); void execute('Home', () => requireSupabase().rpc('admin_save_home',{ p_organization_id:organizationId,p_id:sqlNull,p_neighborhood_id:String(f.get('neighborhood_id')),p_lot_code:String(f.get('lot_code')),p_address_line1:String(f.get('address_line1'))||sqlNull,p_city:String(f.get('city'))||sqlNull,p_state_code:String(f.get('state_code'))||sqlNull,p_postal_code:String(f.get('postal_code'))||sqlNull,p_phase:String(f.get('phase'))||'planned' }),form) }}>
          <label className="field">Neighborhood<select name="neighborhood_id" required><option value="">Choose</option>{catalogs.data?.neighborhoods.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field">Lot code<input name="lot_code" required/></label><label className="field">Address<input name="address_line1"/></label><label className="field">City<input name="city"/></label><div className="form-grid two"><label className="field">State<input name="state_code" maxLength={2}/></label><label className="field">Postal code<input name="postal_code"/></label></div><label className="field">Phase<input name="phase" defaultValue="planned" required/></label>
        </AdminForm>
        <AdminForm title="Home location" description="Room, floor, exterior area, or nested location." disabled={disabled} onSubmit={(event) => { const form=event.currentTarget; const f=data(event); void execute('Home location', () => requireSupabase().rpc('admin_save_home_location',{ p_organization_id:organizationId,p_id:sqlNull,p_home_id:String(f.get('home_id')),p_name:String(f.get('name')),p_active:true }),form) }}>
          <label className="field">Home<select name="home_id" required><option value="">Choose</option>{catalogs.data?.homes.map((home)=><option key={home.id} value={home.id}>Lot {home.lot_code}</option>)}</select></label><label className="field">Location name<input name="name" placeholder="Kitchen" required/></label>
        </AdminForm>
      </div>
    </section>

    <section className="panel form-panel stack-lg">
      <div className="section-heading admin-section-heading"><div><h2><Wrench />Companies and rosters</h2><p>Companies become assignment-eligible only through an active neighborhood specialty roster.</p></div><span>{catalogs.data?.rosters.length ?? 0} roster entries</span></div>
      <div className="admin-form-grid">
        <AdminForm title="Trade company" description="Vendor organization and optional external reference." disabled={disabled} onSubmit={(event)=>{const form=event.currentTarget;const f=data(event);void execute('Company',()=>requireSupabase().rpc('admin_save_company',{p_organization_id:organizationId,p_id:sqlNull,p_name:String(f.get('name')),p_external_vendor_reference:String(f.get('reference'))||sqlNull,p_status:'active'}),form)}}><label className="field">Name<input name="name" required/></label><label className="field">Vendor reference<input name="reference"/></label></AdminForm>
        <AdminForm title="Specialty" description="Trade classification used for eligibility." disabled={disabled} onSubmit={(event)=>{const form=event.currentTarget;const f=data(event);void execute('Specialty',()=>requireSupabase().rpc('admin_save_specialty',{p_organization_id:organizationId,p_id:sqlNull,p_code:String(f.get('code')),p_name:String(f.get('name')),p_active:true}),form)}}><label className="field">Code<input name="code" required/></label><label className="field">Name<input name="name" required/></label></AdminForm>
        <AdminForm title="Neighborhood roster" description="Authorize a company for a specialty in one neighborhood." disabled={disabled} onSubmit={(event)=>{const form=event.currentTarget;const f=data(event);void execute('Roster entry',()=>requireSupabase().rpc('admin_save_roster',{p_organization_id:organizationId,p_id:sqlNull,p_neighborhood_id:String(f.get('neighborhood_id')),p_company_id:String(f.get('company_id')),p_specialty_id:String(f.get('specialty_id')),p_status:'active'}),form)}}>
          <label className="field">Neighborhood<select name="neighborhood_id" required><option value="">Choose</option>{catalogs.data?.neighborhoods.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field">Company<select name="company_id" required><option value="">Choose</option>{catalogs.data?.companies.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field">Specialty<select name="specialty_id" required><option value="">Choose</option>{catalogs.data?.specialties.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </AdminForm>
      </div>
    </section>

    <section className="panel form-panel stack-lg">
      <div className="section-heading admin-section-heading"><div><h2><CalendarDays />Operational configuration</h2><p>Configure categories, business time, versioned checklists, and bounded external-inspector access.</p></div><span>{catalogs.data?.templates.length ?? 0} checklists</span></div>
      <div className="admin-form-grid">
        <AdminForm title="Work category" description="Classification for work and checklist findings." disabled={disabled} onSubmit={(event)=>{const form=event.currentTarget;const f=data(event);void execute('Work category',()=>requireSupabase().rpc('admin_save_work_category',{p_organization_id:organizationId,p_id:sqlNull,p_code:String(f.get('code')),p_name:String(f.get('name')),p_active:true}),form)}}><label className="field">Code<input name="code" required/></label><label className="field">Name<input name="name" required/></label></AdminForm>
        <AdminForm title="Business calendar" description="Working days, hours, timezone, and holiday dates." disabled={disabled} onSubmit={(event)=>{const form=event.currentTarget;const f=data(event);const holidays=String(f.get('holidays')).split(',').map((v)=>v.trim()).filter(Boolean);void execute('Business calendar',()=>requireSupabase().rpc('admin_save_business_calendar',{p_organization_id:organizationId,p_id:sqlNull,p_name:String(f.get('name')),p_timezone:String(f.get('timezone')),p_working_weekdays:[1,2,3,4,5],p_local_start_time:String(f.get('start')),p_local_end_time:String(f.get('end')),p_holiday_dates:holidays}),form)}}>
          <label className="field">Name<input name="name" required/></label><label className="field">Timezone<input name="timezone" defaultValue="America/New_York" required/></label><div className="form-grid two"><label className="field">Start<input name="start" type="time" defaultValue="08:00" required/></label><label className="field">End<input name="end" type="time" defaultValue="17:00" required/></label></div><label className="field">Holidays (YYYY-MM-DD, comma separated)<input name="holidays"/></label>
        </AdminForm>
        <AdminForm title="Checklist version" description="One question per line. Use Section | Question to group items." disabled={disabled} onSubmit={(event)=>{const form=event.currentTarget;const f=data(event);const questions=String(f.get('questions')).split(/\r?\n/).map((line)=>line.trim()).filter(Boolean).map((line)=>{const [section,...rest]=line.split('|');return {section:rest.length?section.trim():'General',label:(rest.length?rest.join('|'):section).trim(),requires_response:true}});void execute('Checklist version',async()=>{const created=await requireSupabase().rpc('admin_create_checklist_version',{p_organization_id:organizationId,p_template_id:String(f.get('template_id'))||sqlNull,p_template_name:String(f.get('name')),p_questions:questions});if(created.error)return created;if(f.get('publish')==='on'){const versionId=(created.data as {version_id?:string}|null)?.version_id;if(versionId)return requireSupabase().rpc('admin_publish_checklist_version',{p_organization_id:organizationId,p_version_id:versionId})}return {error:null}},form)}}>
          <label className="field">Existing template<select name="template_id"><option value="">Create new</option>{catalogs.data?.templates.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field">New template name<input name="name" placeholder="Required only for a new template"/></label><label className="field">Questions<textarea name="questions" rows={6} placeholder={'Exterior | Siding complete\nInterior | Cabinets secured'} required/></label><label className="check-row"><input type="checkbox" name="publish"/><span>Publish immediately (published versions are immutable)</span></label>
        </AdminForm>
        <AdminForm title="Inspector engagement" description="Bound an external inspector to one home and time window." disabled={disabled} onSubmit={(event)=>{const form=event.currentTarget;const f=data(event);const home=catalogs.data?.homes.find((item)=>item.id===String(f.get('home_id')));void execute('Inspector engagement',()=>requireSupabase().rpc('admin_save_inspector_engagement',{p_organization_id:organizationId,p_id:sqlNull,p_neighborhood_id:home?.neighborhood_id??'',p_home_id:String(f.get('home_id')),p_inspector_user_id:String(f.get('inspector_id')),p_purpose:String(f.get('purpose')),p_starts_at:new Date(String(f.get('starts_at'))).toISOString(),p_ends_at:new Date(String(f.get('ends_at'))).toISOString(),p_revoke:false}),form)}}>
          <label className="field">External inspector<select name="inspector_id" required><option value="">Choose</option>{catalogs.data?.members.filter((member)=>member.affiliation==='external'&&member.status==='active').map((member)=><option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}</select></label><label className="field">Home<select name="home_id" required><option value="">Choose</option>{catalogs.data?.homes.map((home)=><option key={home.id} value={home.id}>Lot {home.lot_code}</option>)}</select></label><label className="field">Purpose<input name="purpose" required/></label><label className="field">Starts<input name="starts_at" type="datetime-local" required/></label><label className="field">Ends<input name="ends_at" type="datetime-local" required/></label>
        </AdminForm>
        <AdminForm title="Escalation route" description="Define who receives escalations in ordered levels." disabled={disabled} onSubmit={(event)=>{const form=event.currentTarget;const f=data(event);const kind=String(f.get('recipient_kind'));void execute('Escalation route',()=>requireSupabase().rpc('admin_save_escalation_route',{p_organization_id:organizationId,p_id:sqlNull,p_name:String(f.get('name')),p_active:true,p_steps:[{recipient_kind:kind,recipient_user_id:kind==='specific_user'?String(f.get('recipient_user_id')):null}]}),form)}}>
          <label className="field">Name<input name="name" required/></label><label className="field">First recipient<select name="recipient_kind" defaultValue="supervisor"><option value="assigned_company_manager">Assigned company manager</option><option value="supervisor">Home/neighborhood supervisor</option><option value="area_manager">Area manager</option><option value="specific_user">Specific user</option><option value="org_admin">Organization administrator</option></select></label><label className="field">Specific user (when selected)<select name="recipient_user_id"><option value="">Choose</option>{catalogs.data?.members.filter((member)=>member.status==='active').map((member)=><option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}</select></label>
        </AdminForm>
        <AdminForm title="Notification rule" description="Create an enabled timer and escalation rule." disabled={disabled} onSubmit={(event)=>{const form=event.currentTarget;const f=data(event);void execute('Notification rule',()=>requireSupabase().rpc('admin_save_notification_rule',{p_organization_id:organizationId,p_id:sqlNull,p_neighborhood_id:String(f.get('neighborhood_id'))||sqlNull,p_trigger:String(f.get('trigger')),p_business_minutes:Number(f.get('business_minutes')),p_repeat_minutes:Number(f.get('repeat_minutes')),p_max_repeats:Number(f.get('max_repeats')),p_quiet_hours:{start:String(f.get('quiet_start')),end:String(f.get('quiet_end'))},p_escalation_route_id:String(f.get('route_id')),p_enabled:true}),form)}}>
          <label className="field">Trigger<select name="trigger" defaultValue="work_due"><option value="assignment_unacknowledged">Assignment unacknowledged</option><option value="work_due">Work due</option><option value="attempt_unreviewed">Attempt unreviewed</option><option value="blocked">Blocked</option><option value="critical_created">Critical created</option></select></label><label className="field">Neighborhood<select name="neighborhood_id"><option value="">Organization default</option>{catalogs.data?.neighborhoods.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field">Escalation route<select name="route_id" required><option value="">Choose</option>{catalogs.data?.routes.map((route)=><option key={route.id} value={route.id}>{route.name}</option>)}</select></label><div className="form-grid two"><label className="field">Delay minutes<input name="business_minutes" type="number" min="0" defaultValue="60" required/></label><label className="field">Repeat minutes<input name="repeat_minutes" type="number" min="1" defaultValue="1440" required/></label><label className="field">Maximum repeats<input name="max_repeats" type="number" min="0" max="50" defaultValue="3" required/></label></div><div className="form-grid two"><label className="field">Quiet starts<input name="quiet_start" type="time" defaultValue="20:00"/></label><label className="field">Quiet ends<input name="quiet_end" type="time" defaultValue="07:00"/></label></div>
        </AdminForm>
        <AdminForm title="Home milestone" description="Plan an operational milestone for one home." disabled={disabled} onSubmit={(event)=>{const form=event.currentTarget;const f=data(event);const planned=String(f.get('planned_at'));void execute('Home milestone',()=>requireSupabase().rpc('admin_save_home_milestone',{p_organization_id:organizationId,p_id:sqlNull,p_home_id:String(f.get('home_id')),p_milestone_code:String(f.get('milestone_code')),p_planned_at:planned?new Date(planned).toISOString():sqlNull}),form)}}>
          <label className="field">Home<select name="home_id" required><option value="">Choose</option>{catalogs.data?.homes.map((home)=><option key={home.id} value={home.id}>Lot {home.lot_code}</option>)}</select></label><label className="field">Milestone code<input name="milestone_code" defaultValue="operational_readiness" required/></label><label className="field">Planned date<input name="planned_at" type="datetime-local"/></label>
        </AdminForm>
        <AdminForm title="Milestone inspection requirement" description="Require a submitted inspection type before readiness review." disabled={disabled} onSubmit={(event)=>{const form=event.currentTarget;const f=data(event);void execute('Milestone requirement',()=>requireSupabase().rpc('admin_save_milestone_requirement',{p_organization_id:organizationId,p_id:sqlNull,p_home_id:String(f.get('home_id')),p_milestone_code:String(f.get('milestone_code')),p_required_inspection_type:String(f.get('inspection_type')) as typeof inspectionTypes[number],p_required:true}),form)}}>
          <label className="field">Home<select name="home_id" required><option value="">Choose</option>{catalogs.data?.homes.map((home)=><option key={home.id} value={home.id}>Lot {home.lot_code}</option>)}</select></label><label className="field">Milestone code<input name="milestone_code" defaultValue="operational_readiness" required/></label><label className="field">Required inspection<select name="inspection_type" defaultValue="internal_quality">{inspectionTypes.map((type)=><option key={type} value={type}>{type.replaceAll('_',' ')}</option>)}</select></label>
        </AdminForm>
      </div>
      <div className="catalog-summary"><span><MapPin />{catalogs.data?.homes.length ?? 0} homes</span><span><Wrench />{catalogs.data?.companies.length ?? 0} companies</span><span><ClipboardList />{catalogs.data?.templates.reduce((count,item)=>count+item.versions.length,0) ?? 0} checklist versions</span></div>
    </section>
    <CatalogLifecycle organizationId={organizationId} disabled={disabled} onMessage={setMessage}/>
  </div>
}
