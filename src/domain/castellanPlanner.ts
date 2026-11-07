import { buildBreakdown, castellanQuality, knownCaps, requiredEquipmentMatcher, targetActual } from './effects'
import { optimizeSingle, type OptimizeInput, type OptimizationResult } from './optimizer'
import { SLOT_TYPES } from './types'
import type { CpSatBuild, CpSatJob, CpSatOutcome } from './cpSatClient'

export interface CastellanPlanInput extends Omit<OptimizeInput, 'preset'> {
  jobs: CpSatJob[]
  maxAchieved?: number
}

/** Reserve the best found NPC sets first, then distribute the remaining items. */
export function optimizeCastellanPlan(input: CastellanPlanInput): CpSatOutcome {
  const usedEquipment = new Set(input.reservedEquipmentIds)
  const usedGems = new Set(input.reservedGemIds)
  const builds: CpSatBuild[] = []
  const order = (job: CpSatJob) => job.preset.castellanObjective === 'npc' ? 0 : 1
  const jobs = [...input.jobs].sort((a, b) => order(a) - order(b) || a.priority - b.priority)
  for (const job of jobs) {
    if (builds.length >= (input.maxAchieved ?? jobs.length)) break
    const result = optimizeSingle({
      ...input, preset: job.preset, mode: 'auto', maxEvaluations: 20_000,
      reservedEquipmentIds: [...usedEquipment], reservedGemIds: [...usedGems],
    })
    if (!result || result.shortfalls.some(target => target.missing > 1e-8)) continue
    for (const id of Object.values(result.equipmentIds)) if (id) usedEquipment.add(id)
    for (const assignment of result.gemAssignments) usedGems.add(assignment.gemId)
    builds.push({ job, result: { ...result, approximate: true } })
  }
  balanceLordBuilds(input, builds.filter(build => build.job.preset.castellanObjective === 'lord'))
  return { status: builds.length ? 'FEASIBLE' : 'UNKNOWN', optimal: false, achieved: builds.length, requested: jobs.length, builds }
}

function balanceLordBuilds(input: CastellanPlanInput, builds: CpSatBuild[]) {
  const equipment = new Map(input.equipment.map(item => [item.id, item]))
  const gems = new Map(input.gems.map(item => [item.id, item]))
  const caps = knownCaps(input.stats)

  function evaluate(job: CpSatJob, result: OptimizationResult) {
    const weapons = Object.values(result.equipmentIds).flatMap(id => {
      const item = id && equipment.get(id)
      return item ? [item] : []
    })
    const matches = requiredEquipmentMatcher(job.preset)
    if (matches && !weapons.some(matches)) return null
    const jewels = result.gemAssignments.flatMap(assignment => {
      const item = gems.get(assignment.gemId)
      return item ? [item] : []
    })
    const parts = buildBreakdown(result, weapons, jewels)
    const shortfalls = job.preset.targets.map(target => {
      const actual = targetActual(job.preset, target.statId, parts.equipment, parts.gem, caps)
      return { statId: target.statId, required: target.minValue, actual, missing: Math.max(0, target.minValue - actual) }
    })
    if (shortfalls.some(target => target.missing > 1e-8)) return null
    const totals = Object.fromEntries([...new Set([...Object.keys(parts.equipment), ...Object.keys(parts.gem)])]
      .map(id => [id, (parts.equipment[id] ?? 0) + (parts.gem[id] ?? 0)]))
    const overflow = [...caps].flatMap(([statId, cap]) => {
      const raw = parts.equipment[statId] ?? 0
      return raw > cap ? [{ statId, cap, raw }] : []
    })
    return { result: { ...result, totals, shortfalls, overflow }, quality: castellanQuality('lord', parts.equipment, parts.gem, caps) }
  }

  const scores = builds.map(build => evaluate(build.job, build.result)?.quality ?? 0)
  // Swap between builds at the same slot, so slot compatibility and unique ownership are preserved.
  for (let i = 0; i < builds.length; i++) {
    for (let j = i + 1; j < builds.length; j++) {
      const left = builds[i], right = builds[j]
      for (const slot of SLOT_TYPES) {
        const leftGem = left.result.gemAssignments.find(a => a.slotType === slot)
        const rightGem = right.result.gemAssignments.find(a => a.slotType === slot)
        for (const swapGems of [false, true]) {
          if (swapGems && !leftGem && !rightGem) continue
          const candidate = (from: CpSatBuild, to: CpSatBuild, gem: typeof leftGem): OptimizationResult => swapGems ? {
            ...from.result,
            gemAssignments: [...from.result.gemAssignments.filter(a => a.slotType !== slot), ...(gem ? [gem] : [])],
          } : { ...from.result, equipmentIds: { ...from.result.equipmentIds, [slot]: to.result.equipmentIds[slot] } }
          const a = evaluate(left.job, candidate(left, right, rightGem))
          const b = evaluate(right.job, candidate(right, left, leftGem))
          if (!a || !b) continue
          const minimum = Math.min(scores[i], scores[j])
          const nextMinimum = Math.min(a.quality, b.quality)
          const improves = nextMinimum > minimum + 1e-8 ||
            (Math.abs(nextMinimum - minimum) <= 1e-8 && a.quality + b.quality > scores[i] + scores[j] + 1e-8)
          if (improves) {
            left.result = a.result
            right.result = b.result
            scores[i] = a.quality
            scores[j] = b.quality
            break
          }
        }
      }
    }
  }
}
