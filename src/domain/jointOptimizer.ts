import { optimizeSingle, type OptimizationResult, type OptimizerMode } from './optimizer'
import type { BuildPreset, Equipment, Gem, StatDefinition } from './types'

export interface JointJob { preset: BuildPreset; ordinal: number; priority: number }
export interface JointBuild { job: JointJob; result: OptimizationResult }
export interface JointResult { builds: JointBuild[]; requested: number; evaluated: number; approximate: true; cancelled: boolean }

/**
 * Bounded beam search across all requested commanders.
 * Unlike greedy allocation, several competing equipment allocations survive each step.
 * This is a heuristic, NOT CP-SAT or a mathematical optimality proof.
 */
export async function optimizeJoint(input: {
  jobs: JointJob[]
  equipment: Equipment[]
  gems: Gem[]
  stats: StatDefinition[]
  reservedEquipmentIds: string[]
  reservedGemIds: string[]
  mode: OptimizerMode
  isCancelled?: () => boolean
  onProgress?: (done: number, total: number, evaluated: number) => void
}): Promise<JointResult> {
  type State = { builds: JointBuild[]; equipment: Set<string>; gems: Set<string>; priorityScore: number }
  const initial: State = {
    builds: [], equipment: new Set(input.reservedEquipmentIds),
    gems: new Set(input.reservedGemIds), priorityScore: 0
  }
  let beam: State[] = [initial]
  let evaluated = 0
  let cancelled = false
  const width = 4
  const jobs = [...input.jobs].sort((a, b) => a.priority - b.priority)
  const key = (s: State) => [...s.equipment].sort().join('|') + ':' + [...s.gems].sort().join('|')
  const compare = (a: State, b: State) =>
    b.builds.length - a.builds.length || b.priorityScore - a.priorityScore
  for (let index = 0; index < jobs.length; index++) {
    if (input.isCancelled?.()) { cancelled = true; break }
    const job = jobs[index]
    const next: State[] = []
    for (const state of beam) {
      // Skipping is essential: an impossible early preset must not block later ones.
      next.push(state)
      const excluded = new Set<string>()
      for (let variant = 0; variant < 4; variant++) {
        if (input.isCancelled?.()) { cancelled = true; break }
        const candidate = optimizeSingle({
          equipment: input.equipment, gems: input.gems, stats: input.stats,
          preset: job.preset, mode: input.mode,
          reservedEquipmentIds: [...state.equipment, ...excluded],
          reservedGemIds: [...state.gems],
          maxEvaluations: input.mode === 'precise' ? 12000 : 4000
        })
        if (!candidate) break
        evaluated += candidate.evaluated
        const ids = Object.values(candidate.equipmentIds).filter((id): id is string => !!id)
        if (!candidate.shortfalls.some(s => s.missing > 0)) {
          const equipment = new Set(state.equipment)
          const gems = new Set(state.gems)
          for (const id of ids) equipment.add(id)
          for (const assignment of candidate.gemAssignments) gems.add(assignment.gemId)
          next.push({
            builds: [...state.builds, { job, result: candidate }],
            equipment, gems,
            priorityScore: state.priorityScore + 1 / (1 + Math.max(0, job.priority))
          })
        }
        // Force a different equipment combination for the next candidate.
        // Rotating the blocked slot is less biased than always blocking the helmet.
        const ban = ids[(index + variant) % ids.length]
        if (!ban || excluded.has(ban)) break
        excluded.add(ban)
      }
    }
    if (cancelled) break
    const unique = new Map<string, State>()
    for (const state of next.sort(compare)) {
      const signature = key(state)
      if (!unique.has(signature)) unique.set(signature, state)
    }
    beam = [...unique.values()].slice(0, width)
    input.onProgress?.(index + 1, jobs.length, evaluated)
    // Yield so the browser can render progress and accept cancellation.
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  const best = [...beam].sort(compare)[0] ?? initial
  return { builds: best.builds, requested: jobs.length, evaluated, approximate: true, cancelled }
}
