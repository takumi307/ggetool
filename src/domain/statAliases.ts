import { CASTELLAN_GEM_ALIASES } from './castellanStats'

/** Aggregate matching equipment and gem effects while keeping their saved IDs. */
export function canonicalStatId(id: string): string {
  if (id === 'G008') return 'S003'
  return CASTELLAN_GEM_ALIASES.get(id) ?? id
}
