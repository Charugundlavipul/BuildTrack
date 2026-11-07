export async function readAllRows<T>(load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await load(from, from + 499)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < 500) return rows
  }
}
