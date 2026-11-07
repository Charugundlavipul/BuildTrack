// Page below the API row cap and reject oversize exports instead of silently
// truncating them. Callers apply authorization and deterministic ordering.
export async function readExportRows<T>(load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, limit = 10_000) {
  const rows: T[] = []
  const pageSize = 500
  for (let from = 0; from <= limit; from += pageSize) {
    const { data, error } = await load(from, Math.min(from + pageSize - 1, limit))
    if (error) throw error
    const page = data ?? []
    rows.push(...page)
    if (rows.length > limit) throw new Error('Export quota exceeded; narrow the report filters')
    if (page.length < pageSize) return rows
  }
  return rows
}
