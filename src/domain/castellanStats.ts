import type { StatDefinition } from './types'

const defenseEffects = [
  ['C001', '防御時の乱闘兵の戦闘力'],
  ['C002', '防御時の遠隔兵の戦闘力'],
  ['C003', '中庭防御時の戦闘力'],
  ['C004', '城壁の防御力'],
  ['C005', '城門の防御力'],
  ['C006', '堀の防御力'],
  ['C007', '城壁の最大防御兵数'],
  ['C008', '正面防御時の戦闘力'],
  ['C009', '側面防御時の戦闘力'],
] as const

export const CASTELLAN_GEM_ALIASES = new Map([
  ['CG001', 'C001'], ['CG002', 'C002'], ['CG003', 'C003'],
])

const stat = (id: string, name: string, category: StatDefinition['category']): StatDefinition => ({
  id, name, category, cap: null, unit: '%', capStatus: 'unknown', description: '',
})

export const CASTELLAN_STAT_SEEDS: StatDefinition[] = [
  ...defenseEffects.map(([id, name]) => stat(id, name, 'equipment')),
  ...[...CASTELLAN_GEM_ALIASES].map(([id, target]) =>
    stat(id, defenseEffects.find(([effect]) => effect === target)![1] + '（ジェム）', 'gem')),
]
