import { clsx, type ClassValue } from 'clsx'
import { format, formatDistanceToNowStrict, isPast } from 'date-fns'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDateTime(value?: string | null) {
  if (!value) return 'Not set'
  return format(new Date(value), 'MMM d, yyyy · h:mm a')
}

export function relativeDate(value?: string | null) {
  if (!value) return 'No due date'
  const date = new Date(value)
  return `${isPast(date) ? 'Overdue by' : 'Due in'} ${formatDistanceToNowStrict(date)}`
}

export function humanize(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function escapeCsvCell(value: unknown) {
  let text = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}
