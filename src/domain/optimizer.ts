import { canonicalStatId } from './statAliases'
import { castellanScoringStats } from './castellanStats'
import { addEffects, castellanQuality, knownCaps, requiredEquipmentMatcher, targetActual } from './effects'
import { SLOT_TYPES, type BuildPreset, type Equipment, type Gem, type SlotType, type StatDefinition } from './types'

export interface OptimizationResult {
  equipmentIds: Partial<Record<SlotType, string>>
  gemAssignments: { slotType: SlotType; gemId: string }[]
  totals: Record<string, number>
  shortfalls: { statId: string; required: number; actual: number; missing: number }[]
  overflow: { statId: string; cap: number; raw: number }[]
  evaluated: number
  approximate: boolean
}
export type OptimizerMode = 'auto' | 'precise' | 'fast'
export interface OptimizeInput {
  mode?: OptimizerMode
  equipment: Equipment[]
  gems: Gem[]
  stats: StatDefinition[]
  preset: BuildPreset
  reservedEquipmentIds?: string[]
  reservedGemIds?: string[]
  maxEvaluations?: number
}
export function optimizeSingle(input: OptimizeInput): OptimizationResult | null {
  const reservedEq = new Set(input.reservedEquipmentIds ?? [])
  const reservedGem = new Set(input.reservedGemIds ?? [])
  const availableSlots = SLOT_TYPES.map(slot => input.equipment.filter(e => e.slotType === slot && !reservedEq.has(e.id)))
  if (availableSlots.some(s => !s.length)) return null
  const availableGems = input.gems.filter(g => !reservedGem.has(g.id))
  const caps = knownCaps(input.stats)
  const matchesRequired = requiredEquipmentMatcher(input.preset)
  if (matchesRequired && !availableSlots.some(slot => slot.some(matchesRequired))) return null
  const countEstimate = availableSlots.reduce((n, group) => n * group.length, 1) * Math.pow(availableGems.length + 1, 4)
  const mode: OptimizerMode = input.mode === 'precise' || input.mode === 'fast' ? input.mode
    : countEstimate <= 100000 ? 'precise' : 'fast'
  const max = Math.max(1, Math.floor(input.maxEvaluations ?? (mode === 'precise' ? 1000000 : 50000)))
  // Fast mode uses a heuristic shortlist. It never claims exact optimality.
  const npcGem = input.preset.name.includes('援軍特化')
  const objective = input.preset.castellanObjective
  const scoringStats = objective ? castellanScoringStats(objective) : []
  const scoringCaps = new Map(scoringStats.map(stat => [stat.id, caps.get(stat.id) || stat.cap || 1]))
  const priorities = [...new Set(input.preset.targets.map(t => canonicalStatId(t.statId)))]
  const rank = (effects: { statId: string; value: number }[]) => effects.reduce((sum, e) => {
    const id = canonicalStatId(e.statId)
    const i = priorities.indexOf(npcGem && id === 'G005' ? 'S002' : id)
    const targetWeight = i < 0 ? 0 : e.value * Math.pow(2, Math.min(12, priorities.length - i))
    const normalization = scoringCaps.get(id)
    return sum + targetWeight + (normalization ? Math.min(e.value / normalization, 1) : 0)
  }, 0)
  const slots = mode === 'fast' ? availableSlots.map(group => {
    const sorted = [...group].sort((a, b) => rank(b.effects) - rank(a.effects))
    const top = sorted.slice(0, 6)
    // Preserve a required-equipment candidate in every compatible shortlist.
    if (matchesRequired && !top.some(matchesRequired)) {
      const required = sorted.find(matchesRequired)
      if (required) top[top.length - 1] = required
    }
    return top
  }) : availableSlots
  const gems = mode === 'fast'
    ? availableGems.filter(g => g.allowedSlots.length).sort((a, b) => rank(b.effects) - rank(a.effects)).slice(0, 12)
    : availableGems
  const add = addEffects
  const score = (equipmentTotals: Record<string, number>, gemTotals: Record<string, number>) => {
    const misses = input.preset.targets.map(t => Math.max(0, t.minValue - targetActual(input.preset, t.statId, equipmentTotals, gemTotals, caps)))
    const totalMiss = misses.reduce((a, b) => a + b, 0)
    // Evaluate only whether minimum targets are met and how far short they are.
    const quality = objective ? castellanQuality(objective, equipmentTotals, gemTotals, caps, scoringStats) : 0
    return [misses.every(m => m === 0) ? 1 : 0, -totalMiss, quality]
  }
  const better = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]
    return false
  }
  const bestState: { value: OptimizationResult | null } = { value: null }
  let bestScore: number[] | null = null
  let evaluated = 0
  let stopped = false
  const selected: Equipment[] = []
  const assignments: { slotType: SlotType; gemId: string }[] = []
  const used = new Set<string>()
  function evaluate() {
    if (evaluated >= max) { stopped = true; return }
    evaluated++
    const totals: Record<string, number> = {}
    const equipmentTotals: Record<string, number> = {}
    const gemTotals: Record<string, number> = {}
    for (const e of selected) { add(totals, e.effects); add(equipmentTotals, e.effects) }
    for (const a of assignments) {
      const gem = gems.find(g => g.id === a.gemId)
      if (gem) { add(totals, gem.effects); add(gemTotals, gem.effects) }
    }
    const s = score(equipmentTotals, gemTotals)
    if (bestScore && !better(s, bestScore)) return
    bestScore = s
    const shortfalls = input.preset.targets.map(t => {
      const actual = targetActual(input.preset, t.statId, equipmentTotals, gemTotals, caps)
      return { statId: t.statId, required: t.minValue, actual, missing: Math.max(0, t.minValue - actual) }
    })
    bestState.value = {
      equipmentIds: Object.fromEntries(selected.map(e => [e.slotType, e.id])),
      gemAssignments: assignments.map(a => ({ ...a })),
      totals: { ...totals },
      shortfalls,
      overflow: [...caps].filter(([id, cap]) => (equipmentTotals[id] ?? 0) > cap).map(([statId, cap]) => ({ statId, cap, raw: equipmentTotals[statId] })),
      evaluated, approximate: false
    }
  }
  function assignGems(i: number) {
    if (stopped) return
    if (i === SLOT_TYPES.length) { evaluate(); return }
    // Empty gem slot is permitted.
    assignGems(i + 1)
    if (stopped) return
    for (const g of gems) {
      if (used.has(g.id) || !g.allowedSlots.includes(SLOT_TYPES[i])) continue
      used.add(g.id); assignments.push({ slotType: SLOT_TYPES[i], gemId: g.id })
      assignGems(i + 1)
      assignments.pop(); used.delete(g.id)
      if (stopped) return
    }
  }
  function assignEquipment(i: number) {
    if (stopped) return
    if (i === SLOT_TYPES.length) { if (!matchesRequired || selected.some(matchesRequired)) assignGems(0); return }
    for (const e of slots[i]) {
      selected.push(e); assignEquipment(i + 1); selected.pop()
      if (stopped) return
    }
  }
  assignEquipment(0)
  const result = bestState.value
  if (result !== null) { result.evaluated = evaluated; result.approximate = stopped || mode === 'fast' }
  return result
}
