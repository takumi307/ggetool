import type { StatDefinition } from './types'

const eq = (id: string, name: string, cap: number): StatDefinition => ({
  id, name, category: 'equipment', cap, unit: '%', capStatus: 'known', description: '',
})

/** 設計書 §4-1 の初期ステータス12種 */
export const EQUIPMENT_STAT_SEEDS: StatDefinition[] = [
  eq('S001', '攻撃時の乱闘兵の戦闘力', 140),
  eq('S002', '攻撃時の遠隔兵の戦闘力', 140),
  eq('S003', '中庭で攻撃する際の戦闘力', 100),
  eq('S004', '城門の防御力', 160),
  eq('S005', '城壁の防御力', 160),
  eq('S006', '堀の防御力', 120),
  eq('S007', '軍の移動スピード', 100),
  eq('S008', '略奪時に獲得できる資源', 50),
  eq('S009', '正面の最大部隊数', 50),
  eq('S010', '側面の最大部隊数', 50),
  eq('S011', '正面を攻撃する時の部隊の戦闘力', 20),
  eq('S012', '側面を攻撃する時の部隊の戦闘力', 20),
  eq('S014', '攻撃する際の戦闘力', 20),
  { id: 'S013', name: '中庭攻撃時に受けるレベル10乙女の援軍', category: 'equipment', cap: null, unit: '人', capStatus: 'unknown', description: '中庭攻撃時に受けるレベル10乙女の援軍人数。624や654などを登録。上限は未確認。' },
]

const gem = (id: string, name: string, description = ''): StatDefinition => ({
  id, name, category: 'gem', cap: null, unit: '%', capStatus: 'unknown', description,
})

/**
 * 設計書 §4-3 のジェム専用ステータス。上限は全て未確認(null)。
 * 仮設定: 「NPCの城門の防御力」は設計書内で重複記載のため1種類に統合（9種）。
 * 仮設定: 項目8「中庭で攻撃する際の戦闘力」は通常装備(S003)と別効果として登録（§4-3 末尾に従う）。
 */
export const GEM_STAT_SEEDS: StatDefinition[] = [
  gem('G001', 'NPCの城壁の防御力'),
  gem('G002', 'NPCのターゲットを攻撃する際の敵の堀の防御'),
  gem('G003', 'NPCの城門の防御力', '設計書で重複記載のため統合'),
  gem('G004', 'NPCのターゲットを攻撃する際の乱闘兵の戦闘力'),
  gem('G005', 'NPCのターゲットを攻撃する際の遠隔兵の戦闘力'),
  gem('G006', 'NPCのターゲットを攻撃する際の正面の最大部隊数'),
  gem('G007', 'NPCのターゲットを攻撃する際の側面の最大部隊数'),
  gem('G008', '中庭で攻撃する際の戦闘力（ジェム）', '装備S003と合算し、合計100%上限を適用'),
  gem('G009', 'NPCのターゲットの中庭を攻撃する際の戦闘力'),
  gem('G010', '攻撃する際の側面の最大部隊数'),
]

export const STAT_SEEDS: StatDefinition[] = [...EQUIPMENT_STAT_SEEDS, ...GEM_STAT_SEEDS]
