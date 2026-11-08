import { canonicalStatId } from './statAliases'
import { npcBonusId } from './effects'
import type { BuildPreset, ObjectiveStage, PresetObjective } from './types'

export const OBJECTIVE_STAGES: ObjectiveStage[] = ['planPriority', 'weighted', 'overshoot', 'stability']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function objectiveTargetIds(preset: BuildPreset): Set<string> {
  return new Set(preset.targets.flatMap(target => [
    canonicalStatId(target.statId), npcBonusId(preset, target.statId),
  ].filter((id): id is string => id !== undefined)))
}

export function defaultPresetObjective(preset: BuildPreset): PresetObjective {
  const targets = objectiveTargetIds(preset)
  const legacyWeights = new Map(preset.maximizeStats.map(statId => [canonicalStatId(statId), statId]))
  return {
    order: [...OBJECTIVE_STAGES],
    weights: [...legacyWeights]
      .filter(([id]) => !targets.has(id)).map(([, statId]) => ({ statId, weight: 1 })),
    overshoot: 'ignore',
    reopt: { keepGems: true, minimizeSwaps: true },
  }
}

export function validatePresetObjective(value: unknown, statIds: Set<string>, targetIds: Set<string>): string | null {
  if (value === undefined) return null
  if (!isRecord(value) || !Array.isArray(value.order) || value.order.length !== OBJECTIVE_STAGES.length ||
      !OBJECTIVE_STAGES.every(stage => value.order instanceof Array && value.order.includes(stage)) ||
      (typeof value.overshoot !== 'string' || !['ignore', 'minimize', 'reward'].includes(value.overshoot)) ||
      !isRecord(value.reopt) || typeof value.reopt.keepGems !== 'boolean' ||
      typeof value.reopt.minimizeSwaps !== 'boolean' || !Array.isArray(value.weights) || value.weights.length > 300) {
    return '詳細設定の優先順・超過分・付け替え方針を確認してください'
  }
  const seen = new Set<string>()
  for (const row of value.weights) {
    if (!isRecord(row) || typeof row.statId !== 'string' || !statIds.has(row.statId) ||
        typeof row.weight !== 'number' || !Number.isInteger(row.weight) || row.weight < 1 || row.weight > 100) {
      return '加点する効果と重み（1〜100の整数）を確認してください'
    }
    const id = canonicalStatId(row.statId)
    if (seen.has(id) || targetIds.has(id)) return '最低目標や重複する効果は加点に指定できません'
    seen.add(id)
  }
  return null
}
