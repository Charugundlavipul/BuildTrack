import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download, FileBarChart, Info } from 'lucide-react'
import { ErrorState, LoadingState, MetricCard, PageHeader } from '../../components/Ui'
import { useReportMetrics } from '../../lib/data'
import { requireSupabase } from '../../lib/supabase'

export function ReportsPage() {
  const { org } = useParams()
  const report = useReportMetrics(org)
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
        body: { organization_id: org, filters: {} }
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
    {exportError && <div className="notice danger" role="alert">{exportError}</div>}
    {report.isLoading && <LoadingState label="Calculating authorized metrics" />}
    {report.isError && <ErrorState message={report.error.message} retry={() => void report.refetch()} />}
    {report.data && <>
      <section className="metrics-grid"><MetricCard label="Open work" value={Number(report.data.open_count ?? 0)} helper="Drafts reported separately" /><MetricCard label="Overdue" value={Number(report.data.overdue_count ?? 0)} helper="Includes blocked overdue work" tone="danger" /><MetricCard label="Median acknowledgment" value={`${Number(report.data.acknowledgment_median_hours ?? 0)}h`} helper={`n=${Number(report.data.acknowledgment_sample ?? 0)}`} /><MetricCard label="First-pass acceptance" value={`${Number(report.data.first_pass_acceptance_pct ?? 0)}%`} helper={`n=${Number(report.data.first_pass_sample ?? 0)}`} tone="success" /></section>
      <section className="report-layout"><article className="panel chart-card"><div className="section-heading"><div><h2>Work by current state</h2><p>Authorized records in the selected organization</p></div><FileBarChart /></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 12, right: 8, left: -16, bottom: 8 }}><CartesianGrid vertical={false} stroke="#e5e1d6" /><XAxis dataKey="label" tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} /><Tooltip /><Bar dataKey="value" fill="#1e6049" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></article><aside className="method-card"><Info /><div><h2>Metric boundaries</h2><p>Blocked duration remains in wall-clock turnaround and is separately reportable. Comparisons with fewer than ten reviewed attempts show counts but no ranking.</p><dl><div><dt>Timezone</dt><dd>{String(report.data.timezone ?? 'UTC')}</dd></div><div><dt>Generated</dt><dd>{new Date().toLocaleString()}</dd></div></dl></div></aside></section>
    </>}
  </div>
}
