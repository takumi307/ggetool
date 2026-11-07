import { canonicalStatId } from './statAliases'
import type { BuildPreset, EffectEntry, Equipment, StatDefinition } from './types'

export type Totals = Record<string, number>

/** 効果を別名統合したIDで合算する。 */
export function addEffects(target: Totals, effects: EffectEntry[]): void {
  for (const e of effects) {
    const id = canonicalStatId(e.statId)
    target[id] = (target[id] ?? 0) + e.value
  }
}

/** 確認済みの効果上限を返す（未確認・無効は含めない）。 */
export function knownCaps(stats: StatDefinition[]): Map<string, number> {
  return new Map(stats.filter(s => s.capStatus === 'known' && s.cap !== null).map(s => [s.id, s.cap as number]))
}

/** 計算の唯一の定義: min(装備合計, 確認済み上限) + ジェム合計。 */
export function effectiveValue(equipment: Totals, gem: Totals, caps: Map<string, number>, id: string): number {
  const cap = caps.get(id) ?? Infinity
  const weapon = equipment[id] ?? 0
  const jewel = gem[id] ?? 0
  if (id === 'C003') return Math.min(weapon + jewel, cap)
  const gemCap = id === 'C007' ? caps.get('CG007') ?? Infinity
    : id.startsWith('CNG') || id.startsWith('CPG') ? cap : Infinity
  return Math.min(weapon, cap) + Math.min(jewel, gemCap)
}

const NPC_PRIORITY_STATS = new Set(['C001', 'C002', 'C003', 'C007', 'CNG01', 'CNG02', 'CNG06', 'CNG07'])

/** Compare capped effects by their caps and uncapped effects by the largest single item bonus. */
export function castellanScoringScales(stats: StatDefinition[], items: { effects: EffectEntry[] }[]): Map<string, number> {
  const scales = new Map<string, number>()
  for (const item of items) {
    const totals: Totals = {}
    addEffects(totals, item.effects)
    for (const [id, value] of Object.entries(totals)) scales.set(id, Math.max(scales.get(id) ?? 0, value))
  }
  for (const [id, cap] of knownCaps(stats)) {
    if (cap > 0 && scales.has(id)) scales.set(id, cap)
  }
  return scales
}

export function castellanScoringStats(preset: BuildPreset, scales: Map<string, number>) {
  const objective = preset.castellanObjective
  const targets = new Set(preset.targets.map(target => canonicalStatId(target.statId)))
  return [...scales]
    .filter(([id, scale]) => scale > 0 && !targets.has(id) &&
      (objective === 'npc' || !id.startsWith('CNG')) &&
      (objective === 'lord' || !id.startsWith('CPG')) &&
      (objective !== 'npc' || id !== 'C011'))
    .map(([id, scale]) => ({ id, scale, weight: objective === 'npc' && NPC_PRIORITY_STATS.has(id) ? 5 : 1 }))
}

export function castellanQuality(
  objective: NonNullable<BuildPreset['castellanObjective']>,
  equipment: Totals,
  gems: Totals,
  caps: Map<string, number>,
  scoringStats: ReturnType<typeof castellanScoringStats>
): number {
  return scoringStats.reduce((total, stat) => {
    const ratio = effectiveValue(equipment, gems, caps, stat.id) / stat.scale
    return total + stat.weight * (objective === 'lord' ? Math.sqrt(ratio) : ratio)
  }, 0)
}

/** 援軍特化プリセットの遠隔(S002)目標に限り、NPC遠隔ジェム(G005)を加算する。 */
export function npcBonusId(preset: Pick<BuildPreset, 'name'>, statId: string): string | undefined {
  return preset.name.includes('援軍特化') && canonicalStatId(statId) === 'S002' ? 'G005' : undefined
}

/** 目標1件の実効値（NPC補正を含む）。 */
export function targetActual(preset: Pick<BuildPreset, 'name'>, statId: string, equipment: Totals, gem: Totals, caps: Map<string, number>): number {
  const id = canonicalStatId(statId)
  const bonus = npcBonusId(preset, statId)
  return effectiveValue(equipment, gem, caps, id) + (bonus ? gem[bonus] ?? 0 : 0)
}

/** 必須武具条件（効果指定が優先、なければ名前の部分一致）。条件なしなら null。 */
export function requiredEquipmentMatcher(preset: Pick<BuildPreset, 'requiredEquipmentStatId' | 'requiredEquipmentKeyword'>): ((e: Equipment) => boolean) | null {
  if (preset.requiredEquipmentStatId) {
    const id = canonicalStatId(preset.requiredEquipmentStatId)
    return e => e.effects.some(x => canonicalStatId(x.statId) === id && x.value > 0)
  }
  const keyword = preset.requiredEquipmentKeyword?.trim()
  return keyword ? e => e.name.includes(keyword) : null
}

/** 保存済み構成の表示用に、装備上限適用後の実効値を全効果について返す。 */
export function effectiveTotals(equipment: Totals, gem: Totals, caps: Map<string, number>): Totals {
  const out: Totals = {}
  for (const id of new Set([...Object.keys(equipment), ...Object.keys(gem)])) out[id] = effectiveValue(equipment, gem, caps, id)
  return out
}

export interface BuildBreakdown {
  equipment: Totals
  gem: Totals
  /** 構成が参照する装備・ジェムのうち、現在の登録に見つからないものの数 */
  missingItems: number
}

/** 構成の装備・ジェムを現在の登録データから引き、装備・ジェム別に合算する。 */
export function buildBreakdown(
  build: { equipmentIds: Partial<Record<string, string>>; gemAssignments: { gemId: string }[] },
  equipment: Equipment[],
  gems: { id: string; effects: EffectEntry[] }[]
): BuildBreakdown {
  const eq = new Map(equipment.map(e => [e.id, e]))
  const gm = new Map(gems.map(g => [g.id, g]))
  const out: BuildBreakdown = { equipment: {}, gem: {}, missingItems: 0 }
  for (const id of Object.values(build.equipmentIds)) {
    const item = id ? eq.get(id) : undefined
    if (item) addEffects(out.equipment, item.effects); else out.missingItems++
  }
  for (const a of build.gemAssignments) {
    const gem = gm.get(a.gemId)
    if (gem) addEffects(out.gem, gem.effects); else out.missingItems++
  }
  return out
}

/** 保存時スナップショット(合算値)と現在の登録から再計算した合算値が異なる効果の数。 */
export function snapshotDrift(snapshot: Record<string, unknown>, current: BuildBreakdown): number {
  const raw: Totals = {}
  for (const id of new Set([...Object.keys(current.equipment), ...Object.keys(current.gem)])) raw[id] = (current.equipment[id] ?? 0) + (current.gem[id] ?? 0)
  const ids = new Set([...Object.keys(raw), ...Object.keys(snapshot).filter(k => !k.startsWith('_') && typeof snapshot[k] === 'number')])
  let n = 0
  for (const id of ids) {
    const saved = typeof snapshot[id] === 'number' ? snapshot[id] as number : 0
    if (Math.abs(saved - (raw[id] ?? 0)) > 1e-6) n++
  }
  return n
}
