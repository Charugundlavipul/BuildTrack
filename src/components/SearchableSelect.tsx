import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'

type Option = { value: string; label: string }

export function SearchableSelect({ label, value, options, onChange }: { label: string; value: string; options: Option[]; onChange: (value: string) => void }) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const selected = value ? options.find((option) => option.value === value) : undefined
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const matches = options.filter((option) => terms.every((term) => option.label.toLocaleLowerCase().includes(term)))

  function show() { setQuery(''); setActive(0); setOpen(true) }
  function choose(option: Option) { onChange(option.value); setOpen(false); setQuery('') }
  function move(index: number) {
    setActive(index)
    root.current?.querySelectorAll('[role="option"]')[index]?.scrollIntoView({ block: 'nearest' })
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) { show(); return }
      if (matches.length) move((active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length)
    } else if (event.key === 'Enter' && open) {
      event.preventDefault()
      if (matches[active]) choose(matches[active])
    } else if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false)
    }
  }

  return <div className="searchable-select field" ref={root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <label htmlFor={id}>{label}</label>
    <div className="searchable-select-control">
      <Search aria-hidden="true" className="searchable-select-search" />
      <input ref={input} id={id} role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={open && matches[active] ? `${id}-option-${active}` : undefined} value={open ? query : selected?.label ?? (value ? 'Category unavailable' : '')} placeholder={open ? 'Search checklist categories…' : 'Select checklist category'} onFocus={show} onClick={() => { if (!open) show() }} onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true) }} onKeyDown={keyDown} />
      <button type="button" tabIndex={-1} className="searchable-select-toggle" aria-label={`Toggle ${label.toLowerCase()}`} onMouseDown={(event) => event.preventDefault()} onClick={() => { if (open) setOpen(false); else { input.current?.focus(); show() } }}><ChevronDown aria-hidden="true" /></button>
    </div>
    {open && <div className="searchable-select-popup">
      <div id={`${id}-options`} role="listbox" aria-label={label} className="searchable-select-options">
        {matches.map((option, index) => <button type="button" tabIndex={-1} role="option" id={`${id}-option-${index}`} key={option.value} aria-selected={option.value === value} className={index === active ? 'is-active' : ''} onMouseDown={(event) => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => choose(option)}><span>{option.label}</span>{option.value === value && <Check aria-hidden="true" />}</button>)}
      </div>
      {!matches.length && <p role="status" className="searchable-select-empty">No checklist categories found.</p>}
    </div>}
  </div>
}
