import { Link } from 'react-router-dom'
import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { qualityClient } from '../inspections/qualityData'
import type { ChecklistVersionOption } from '../../lib/data'
import type { PlanSpace } from '../inspections/qualityData'
import { SearchableSelect } from '../../components/SearchableSelect'

export function PlanSpaceChecklist({ space, index, categories, onChange }: { space: PlanSpace; index: number; categories: ChecklistVersionOption[]; onChange: (change: Partial<PlanSpace>) => void }) {
  const [selectedCategory, setSelectedCategory] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [importedCount, setImportedCount] = useState<number | null>(null)
  const spaceName = space.name || `space ${index + 1}`
  const items = space.checklist_items ?? []

  async function importCategory(versionId: string) {
    if (!versionId || importing) return
    setSelectedCategory(versionId)
    setImporting(true)
    setImportError('')
    setImportedCount(null)
    const { data, error } = await qualityClient().from('checklist_questions').select('label').eq('version_id', versionId).order('ordinal')
    if (error) {
      setImportError(error.message)
    } else {
      const existing = new Set(items.map((item) => item.trim().toLocaleLowerCase()).filter(Boolean))
      const imported: string[] = []
      for (const row of data ?? []) {
        const label = row.label.trim()
        const key = label.toLocaleLowerCase()
        if (label && !existing.has(key)) {
          existing.add(key)
          imported.push(label)
        }
      }
      const available = Math.max(0, 100 - items.length)
      const added = imported.slice(0, available)
      onChange({ checklist_version_id: undefined, checklist_items: [...items, ...added] })
      setImportedCount(added.length)
    }
    setSelectedCategory('')
    setImporting(false)
  }

  return <div className="plan-space-checklist stack-lg">
    <SearchableSelect label={`Import checklist category for ${spaceName}`} value={selectedCategory} onChange={importCategory} options={categories.map((category) => ({ value: category.id, label: `${category.template_name} · v${category.number}` })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))} />
    {!categories.length && <p className="muted">Publish a <Link to="../settings/checklists">checklist category</Link> to import its items here.</p>}
    {importing && <p className="muted" role="status">Importing checklist items…</p>}
    {importError && <p className="notice danger" role="alert">{importError}</p>}
    {importedCount !== null && <p className="muted" role="status">{importedCount ? `Imported ${importedCount} checklist item${importedCount === 1 ? '' : 's'}.` : 'All items from that category are already included.'}</p>}
    <section className="stack-lg" aria-label={`Checklist items for ${spaceName}`}>
      <div><h3>Checklist items for {spaceName}</h3><small>Every item can be edited or removed. Categories only load items into this list.</small></div>
      {items.length > 0 && <div className="plan-checklist-items">{items.map((item, itemIndex) => <div className="plan-checklist-item" key={itemIndex}>
        <label className="field">Checklist item {itemIndex + 1} for {spaceName}<input value={item} required minLength={2} maxLength={1000} placeholder="Enter checklist item" onChange={(event) => onChange({ checklist_items: items.map((value, i) => i === itemIndex ? event.target.value : value) })} /></label>
        <button type="button" className="icon-button" aria-label={`Remove checklist item ${itemIndex + 1} for ${spaceName}`} onClick={() => onChange({ checklist_items: items.filter((_, i) => i !== itemIndex) })}><Trash2 /></button>
      </div>)}</div>}
      <div><button type="button" className="button secondary" disabled={items.length >= 100} onClick={() => onChange({ checklist_items: [...items, ''] })}><Plus />Add checklist item for {spaceName}</button></div>
    </section>
  </div>
}
