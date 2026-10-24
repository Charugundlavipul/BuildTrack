import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download, FileBarChart, Info } from 'lucide-react'
import { ErrorState, LoadingState, MetricCard, PageHeader } from '../../components/Ui'
import { useHomes, useNeighborhoods, useReportMetrics, type ReportFilters } from '../../lib/data'
import { requireSupabase } from '../../lib/supabase'

export function ReportsPage() {
  const { org } = useParams()
  const [filters, setFilters] = useState<ReportFilters>({})
  const report = useReportMetrics(org, filters)
  const neighborhoods = useNeighborhoods(org)
  const homes = useHomes(org, filters.neighborhood_id)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const data = useMemo(() => {
    const categories = report.data?.by_state
    return Array.isArray(categories) ? categories : []
  }, [report.data]) as Array<{ label: string; value: number }>

  async function exportCsv() {
    if (!org || exporting) return
    setExporting(true)
    setExportError('')
    try {
      const { data: result, error } = await requireSupabase().functions.invoke('request-export', {
        body: { organization_id: org, filters }
      })
      if (error) throw error
      if (!result?.url) throw new Error('The export did not return a download link.')
      window.location.assign(result.url)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed.')
    } finally {
      setExporting(false)
    }
  }
  return <div className="stack-xl">
    <PageHeader eyebrow="EXPLAINABLE PERFORMANCE" title="Reports" description="Metrics use authorized assignment episodes, attempts, and decisions—not only the current assignee." actions={<button className="button primary" disabled={exporting} onClick={() => void exportCsv()}><Download />{exporting ? 'Preparing CSV…' : 'Export filtered CSV'}</button>} />
    <section className="panel form-panel stack-lg" aria-labelledby="report-filters-heading"><div className="section-heading"><div><h2 id="report-filters-heading">Report filters</h2><p>The same filters apply to metrics, charts, and CSV exports.</p></div>{Object.keys(filters).length > 0 && <button className="button ghost" onClick={() => setFilters({})}>Clear filters</button>}</div><div className="form-grid two">
      <label className="field">Neighborhood<select value={filters.neighborhood_id ?? ''} onChange={(event) => setFilters((current) => ({ ...current, neighborhood_id: event.target.value || undefined, home_id: undefined }))}><option value="">All authorized neighborhoods</option>{neighborhoods.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="field">Home<select value={filters.home_id ?? ''} disabled={!filters.neighborhood_id} onChange={(event) => setFilters((current) => ({ ...current, home_id: event.target.value || undefined }))}><option value="">All authorized homes</option>{homes.data?.map((item) => <option key={item.id} value={item.id}>Lot {item.lot_code}</option>)}</select></label>
      <label className="field">State<select value={filters.state ?? ''} onChange={(event) => setFilters((current) => ({ ...current, state: event.target.value || undefined }))}><option value="">All states</option>{['draft','submitted','assigned','acknowledged','in_progress','blocked','ready_for_verification','rework_required','verified','cancelled'].map((state) => <option key={state} value={state}>{state.replaceAll('_', ' ')}</option>)}</select></label>
      <label className="field">Priority<select value={filters.priority ?? ''} onChange={(event) => setFilters((current) => ({ ...current, priority: event.target.value || undefined }))}><option value="">All priorities</option>{['low','normal','high','critical'].map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>
      <label className="field">Created from<input type="date" value={filters.date_from ?? ''} onChange={(event) => setFilters((current) => ({ ...current, date_from: event.target.value || undefined }))} /></label>
      <label className="field">Created through<input type="date" min={filters.date_from} value={filters.date_to ?? ''} onChange={(event) => setFilters((current) => ({ ...current, date_to: event.target.value || undefined }))} /></label>
    </div></section>
    {exportError && <div className="notice danger" role="alert">{exportError}</div>}
    {report.isLoading && <LoadingState label="Calculating authorized metrics" />}
    {report.isError && <ErrorState message={report.error.message} retry={() => void report.refetch()} />}
    {report.data && <>
      <section className="metrics-grid"><MetricCard label="Open work" value={Number(report.data.open_count ?? 0)} helper="Drafts reported separately" /><MetricCard label="Overdue" value={Number(report.data.overdue_count ?? 0)} helper="Includes blocked overdue work" tone="danger" /><MetricCard label="Median acknowledgment" value={report.data.acknowledgment_median_hours == null ? 'Suppressed' : `${Number(report.data.acknowledgment_median_hours)}h`} helper={`n=${Number(report.data.acknowledgment_sample ?? 0)}; shown at n≥10`} /><MetricCard label="First-pass acceptance" value={report.data.first_pass_acceptance_pct == null ? 'Suppressed' : `${Number(report.data.first_pass_acceptance_pct)}%`} helper={`n=${Number(report.data.first_pass_sample ?? 0)}; shown at n≥10`} tone="success" /></section>
      <section className="report-layout"><article className="panel chart-card"><div className="section-heading"><div><h2>Work by current state</h2><p>Authorized records in the selected organization</p></div><FileBarChart /></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 12, right: 8, left: -16, bottom: 8 }}><CartesianGrid vertical={false} stroke="#e5e1d6" /><XAxis dataKey="label" tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} /><Tooltip /><Bar dataKey="value" fill="#1e6049" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></article><aside className="method-card"><Info /><div><h2>Metric boundaries</h2><p>Blocked duration remains in wall-clock turnaround and is separately reportable. Comparisons with fewer than ten reviewed attempts show counts but no ranking.</p><dl><div><dt>Timezone</dt><dd>{String(report.data.timezone ?? 'UTC')}</dd></div><div><dt>Generated</dt><dd>{new Date().toLocaleString()}</dd></div></dl></div></aside></section>
    </>}
  </div>
}
