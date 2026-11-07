import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { Check, Search, X } from 'lucide-react'

type Option = { value: string; label: string }

export function MultiSelectPills({ label, name, options, defaultValue = [], help }: { label: string; name: string; options: Option[]; defaultValue?: string[]; help?: string }) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState(() => [...new Set(defaultValue)])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selectedSet = new Set(selected)
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const matches = options.filter((option) => !selectedSet.has(option.value) && terms.every((term) => option.label.toLocaleLowerCase().includes(term)))
  const labelFor = (value: string) => options.find((option) => option.value === value)?.label ?? value.replaceAll('_', ' ')

  function add(value: string) {
    if (!selectedSet.has(value)) setSelected((current) => [...current, value])
    setQuery('')
    input.current?.focus()
    setOpen(false)
  }
  function remove(value: string) { setSelected((current) => current.filter((item) => item !== value)) }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && open && matches[0]) { event.preventDefault(); add(matches[0].value) }
    else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
    else if (event.key === 'Backspace' && !query && selected.length) remove(selected.at(-1)!)
  }

  return <div className="field company-category-field" ref={root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <label htmlFor={id}>{label}</label>
    <div className="pill-multiselect-control" onClick={() => input.current?.focus()}>
      {selected.map((value) => <span className="category-pill" key={value}>{labelFor(value)}<button type="button" aria-label={`Remove ${labelFor(value)}`} onClick={(event) => { event.stopPropagation(); remove(value) }}><X aria-hidden="true" /></button><input type="hidden" name={name} value={value} /></span>)}
      <span className="pill-multiselect-search"><Search aria-hidden="true" /><input ref={input} id={id} role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-options`} value={query} placeholder={selected.length ? 'Add another service…' : 'Search and add services…'} onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true) }} onKeyDown={keyDown} /></span>
    </div>
    {open && <div className="pill-multiselect-popup"><div id={`${id}-options`} role="listbox" aria-label={`${label} options`} className="pill-multiselect-options">{matches.map((option) => <button type="button" role="option" aria-selected="false" key={option.value} onMouseDown={(event) => event.preventDefault()} onClick={() => add(option.value)}><span>{option.label}</span><Check aria-hidden="true" /></button>)}</div>{!matches.length && <p role="status" className="searchable-select-empty">{options.length === selected.length ? 'All services selected.' : 'No matching services.'}</p>}</div>}
    {help && <small>{help}</small>}
  </div>
}
