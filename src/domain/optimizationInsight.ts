import { addEffects, knownCaps, requiredEquipmentMatcher, targetActual, npcBonusId } from './effects'
import { canonicalStatId } from './statAliases'
import { SLOT_TYPES, type BuildPreset, type Equipment, type Gem, type StatDefinition } from './types'
import type { CpSatJob } from './cpSatClient'

export const STAGE_LABELS: Record<string, string> = {
  count: '目標を満たす人数', planPriority: '作成計画の優先度',
  weighted: '目標外の効果', overshoot: '目標を超えた分',
  stability: '付け替えの少なさ', priorityAndStability: '計画の優先度・付け替え',
}
export function objectiveOrderIssue(presets: BuildPreset[]): string {
  const custom = presets.filter(p => p.objective)
  if (new Set(custom.map(p => p.objective!.order.join(','))).size < 2) return ''
  return '優先順が異なります：' + custom.map(p => p.name).join('、') + '。プリセット編集で順番をそろえてください。'
}
export function objectiveDescription(p: BuildPreset, castellan: boolean): string {
  if (p.objective) {
    return ['目標達成人数', ...p.objective.order.map(stage => STAGE_LABELS[stage])].join(' → ') +
      '（加点 ' + p.objective.weights.length + '効果）'
  }
  if (castellan) return '目標達成人数 → 計画の優先度 → 目標外の防衛効果' +
    (p.castellanObjective === 'npc' ? '（城壁人数・戦闘力重視、資源損失は評価しない）' : '')
  return '目標達成人数 → 計画の優先度 → 付け替えの少なさ。戦闘力などをさらに高めるには、プリセットの詳細設定で加点効果を選んでください。'
}
export function maximumStages(presets: BuildPreset[], castellan: boolean): number {
  return presets.some(p => p.objective) ? 5 : castellan ? 3 : 2
}
export function inspectTargets(presets: BuildPreset[], equipment: Equipment[], gems: Gem[], stats: StatDefinition[]) {
  const caps = knownCaps(stats)
  const totals = (item: Equipment | Gem) => { const out: Record<string, number> = {}; addEffects(out, item.effects); return out }
  const eq = equipment.map(item => ({ item, values: totals(item) }))
  const gm = gems.map(item => ({ item, values: totals(item) }))
  return presets.flatMap(p => p.targets.map(t => {
    const id = canonicalStatId(t.statId)
    const bonus = npcBonusId(p, id)
    const equipmentMax = SLOT_TYPES.reduce((sum, slot) =>
      sum + Math.max(0, ...eq.filter(e => e.item.slotType === slot).map(e => e.values[id] ?? 0)), 0)
    // Each maximum is intentionally optimistic: one gem can be counted in
    // multiple slots and separate effects need not be achievable together.
    const gemMax = (key: string) => SLOT_TYPES.reduce((sum, slot) =>
      sum + Math.max(0, ...gm.filter(g => g.item.allowedSlots.includes(slot)).map(g => g.values[key] ?? 0)), 0)
    const gemValues = { [id]: gemMax(id), ...(bonus ? { [bonus]: gemMax(bonus) } : {}) }
    const optimistic = targetActual(p, id, { [id]: equipmentMax }, gemValues, caps)
    return { preset: p.name, statId: t.statId, required: t.minValue, optimistic,
      impossible: optimistic + 1e-8 < t.minValue }
  }))
}
export function requiredEquipmentIssues(presets: BuildPreset[], equipment: Equipment[]): string[] {
  return presets.flatMap(p => {
    const match = requiredEquipmentMatcher(p)
    return match && !equipment.some(match) ? [p.name + '：必須条件を満たす使用可能な装備がありません。'] : []
  })
}
export function jobPresets(jobs: CpSatJob[]): BuildPreset[] {
  return [...new Map(jobs.map(job => [job.preset.id, job.preset])).values()]
}
