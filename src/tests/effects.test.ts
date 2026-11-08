import { describe, expect, it } from 'vitest'
import { buildBreakdown, effectiveValue, knownCaps, snapshotDrift, targetActual } from '@/domain/effects'
import { optimizeSingle } from '@/domain/optimizer'
import { SLOT_TYPES, type BuildPreset, type Equipment, type Gem, type StatDefinition } from '@/domain/types'

const stat = (id: string, cap: number | null, capStatus: StatDefinition['capStatus'] = 'known'): StatDefinition =>
  ({ id, name: id, category: 'equipment', cap, unit: '%', capStatus, description: '' })
const eq = (id: string, slotType: Equipment['slotType'], effects: Equipment['effects'], name = id): Equipment =>
  ({ id, name, slotType, effects, memo: '', createdAt: '', updatedAt: '' })
const gem = (id: string, effects: Gem['effects'], allowedSlots: Gem['allowedSlots'] = [...SLOT_TYPES]): Gem =>
  ({ id, name: id, effects, allowedSlots, memo: '', createdAt: '', updatedAt: '' })
const preset = (over: Partial<BuildPreset> = {}): BuildPreset => ({
  id: 'p', name: 'test', targets: [{ statId: 'S001', minValue: 100 }], priorityStats: [], maximizeStats: [],
  defaultCount: 1, priority: 1, description: '', ...over
})

describe('shared effect definition', () => {
  it('caps equipment before adding gem (165 / cap 140 / gem 20 = 160)', () => {
    const caps = knownCaps([stat('S001', 140)])
    expect(effectiveValue({ S001: 165 }, { S001: 20 }, caps, 'S001')).toBe(160)
  })
  it('does not cap when cap is unknown or disabled', () => {
    expect(effectiveValue({ S001: 165 }, { S001: 20 }, knownCaps([stat('S001', null, 'unknown')]), 'S001')).toBe(185)
    expect(effectiveValue({ S001: 165 }, { S001: 20 }, knownCaps([stat('S001', 140, 'disabled')]), 'S001')).toBe(185)
  })
  it('adds NPC gem G005 only for 援軍特化 S002 targets', () => {
    const caps = knownCaps([])
    expect(targetActual({ name: '援軍特化' }, 'S002', { S002: 50 }, { G005: 30 }, caps)).toBe(80)
    expect(targetActual({ name: 'バランス' }, 'S002', { S002: 50 }, { G005: 30 }, caps)).toBe(50)
  })
  it('detects drift between snapshot and current registration', () => {
    const parts = buildBreakdown({ equipmentIds: { helmet: 'h' }, gemAssignments: [] }, [eq('h', 'helmet', [{ statId: 'S001', value: 10 }])], [])
    expect(snapshotDrift({ S001: 10 }, parts)).toBe(0)
    expect(snapshotDrift({ S001: 12 }, parts)).toBe(1)
  })
})

describe('single optimizer parity with multi-commander rules', () => {
  const equipment = SLOT_TYPES.flatMap(slot => [
    eq(slot + 'A', slot, [{ statId: 'S001', value: 30 }], '強化' + slot),
    eq(slot + 'B', slot, [{ statId: 'S001', value: 10 }], '通常' + slot)
  ])
  it('honours the required-equipment keyword', () => {
    const r = optimizeSingle({ equipment, gems: [], stats: [], preset: preset({ targets: [{ statId: 'S001', minValue: 40 }], requiredEquipmentKeyword: '通常' }) })
    expect(Object.values(r!.equipmentIds).some(id => id!.endsWith('B'))).toBe(true)
  })
  it('returns null when nobody satisfies the required-equipment condition', () => {
    expect(optimizeSingle({ equipment, gems: [], stats: [], preset: preset({ requiredEquipmentKeyword: '存在しない' }) })).toBeNull()
  })
  it('applies equipment cap before gems in the result', () => {
    const r = optimizeSingle({ equipment, gems: [gem('g', [{ statId: 'S001', value: 20 }])], stats: [stat('S001', 100)], preset: preset({ targets: [{ statId: 'S001', minValue: 120 }] }) })
    expect(r!.shortfalls[0].actual).toBe(120)
    expect(r!.shortfalls[0].missing).toBe(0)
  })
  it('counts NPC gem toward 援軍特化 ranged target', () => {
    const e2 = SLOT_TYPES.map(slot => eq(slot, slot, [{ statId: 'S002', value: 10 }]))
    const r = optimizeSingle({ equipment: e2, gems: [gem('npc', [{ statId: 'G005', value: 30 }])], stats: [], preset: preset({ name: '援軍特化', targets: [{ statId: 'S002', minValue: 70 }] }) })
    expect(r!.shortfalls[0].missing).toBe(0)
  })
})

it('shares commander courtyard cap between equipment and gems, including aliases', () => {
  const parts = buildBreakdown({ equipmentIds: { helmet: 'h' }, gemAssignments: [{ gemId: 'g' }] },
    [eq('h', 'helmet', [{ statId: 'S003', value: 90 }])], [gem('g', [{ statId: 'G008', value: 30 }])])
  expect(targetActual({ name: '攻撃' }, 'G008', parts.equipment, parts.gem, knownCaps([stat('S003', 100)]))).toBe(100)
})
