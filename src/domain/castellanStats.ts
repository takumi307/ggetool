import type { StatDefinition } from './types'

const weapons = [
  ['C001', '防御時の乱闘兵の戦闘力', 140],
  ['C002', '防御時の遠隔兵の戦闘力', 140],
  ['C003', '中庭防御する際の戦闘力', 100],
  ['C004', '城壁の防御力', 160],
  ['C005', '城門の防御力', 160],
  ['C006', '堀の防御力', 120],
  ['C007', '防衛中の城壁の最大部隊数', 50],
  ['C008', '正面防御部隊の戦闘力', 20],
  ['C009', '側面の防御部隊の戦闘力', 20],
  ['C010', '防衛部隊の戦闘力', 20],
  ['C011', '略奪で失われる資源', 50],
] as const

const opponentEffects = [
  ['01', 'のターゲットからの攻撃を防御する際の城壁の最大部隊数', 50],
  ['02', 'のターゲットからの攻撃を中庭で防御する際の戦闘力', 60],
  ['03', 'のターゲットに対する堀の防御力', 30],
  ['04', 'ターゲットに対する城壁の防御力', 60],
  ['05', 'ターゲットに対する城門の防御力', 60],
  ['06', 'のターゲットからの攻撃を防御する際の乱闘兵の戦闘力', 50],
  ['07', 'のターゲットからの攻撃を防御する際の遠隔兵の戦闘力', 50],
] as const

export const CASTELLAN_GEM_ALIASES = new Map([
  ['CG001', 'C001'], ['CG002', 'C002'], ['CG003', 'C003'], ['CG007', 'C007'],
])

const stat = (id: string, name: string, category: StatDefinition['category'], cap: number | null): StatDefinition => ({
  id, name, category, cap, unit: '%', capStatus: cap === null ? 'unknown' : 'known', description: '',
})

export const CASTELLAN_STAT_SEEDS: StatDefinition[] = [
  ...weapons.map(([id, name, cap]) => stat(id, name, 'equipment', cap)),
  { ...stat('C012', '中庭防御時に受けるレベル10北の守護者の援軍', 'equipment', null), unit: '人' },
  stat('CG003', '中庭で防御する際の戦闘力', 'gem', null),
  stat('CG007', '防衛中の城壁最大部隊数', 'gem', null),
  ...opponentEffects.map(([id, name, cap]) => stat('CNG' + id, 'NPC' + name, 'gem', cap)),
  ...opponentEffects.map(([id, name, cap]) => stat('CPG' + id, '城主' + name, 'gem', cap)),
]

// These definitions are kept when an older installation or backup references them.
export const LEGACY_CASTELLAN_GEMS = [
  stat('CG001', '防御時の乱闘兵の戦闘力（ジェム・旧登録）', 'gem', null),
  stat('CG002', '防御時の遠隔兵の戦闘力（ジェム・旧登録）', 'gem', null),
]

const oldNames = new Map<string, string>([
  ['C003', '中庭防御時の戦闘力'],
  ['C007', '城壁の最大防御兵数'],
  ['C008', '正面防御時の戦闘力'],
  ['C009', '側面防御時の戦闘力'],
  ['CG001', '防御時の乱闘兵の戦闘力（ジェム）'],
  ['CG002', '防御時の遠隔兵の戦闘力（ジェム）'],
  ['CG003', '中庭防御時の戦闘力（ジェム）'],
])

export function mergeCastellanStats(existing: StatDefinition[]): StatDefinition[] {
  const byId = new Map(existing.map(value => [value.id, value]))
  for (const seed of [...CASTELLAN_STAT_SEEDS, ...LEGACY_CASTELLAN_GEMS.filter(s => byId.has(s.id))]) {
    const current = byId.get(seed.id)
    if (!current) byId.set(seed.id, seed)
    else if (current.name === (oldNames.get(seed.id) ?? seed.name) &&
             current.capStatus === 'unknown' && current.cap === null &&
             current.category === seed.category && current.unit === '%' && current.description === '') {
      byId.set(seed.id, seed)
    } else if (seed.id === 'C008' && (current.name === '正面部隊の戦闘力' || current.name === oldNames.get(seed.id))) {
      byId.set(seed.id, { ...current, name: seed.name })
    }
  }
  return [...byId.values()]
}

export function castellanScoringStats(objective: 'npc' | 'lord') {
  return CASTELLAN_STAT_SEEDS.filter(s =>
    s.cap !== null && (s.category === 'equipment' || s.id.startsWith(objective === 'npc' ? 'CNG' : 'CPG')))
}
