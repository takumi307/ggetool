import { describe, expect, it } from 'vitest'
import { EQUIPMENT_STAT_SEEDS, GEM_STAT_SEEDS, STAT_SEEDS } from '@/domain'

describe('stat seeds', () => {
  it('装備用14種・ジェム用10種', () => {
    expect(EQUIPMENT_STAT_SEEDS).toHaveLength(14)
    expect(GEM_STAT_SEEDS).toHaveLength(10)
  })
  it('IDが一意', () => {
    const ids = STAT_SEEDS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('ジェム専用は全て上限未確認(null)で、上限なしとは区別される', () => {
    for (const s of GEM_STAT_SEEDS) {
      expect(s.cap).toBeNull()
      expect(s.capStatus).toBe('unknown')
    }
  })
  it('乙女の援軍は人数で記録し、装備効果の上限は未確認', () => {
    expect(EQUIPMENT_STAT_SEEDS.find(s => s.id === 'S013')).toMatchObject({
      unit: '人', cap: null, capStatus: 'unknown',
    })
    for (const s of EQUIPMENT_STAT_SEEDS.filter(s => s.id !== 'S013')) {
      expect(typeof s.cap).toBe('number')
      expect(s.capStatus).toBe('known')
    }
  })
})
