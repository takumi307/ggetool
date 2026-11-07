import { describe, expect, it } from 'vitest'
import { CASTELLAN_STAT_SEEDS, castellanScoringStats, mergeCastellanStats } from '@/domain/castellanStats'
import { addEffects, effectiveValue, knownCaps } from '@/domain/effects'
import { optimizeCastellanPlan } from '@/domain/castellanPlanner'
import { SLOT_TYPES, type BuildPreset, type Equipment, type Gem } from '@/domain/types'

describe('castellan caps and assignments', () => {
  it('shares the courtyard cap, keeps NPC and lord gem caps separate', () => {
    const caps = knownCaps(CASTELLAN_STAT_SEEDS)
    const gem = {}
    addEffects(gem, [{ statId: 'CG003', value: 35 }, { statId: 'CNG01', value: 70 }, { statId: 'CPG01', value: 20 }])
    expect(effectiveValue({ C003: 90 }, gem, caps, 'C003')).toBe(100)
    expect(effectiveValue({}, gem, caps, 'CNG01')).toBe(50)
    expect(effectiveValue({}, gem, caps, 'CPG01')).toBe(20)
    expect(caps.get('CPG01')).toBe(caps.get('CNG01'))
  })

  it('adds the general wall capacity gem to the regular defense effect', () => {
    const seed = mergeCastellanStats([]).find(stat => stat.id === 'CG007')!
    expect(seed).toMatchObject({ name: '防衛中の城壁最大部隊数', category: 'gem', capStatus: 'unknown' })
    const caps = knownCaps(CASTELLAN_STAT_SEEDS)
    const gems = {}
    addEffects(gems, [{ statId: 'CG007', value: 18 }])
    expect(effectiveValue({ C007: 60 }, gems, caps, 'C007')).toBe(68)
    expect(effectiveValue({}, gems, caps, 'CNG01')).toBe(0)
    caps.set('CG007', 10)
    expect(effectiveValue({ C007: 60 }, gems, caps, 'C007')).toBe(60)
  })

  it('updates only unchanged legacy definitions and retains IDs', () => {
    const seed = CASTELLAN_STAT_SEEDS.find(s => s.id === 'C003')!
    const legacy = { ...seed, name: '中庭防御時の戦闘力', cap: null, capStatus: 'unknown' as const }
    expect(mergeCastellanStats([legacy]).find(s => s.id === seed.id)).toEqual(seed)
    const edited = { ...legacy, cap: 90, capStatus: 'known' as const }
    expect(mergeCastellanStats([edited]).find(s => s.id === seed.id)).toEqual(edited)
  })

  it('renames the built-in front defense effect without resetting an edited cap', () => {
    const seed = CASTELLAN_STAT_SEEDS.find(s => s.id === 'C008')!
    const previous = { ...seed, name: '正面部隊の戦闘力', cap: 18 }
    expect(mergeCastellanStats([previous]).find(s => s.id === seed.id))
      .toEqual({ ...seed, cap: 18 })
  })

  it('registers the reinforcement count as a separate uncapped equipment stat', () => {
    const guardian = CASTELLAN_STAT_SEEDS.find(s => s.id === 'C012')!
    expect(guardian).toMatchObject({ category: 'equipment', unit: '人', cap: null, capStatus: 'unknown' })
    const caps = knownCaps(CASTELLAN_STAT_SEEDS)
    expect(effectiveValue({ C012: 792 }, {}, caps, 'C012')).toBe(792)
    expect(effectiveValue({ C012: 805 }, {}, caps, 'C012')).toBe(805)
    expect(castellanScoringStats('npc')).not.toContain(guardian)
  })

  it('reserves NPC gear and balances the requested lord builds without duplicates', () => {
    const equipment: Equipment[] = SLOT_TYPES.flatMap(slotType => [0, 1, 2].map(index => ({
      id: slotType + index, name: slotType + index, slotType,
      effects: index < 2 ? [{ statId: 'C001', value: 20 * (2 - index) }] : [],
      memo: '', createdAt: '', updatedAt: '',
    })))
    const gems: Gem[] = ['CNG01', 'CPG01'].map(statId => ({
      id: statId, name: statId, effects: [{ statId, value: 50 }], allowedSlots: ['helmet'],
      memo: '', createdAt: '', updatedAt: '',
    }))
    const preset = (kind: 'npc' | 'lord'): BuildPreset => ({
      id: kind, name: kind, castellanObjective: kind, targets: [], priorityStats: [],
      maximizeStats: [], defaultCount: 1, priority: 1, description: '',
    })
    const result = optimizeCastellanPlan({
      equipment, gems, stats: CASTELLAN_STAT_SEEDS,
      jobs: [
        { preset: preset('lord'), ordinal: 1, priority: 1 },
        { preset: preset('lord'), ordinal: 2, priority: 1 },
        { preset: preset('npc'), ordinal: 1, priority: 2 },
      ],
    })
    expect(result.achieved).toBe(3)
    const [npc, first, second] = result.builds.map(build => build.result)
    expect(npc.totals.C001).toBe(160)
    expect(npc.gemAssignments.map(a => a.gemId)).toEqual(['CNG01'])
    expect(new Set(result.builds.flatMap(build => Object.values(build.result.equipmentIds))).size).toBe(12)
    expect(first.totals.C001).toBeGreaterThan(0)
    expect(second.totals.C001).toBeGreaterThan(0)
  })
})
