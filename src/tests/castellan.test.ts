import { describe, expect, it } from 'vitest'
import { CASTELLAN_STAT_SEEDS, mergeCastellanStats } from '@/domain/castellanStats'
import { addEffects, castellanScoringScales, castellanScoringStats, effectiveValue, knownCaps } from '@/domain/effects'
import { optimizeCastellanPlan } from '@/domain/castellanPlanner'
import { optimizeSingle } from '@/domain/optimizer'
import { SLOT_TYPES, type BuildPreset, type Equipment, type Gem } from '@/domain/types'

const makePreset = (castellanObjective?: BuildPreset['castellanObjective']): BuildPreset => ({
  id: 'test', name: 'test', castellanObjective, targets: [], priorityStats: [],
  maximizeStats: [], defaultCount: 1, priority: 1, description: '',
})

const makeEquipment = (id: string, slotType: Equipment['slotType'], effects: Equipment['effects'] = []): Equipment => ({
  id, name: id, slotType, effects, memo: '', createdAt: '', updatedAt: '',
})

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
    const scales = castellanScoringScales(CASTELLAN_STAT_SEEDS, [{ effects: [{ statId: 'C012', value: 805 }] }])
    expect(scales.get(guardian.id)).toBe(805)
  })

  it('scores NPC wall capacity and combat bonuses five times higher and skips resource loss', () => {
    const scales = new Map(['C001', 'C002', 'C003', 'C007', 'CNG01', 'CNG02', 'CNG06', 'CNG07', 'C004', 'C011', 'CPG01']
      .map(id => [id, 100]))
    const preset = makePreset('npc')
    preset.targets = [{ statId: 'CG003', minValue: 40 }]
    const scoring = castellanScoringStats(preset, scales)
    expect(scoring.filter(stat => stat.weight === 5).map(stat => stat.id))
      .toEqual(['C001', 'C002', 'C007', 'CNG01', 'CNG02', 'CNG06', 'CNG07'])
    expect(scoring.filter(stat => stat.weight === 1).map(stat => stat.id)).toEqual(['C004'])
    expect(castellanScoringStats(makePreset('lord'), scales).map(stat => stat.id)).toContain('C011')
  })

  it('meets the target before improving other effects in precise and fast searches', () => {
    const preset = makePreset('npc')
    preset.targets = [{ statId: 'C001', minValue: 100 }]
    const equipment = [
      ...SLOT_TYPES.filter(slot => slot !== 'helmet').map(slot => makeEquipment(slot, slot)),
      ...Array.from({ length: 6 }, (_, index) => makeEquipment('surplus-' + index, 'helmet', [
        { statId: 'C001', value: 140 }, { statId: 'C011', value: 50 },
      ])),
      makeEquipment('shortfall', 'helmet', [{ statId: 'C001', value: 99 }, { statId: 'C007', value: 50 }]),
      makeEquipment('best', 'helmet', [{ statId: 'C001', value: 100 }, { statId: 'C007', value: 15 }]),
    ]
    const gems: Gem[] = [
      ...Array.from({ length: 12 }, (_, index): Gem => ({
        id: 'wall-' + index, name: 'wall', allowedSlots: ['weapon'], effects: [{ statId: 'CNG04', value: 60 }],
        memo: '', createdAt: '', updatedAt: '',
      })),
      {
        id: 'courtyard', name: 'courtyard', allowedSlots: ['weapon'], effects: [{ statId: 'CNG02', value: 20 }],
        memo: '', createdAt: '', updatedAt: '',
      },
    ]
    for (const mode of ['precise', 'fast'] as const) {
      const result = optimizeSingle({ preset, equipment, gems, stats: CASTELLAN_STAT_SEEDS, mode })
      expect(result?.equipmentIds.helmet).toBe('best')
      expect(result?.shortfalls[0].missing).toBe(0)
      expect(result?.gemAssignments).toEqual([{ slotType: 'weapon', gemId: 'courtyard' }])
    }
  })

  it('uses other defense effects for older castellan presets without a defense mode', () => {
    const preset = makePreset()
    preset.targets = [{ statId: 'C001', minValue: 100 }]
    const equipment = [
      ...SLOT_TYPES.filter(slot => slot !== 'helmet').map(slot => makeEquipment(slot, slot)),
      makeEquipment('surplus', 'helmet', [{ statId: 'C001', value: 140 }]),
      makeEquipment('best', 'helmet', [{ statId: 'C001', value: 100 }, { statId: 'C003', value: 40 }]),
    ]
    const result = optimizeCastellanPlan({
      equipment, gems: [], stats: CASTELLAN_STAT_SEEDS, jobs: [{ preset, ordinal: 1, priority: 1 }],
    })
    expect(result.builds[0].result.equipmentIds.helmet).toBe('best')
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
