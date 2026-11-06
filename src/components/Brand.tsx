/** Consistent brand mark and wordmark on light or dark surfaces. */
export function Brand({ dark = false, subtitle }: { dark?: boolean; subtitle?: string }) {
  return <span className={`brand-lockup${dark ? ' dark' : ''}`}>
    <span className="brand-mark"><img src="/buildtrack-symbol-v2.png" alt="" /></span>
    <span className="brand-name">BuildTrack{subtitle && <small>{subtitle}</small>}</span>
  </span>
}
