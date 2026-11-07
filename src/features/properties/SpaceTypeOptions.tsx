import type { SpaceType } from '../inspections/qualityData'
import { standardSpaceTypes } from './spaceTypeCatalog'

// Render only persisted catalog entries: displaying an unseeded type would let
// people choose a value that the server cannot accept.
export function SpaceTypeOptions({ types = [], current = '' }: { types?: SpaceType[]; current?: string }) {
  const groups = new Map<string, SpaceType[]>([...new Set(standardSpaceTypes.map((entry) => entry.group))].map((group) => [group, []]))
  for (const type of types.filter((entry) => entry.active)) {
    const group = standardSpaceTypes.find((entry) => entry.code === type.code)?.group ?? 'Additional types'
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(type)
  }
  const retired = types.find((type) => type.code === current && !type.active)
  return <><option value="" disabled>Choose space type</option>{retired && <option value={retired.code} disabled>{retired.label} (retired)</option>}{[...groups].filter(([, entries]) => entries.length).map(([group, entries]) => <optgroup key={group} label={group}>{entries.sort((a, b) => a.label.localeCompare(b.label)).map((type) => <option key={type.code} value={type.code}>{type.label}</option>)}</optgroup>)}</>
}
