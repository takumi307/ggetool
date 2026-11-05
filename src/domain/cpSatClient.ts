import { canonicalStatId } from './statAliases'
import type { BuildPreset, Equipment, Gem, StatDefinition } from './types'
import type { OptimizationResult } from './optimizer'

export interface CpSatJob { preset: BuildPreset; ordinal: number; priority: number }
export interface CpSatBuild { job: CpSatJob; result: OptimizationResult }
export interface CpSatOutcome {
  status: string
  optimal: boolean
  achieved: number
  requested: number
  builds: CpSatBuild[]
}
interface ServerBuild {
  presetId: string
  ordinal: number
  equipmentIds: OptimizationResult['equipmentIds']
  gemAssignments: OptimizationResult['gemAssignments']
  totals: OptimizationResult['totals']
  shortfalls: OptimizationResult['shortfalls']
  overflow: OptimizationResult['overflow']
}
interface ServerResponse {
  status: string
  optimal: boolean
  achieved: number
  requested: number
  builds: ServerBuild[]
}
export const cpSatEndpoint = (import.meta.env.VITE_OPTIMIZER_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

export async function optimizeCpSat(input: {
  jobs: CpSatJob[]
  equipment: Equipment[]
  gems: Gem[]
  stats: StatDefinition[]
  reservedEquipmentIds: string[]
  reservedGemIds: string[]
  timeLimitSeconds: number
  signal?: AbortSignal
}): Promise<CpSatOutcome> {
  if (!cpSatEndpoint) throw new Error('CP-SAT APIが未設定です。VITE_OPTIMIZER_API_URLを設定してください。')
  const response = await fetch(cpSatEndpoint + '/optimize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: input.signal,
    body: JSON.stringify({
      equipment: input.equipment, gems: input.gems.map(g => ({ ...g, effects: g.effects.map(e => ({ ...e, statId: canonicalStatId(e.statId) })) })), stats: input.stats,
      jobs: input.jobs.map(j => ({
        presetId: j.preset.id, ordinal: j.ordinal, priority: j.priority, targets: j.preset.targets.map(t => ({ ...t, statId: canonicalStatId(t.statId) }))
      })),
      reservedEquipmentIds: input.reservedEquipmentIds,
      reservedGemIds: input.reservedGemIds,
      timeLimitSeconds: input.timeLimitSeconds
    })
  })
  if (!response.ok) throw new Error('CP-SAT APIエラー: HTTP ' + response.status)
  const data = await response.json() as ServerResponse
  if (!Array.isArray(data.builds)) throw new Error('CP-SAT APIから不正な応答が返されました')
  const jobs = new Map(input.jobs.map(j => [j.preset.id + ':' + j.ordinal, j]))
  const eq = new Map(input.equipment.map(e => [e.id, e]))
  const gems = new Map(input.gems.map(g => [g.id, g]))
  const reservedEq = new Set(input.reservedEquipmentIds)
  const reservedGem = new Set(input.reservedGemIds)
  const usedEq = new Set<string>()
  const usedGem = new Set<string>()
  const builds: CpSatBuild[] = []
  for (const b of data.builds) {
    const job = jobs.get(b.presetId + ':' + b.ordinal)
    if (!job) throw new Error('CP-SAT APIが未知のビルドを返しました')
    const slots = ['helmet', 'weapon', 'armor', 'artifact'] as const
    for (const slot of slots) {
      const id = b.equipmentIds[slot]
      if (!id || !eq.has(id) || eq.get(id)?.slotType !== slot || reservedEq.has(id) || usedEq.has(id)) throw new Error('装備の割当が不正です')
      usedEq.add(id)
    }
    const gemSlots = new Set<string>()
    for (const a of b.gemAssignments) {
      const gem = gems.get(a.gemId)
      if (!gem || !slots.includes(a.slotType) || !gem.allowedSlots.includes(a.slotType) ||
        gemSlots.has(a.slotType) || usedGem.has(a.gemId) || reservedGem.has(a.gemId)) throw new Error('ジェムの割当が不正です')
      gemSlots.add(a.slotType); usedGem.add(a.gemId)
    }
    // Recalculate from local equipment to avoid trusting arbitrary API totals.
    const totals: Record<string, number> = {}
    const add = (effects: { statId: string; value: number }[]) => {
      for (const e of effects) totals[canonicalStatId(e.statId)] = (totals[canonicalStatId(e.statId)] ?? 0) + e.value
    }
    for (const slot of slots) add(eq.get(b.equipmentIds[slot]!)!.effects)
    for (const a of b.gemAssignments) add(gems.get(a.gemId)!.effects)
    const caps = new Map(input.stats.filter(s => s.capStatus === 'known' && s.cap !== null).map(s => [s.id, s.cap!]))
    const shortfalls = job.preset.targets.map(t => {
      const actual = Math.min(totals[canonicalStatId(t.statId)] ?? 0, caps.get(canonicalStatId(t.statId)) ?? Infinity)
      return { statId: t.statId, required: t.minValue, actual, missing: Math.max(0, t.minValue - actual - 1e-8) }
    })
    if (shortfalls.some(s => s.missing > 1e-8)) throw new Error('APIの候補が最低目標を満たしていません')
    builds.push({ job, result: {
      equipmentIds: b.equipmentIds, gemAssignments: b.gemAssignments, totals, shortfalls,
      overflow: [...caps].filter(([id, cap]) => (totals[id] ?? 0) > cap)
        .map(([statId, cap]) => ({ statId, cap, raw: totals[statId] })),
      evaluated: 0, approximate: !data.optimal
    } })
  }
  if (builds.length !== data.achieved || builds.length > input.jobs.length) throw new Error('APIの件数が不正です')
  return { status: data.status, optimal: data.optimal, achieved: builds.length, requested: data.requested, builds }
}
