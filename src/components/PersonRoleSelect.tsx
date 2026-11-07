import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export interface PersonRoleOption {
  value: string
  name: string
  role: string
}

interface PersonRoleSelectProps {
  name: string
  options: PersonRoleOption[]
  placeholder: string
  disabled?: boolean
  required?: boolean
}

export function PersonRoleSelect({ name, options, placeholder, disabled = false, required = false }: PersonRoleSelectProps) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const selected = options.find((option) => option.value === value)

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [open])

  function choose(option: PersonRoleOption) {
    setValue(option.value)
    setOpen(false)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      if (!open) setOpen(true)
      setActiveIndex((current) => (current + direction + options.length) % options.length)
      return
    }
    if ((event.key === 'Enter' || event.key === ' ') && open && options[activeIndex]) {
      event.preventDefault()
      choose(options[activeIndex])
    }
  }

  return <div className={`person-role-select${open ? ' is-open' : ''}`} ref={rootRef}>
    <input type="hidden" name={name} value={value} />
    <button
      type="button"
      className="person-role-trigger"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listboxId}
      aria-required={required}
      disabled={disabled}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={handleKeyDown}
    >
      {selected ? <><span className="person-role-name">{selected.name}</span><span className="person-role-pill">{selected.role}</span></> : <span className="person-role-placeholder">{placeholder}</span>}
      <ChevronDown aria-hidden="true" />
    </button>
    {open && <div className="person-role-menu" id={listboxId} role="listbox" aria-label={placeholder}>
      {options.map((option, index) => <button
        type="button"
        role="option"
        aria-selected={option.value === value}
        className={index === activeIndex ? 'is-active' : ''}
        key={option.value}
        onPointerMove={() => setActiveIndex(index)}
        onClick={() => choose(option)}
      >
        <span className="person-role-name">{option.name}</span>
        <span className="person-role-pill">{option.role}</span>
        <Check className="person-role-check" aria-hidden="true" />
      </button>)}
    </div>}
  </div>
}
