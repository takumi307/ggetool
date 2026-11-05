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
  const caps = new Map(input.stats.filter(s => s.capStatus === 'known' && s.cap !== null).map(s => [s.id, s.cap as number]))
  const countEstimate = availableSlots.reduce((n, group) => n * group.length, 1) * Math.pow(availableGems.length + 1, 4)
  const mode: OptimizerMode = input.mode === 'precise' || input.mode === 'fast' ? input.mode
    : countEstimate <= 100000 ? 'precise' : 'fast'
  const max = Math.max(1, Math.floor(input.maxEvaluations ?? (mode === 'precise' ? 1000000 : 50000)))
  // Fast mode uses a heuristic shortlist. It never claims exact optimality.
  const priorities = [...new Set(input.preset.targets.map(t => t.statId))]
  const rank = (effects: { statId: string; value: number }[]) => effects.reduce((sum, e) => {
    const i = priorities.indexOf(e.statId)
    return sum + (i < 0 ? 0 : e.value * Math.pow(2, Math.min(12, priorities.length - i)))
  }, 0)
  const slots = mode === 'fast' ? availableSlots.map(group =>
    [...group].sort((a, b) => rank(b.effects) - rank(a.effects)).slice(0, 6)) : availableSlots
  const gems = mode === 'fast'
    ? availableGems.filter(g => g.allowedSlots.length).sort((a, b) => rank(b.effects) - rank(a.effects)).slice(0, 12)
    : availableGems
  const add = (totals: Record<string, number>, effects: { statId: string; value: number }[]) => {
    for (const effect of effects) totals[effect.statId] = (totals[effect.statId] ?? 0) + effect.value
  }
  const capped = (id: string, totals: Record<string, number>) => Math.min(totals[id] ?? 0, caps.get(id) ?? Infinity)
  const score = (totals: Record<string, number>) => {
    const misses = input.preset.targets.map(t => Math.max(0, t.minValue - capped(t.statId, totals)))
    const totalMiss = misses.reduce((a, b) => a + b, 0)
    // Evaluate only whether minimum targets are met and how far short they are.
    return [misses.every(m => m === 0) ? 1 : 0, -totalMiss]
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
    for (const e of selected) add(totals, e.effects)
    for (const a of assignments) {
      const gem = gems.find(g => g.id === a.gemId)
      if (gem) add(totals, gem.effects)
    }
    const s = score(totals)
    if (bestScore && !better(s, bestScore)) return
    bestScore = s
    const shortfalls = input.preset.targets.map(t => ({
      statId: t.statId, required: t.minValue, actual: capped(t.statId, totals),
      missing: Math.max(0, t.minValue - capped(t.statId, totals))
    }))
    bestState.value = {
      equipmentIds: Object.fromEntries(selected.map(e => [e.slotType, e.id])),
      gemAssignments: assignments.map(a => ({ ...a })),
      totals: { ...totals },
      shortfalls,
      overflow: [...caps].filter(([id, cap]) => (totals[id] ?? 0) > cap).map(([statId, cap]) => ({ statId, cap, raw: totals[statId] })),
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
    if (i === SLOT_TYPES.length) { assignGems(0); return }
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
