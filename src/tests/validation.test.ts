import { describe, expect, it } from 'vitest'
import { STAT_SEEDS } from '@/domain/seed'
import { validateEquipment, validateGem, validateStat } from '@/domain/validation'

describe('Phase 2 validation', () => {
  const base = { id: 'x', name: 'test', memo: '', createdAt: '', updatedAt: '' }
  it('装備は3～4効果だけを許可', () => {
    const effects = ['S001','S002','S003'].map(statId => ({ statId, value: 12 }))
    expect(validateEquipment({ ...base, slotType: 'helmet', effects }, STAT_SEEDS)).toBeNull()
    expect(validateEquipment({ ...base, slotType: 'helmet', effects: effects.slice(0, 2) }, STAT_SEEDS)).not.toBeNull()
  })
  it('効果の重複登録を拒否', () => {
    const effects = ['S001','S001','S003'].map(statId => ({ statId, value: 12 }))
    expect(validateEquipment({ ...base, slotType: 'helmet', effects }, STAT_SEEDS)).not.toBeNull()
  })
  it('ジェムの装着可能部位が必要', () => {
    expect(validateGem({ ...base, allowedSlots: [], effects: [{ statId: 'G001', value: 1 }] }, STAT_SEEDS)).not.toBeNull()
  })
  it('未確認の上限はnullで保持', () => {
    expect(validateStat({ id: 'x', name: 'test', category: 'gem', cap: null, capStatus: 'unknown', unit: '%', description: '' })).toBeNull()
  })
})
