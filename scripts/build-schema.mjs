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
  '-- Contains the initial permission/role catalog, but no tenant users or fixture data.',
  '-- Rebuild with: npm run schema:build',
  '',
]

for (const name of migrationNames) {
  const source = await readFile(join(migrationsDirectory, name), 'utf8')
  sections.push(`-- ============================================================================\n-- SOURCE: supabase/migrations/${name}\n-- ============================================================================\n`)
  sections.push(source.trim(), '')
}

const target = join(projectRoot, 'schema.sql')
await writeFile(target, `${sections.join('\n')}\n`, 'utf8')
console.log(`Wrote ${target} from ${migrationNames.length} migrations.`)
