import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ErrorState } from '../../components/Ui'
import { qualityClient, useMasterCatalog } from '../inspections/qualityData'
import { companyCategories, companyProfileData } from './companyProfileData'
import { refreshVendors, type Vendor } from './vendorData'
import { MultiSelectPills } from '../../components/MultiSelectPills'

export function CompanyProfileFields({ company, ein, canEditEin = true }: { company?: Partial<Vendor>; ein?: string | null; canEditEin?: boolean }) {
  const categories = useMasterCatalog('company_category')
  const choices = categories.data?.length ? categories.data : Object.entries(companyCategories).map(([code, label]) => ({ code, label, active: true }))
  return <><label className="field">Contact email<input name="contact_email" type="email" defaultValue={company?.contact_email ?? ''} maxLength={254} /></label><label className="field">Phone number<input name="phone_number" type="tel" defaultValue={company?.phone_number ?? ''} maxLength={40} /></label><label className="field full-span">Physical address<textarea name="physical_address" defaultValue={company?.physical_address ?? ''} maxLength={1000} /></label><label className="field">EIN<input name="ein" defaultValue={ein ?? ''} pattern="[0-9]{2}-?[0-9]{7}" placeholder={canEditEin ? '12-3456789' : 'Managed by organization admin'} disabled={!canEditEin} /><small>{canEditEin ? 'Sensitive tax identifier.' : 'Only an organization admin or vendor manager can view or change the EIN.'}</small></label><MultiSelectPills label="Company categories" name="categories" defaultValue={company?.categories ?? []} options={choices.filter((category) => category.active || company?.categories?.includes(category.code)).map((category) => ({ value: category.code, label: `${category.label}${!category.active ? ' (retired)' : ''}` }))} help="Select every service this company provides." /></>
}
export function CompanyProfilePanel({ org, company, verified }: { org: string; company: Vendor; verified: boolean }) {
  const cache = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const details = useQuery({ queryKey: ['company-private-details', org, company.id], queryFn: async () => {
    const { data, error } = await qualityClient().rpc('company_profile_context', { p_org: org, p_company: company.id })
    if (error) throw error
    return data as { ein: string | null; can_edit: boolean; can_edit_profile: boolean; can_edit_ein: boolean }
  } })
  const canEdit = details.data?.can_edit_profile === true
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return
    const profile = companyProfileData(new FormData(event.currentTarget))
    setBusy(true); setError(''); setMessage('')
    try {
      const { error } = await qualityClient().rpc('save_company_profile', { p_org: org, p_company: company.id, p_email: profile.email, p_phone: profile.phone, p_address: profile.address, p_ein: profile.ein, p_categories: profile.categories, p_version: company.version })
      if (error) throw error
      await Promise.all([refreshVendors(cache, org), cache.invalidateQueries({ queryKey: ['company-private-details', org, company.id] })]); setMessage('Company contact details and services updated.')
    } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }
  return <form className="panel form-panel stack-lg" onSubmit={save} aria-label="Company contact details"><div><h2>Contact details &amp; services</h2><p className="muted">Division administrators can maintain operational contact information and services. Company identity stays organization-controlled.</p></div>{!details.isLoading && !canEdit && <div className="scope-explanation">View only at your current administration level.</div>}<fieldset key={`${company.version}-${details.data?.ein ?? ''}`} className="property-fieldset form-grid two" disabled={!canEdit || !verified || busy || details.isLoading}><CompanyProfileFields company={company} ein={details.data?.ein} canEditEin={details.data?.can_edit_ein === true} /></fieldset>{(error || details.error) && <ErrorState message={error || details.error!.message} />}{message && <div className="notice" role="status">{message}</div>}{canEdit && <div className="form-actions"><button className="button primary" disabled={!verified || busy || details.isLoading || details.isError}>{busy ? 'Saving…' : 'Save contact & services'}</button></div>}</form>
}
