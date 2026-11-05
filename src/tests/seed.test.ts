import { describe, expect, it } from 'vitest'
import { EQUIPMENT_STAT_SEEDS, GEM_STAT_SEEDS, STAT_SEEDS } from '@/domain'

describe('stat seeds', () => {
  it('装備用12種・ジェム用9種（重複統合後）', () => {
    expect(EQUIPMENT_STAT_SEEDS).toHaveLength(12)
    expect(GEM_STAT_SEEDS).toHaveLength(9)
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
  it('装備用は上限が数値で known', () => {
    for (const s of EQUIPMENT_STAT_SEEDS) {
      expect(typeof s.cap).toBe('number')
      expect(s.capStatus).toBe('known')
    }
  })
})
