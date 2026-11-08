import { SLOT_TYPES, type Equipment, type Gem, type StatDefinition, type EffectEntry } from './types'

export const validEffectNumber = (n: number): boolean =>
  Number.isFinite(n) && n >= 0 && n <= 100000 && Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6

export function validEffects(effects: EffectEntry[], stats: StatDefinition[], category: 'equipment' | 'gem'): string | null {
  if (!effects.length) return '効果を1件以上登録してください'
  for (const e of effects) {
    if (!stats.some(s => s.id === e.statId && s.category === category)) return '存在しない効果が含まれています'
    if (!validEffectNumber(e.value)) return '効果値は0〜100000、小数点以下3桁以内で入力してください'
  }
  return null
}
export function validateEquipment(e: Equipment, stats: StatDefinition[]): string | null {
  if (!e.name.trim()) return '装備名を入力してください'
  if (!SLOT_TYPES.includes(e.slotType)) return '部位が不正です'
  if (e.effects.length < 3 || e.effects.length > 4) return '装備の効果は3～4件です'
  return validEffects(e.effects, stats, 'equipment')
}
export function validateGem(g: Gem, stats: StatDefinition[]): string | null {
  if (!g.name.trim()) return 'ジェム名を入力してください'
  if (!g.allowedSlots.length || g.allowedSlots.some(s => !SLOT_TYPES.includes(s))) return '装着可能部位を選択してください'
  return validEffects(g.effects, stats, 'gem')
}
export function validateStat(s: StatDefinition): string | null {
  if (!s.name.trim()) return '効果名を入力してください'
  if (!['equipment','gem'].includes(s.category)) return '区分が不正です'
  if (!['known','unknown','disabled'].includes(s.capStatus)) return '上限の状態が不正です'
  if (s.capStatus === 'known' && (s.cap === null || !validEffectNumber(s.cap))) return '確認済み上限は0〜100000、小数点以下3桁以内で入力してください'
  if (s.capStatus !== 'known' && s.cap !== null) return '未確認・無効の上限値は空欄にしてください'
  return null
}
