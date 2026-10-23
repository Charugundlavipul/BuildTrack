const homeColumns = ['lot_code', 'address_line1', 'address_line2', 'city', 'state_code', 'postal_code', 'phase', 'external_reference'] as const

function parseLine(line: string) {
  const cells: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1 }
      else quoted = !quoted
    } else if (character === ',' && !quoted) {
      cells.push(value.trim())
      value = ''
    } else value += character
  }
  if (quoted) throw new Error('CSV contains an unmatched quote.')
  cells.push(value.trim())
  return cells
}

export function parseHomeImportCsv(source: string) {
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) throw new Error('CSV requires a header and at least one home row.')
  const headers = parseLine(lines[0]).map((header) => header.trim().toLowerCase())
  if (!headers.includes('lot_code')) throw new Error('CSV header must include lot_code.')
  const unsupported = headers.filter((header) => !homeColumns.includes(header as (typeof homeColumns)[number]))
  if (unsupported.length) throw new Error(`Unsupported CSV columns: ${unsupported.join(', ')}`)
  if (lines.length - 1 > 1000) throw new Error('A single import is limited to 1000 home rows.')
  return lines.slice(1).map((line) => {
    const cells = parseLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']))
  })
}
