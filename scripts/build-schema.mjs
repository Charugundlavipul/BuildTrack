import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDirectory = join(projectRoot, 'supabase', 'migrations')
const migrationNames = (await readdir(migrationsDirectory))
  .filter((name) => name.endsWith('.sql'))
  .sort((left, right) => left.localeCompare(right))

const sections = [
  '-- BuildTrack consolidated Supabase schema',
  '-- Generated from versioned migrations. Safe for an empty Supabase project.',
  '-- Contains the fixed permission/role catalog, but no synthetic users or fixture data.',
  '-- Rebuild with: npm run schema:build',
  '',
]

for (const name of migrationNames) {
  const source = await readFile(join(migrationsDirectory, name), 'utf8')
  sections.push(`-- ============================================================================\n-- SOURCE: supabase/migrations/${name}\n-- ============================================================================\n`)
  sections.push(source.trim(), '')
}

const seedSource = await readFile(join(projectRoot, 'supabase', 'seed.sql'), 'utf8')
const fixtureBoundary = seedSource.indexOf('\ndo $$')
if (fixtureBoundary === -1) throw new Error('Could not locate the synthetic fixture boundary in supabase/seed.sql')
const catalog = seedSource
  .slice(0, fixtureBoundary)
  .replace('-- BuildTrack synthetic development fixtures. Never replace these with production data.', '-- BuildTrack fixed permission and scoped-role catalog.')
  .trim()

sections.push('-- ============================================================================\n-- FIXED AUTHORIZATION CATALOG (no development fixtures)\n-- ============================================================================\n')
sections.push('begin;', catalog, 'commit;', '')

const target = join(projectRoot, 'schema.sql')
await writeFile(target, `${sections.join('\n')}\n`, 'utf8')
console.log(`Wrote ${target} from ${migrationNames.length} migrations.`)
