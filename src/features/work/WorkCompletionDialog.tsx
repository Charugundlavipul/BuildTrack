import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { CheckCircle2, Paperclip, X } from 'lucide-react'

export function WorkCompletionDialog({ open, title, busy, uploading, files, exception, error, onClose, onUpload, onConfirm }: { open: boolean; title: string; busy: boolean; uploading: boolean; files: string[]; exception: boolean; error: string; onClose: () => void; onUpload: (event: ChangeEvent<HTMLInputElement>) => void; onConfirm: (note: string) => Promise<boolean> }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [note, setNote] = useState('')
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    if (!open && dialog.current?.open) dialog.current.close()
  }, [open])
  const pending = busy || uploading
  return <dialog ref={dialog} className="work-completion-dialog" aria-labelledby="complete-work-title" onCancel={(event) => { event.preventDefault(); if (!pending) onClose() }}>
    <form onSubmit={async (event) => { event.preventDefault(); if (await onConfirm(note.trim())) { setNote(''); onClose() } }}>
      <header><span className="completion-symbol"><CheckCircle2 /></span><button type="button" className="icon-button" aria-label="Close completion confirmation" disabled={pending} onClick={onClose}><X /></button></header>
      <span className="eyebrow">COMPLETE YOUR WORK</span><h2 id="complete-work-title">Mark as completed?</h2><p className="completion-work-title">{title}</p><p>Confirm completion to make this work ready for review and closure.</p>
      <label className="field">Completion note<textarea value={note} onChange={(event) => setNote(event.target.value)} required minLength={2} maxLength={4000} placeholder="Briefly describe what you completed." disabled={pending} /></label>
      <div className="completion-evidence"><strong>Completion evidence</strong>{files.length ? <ul>{files.map((file, index) => <li key={`${file}-${index}`}><Paperclip size={14} />{file}</li>)}</ul> : <p>{exception ? 'An authorized evidence exception is available for this work.' : 'Attach at least one photo or PDF before confirming.'}</p>}<label className="button secondary"><Paperclip size={16} />{uploading ? 'Uploading evidence…' : 'Add photo / file'}<input className="sr-only" aria-label="Completion evidence file" type="file" accept="image/jpeg,image/png,image/heic,image/heif,application/pdf" disabled={pending || files.length >= 20} onChange={onUpload} /></label></div>
      {error && <p className="notice danger" role="alert">{error}</p>}
      <footer><button type="button" className="button ghost" disabled={pending} onClick={onClose}>Keep working</button><button className="button primary" disabled={pending || (!files.length && !exception)}><CheckCircle2 size={18} />{busy ? 'Submitting…' : 'Confirm completion'}</button></footer>
    </form>
  </dialog>
}
