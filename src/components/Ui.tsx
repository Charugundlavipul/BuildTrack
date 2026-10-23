import type { ReactNode } from 'react'
import { AlertTriangle, Inbox, LoaderCircle } from 'lucide-react'
import { cn, humanize } from '../lib/utils'
import type { WorkState } from '../types/domain'

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <header className="page-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>
}

export function StateBadge({ state }: { state: WorkState | string }) {
  return <span className={cn('state-badge', `state-${state}`)}><span />{humanize(state)}</span>
}

export function PriorityBadge({ priority }: { priority: string }) {
  return <span className={cn('priority-badge', `priority-${priority}`)}>{priority === 'critical' && <AlertTriangle />}{humanize(priority)}</span>
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return <div className="loading-state"><LoaderCircle className="spin" /><span>{label}</span></div>
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><Inbox /><h2>{title}</h2><p>{description}</p>{action}</div>
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="notice danger" role="alert"><AlertTriangle /><span>{message}</span>{retry && <button className="button ghost" onClick={retry}>Retry</button>}</div>
}

export function MetricCard({ label, value, helper, tone = 'neutral' }: { label: string; value: number | string; helper: string; tone?: string }) {
  return <article className={cn('metric-card', `tone-${tone}`)}><span>{label}</span><strong>{value}</strong><small>{helper}</small></article>
}
