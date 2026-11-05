import { describe, expect, it } from 'vitest'
import { optimizeSingle } from '@/domain/optimizer'
import { SLOT_TYPES, type Equipment, type BuildPreset } from '@/domain/types'
const equipment: Equipment[] = SLOT_TYPES.flatMap(slot => [10, 20].map(n => ({
  id: slot + n, name: slot + n, slotType: slot, effects: [{ statId: 'S001', value: n }],
  memo: '', createdAt: '', updatedAt: ''
})))
const preset: BuildPreset = {
  id: 'p', name: 'test', targets: [{ statId: 'S001', minValue: 75 }],
  priorityStats: ['S001'], maximizeStats: ['S001'], defaultCount: 1, priority: 1, description: ''
}
describe('single commander optimizer', () => {
  it('finds target-achieving equipment without duplicates', () => {
    const r = optimizeSingle({ equipment, gems: [], stats: [], preset })
    expect(r).not.toBeNull()
    expect(r?.totals.S001).toBe(80)
    expect(r?.shortfalls[0].missing).toBe(0)
    expect(r?.approximate).toBe(false)
  })
  it('reports approximation when search is truncated', () => {
    const r = optimizeSingle({ equipment, gems: [], stats: [], preset, maxEvaluations: 1 })
    expect(r?.approximate).toBe(true)
  })
  it('returns null when required slot has no available equipment', () => {
    expect(optimizeSingle({ equipment: equipment.slice(1), gems: [], stats: [], preset, reservedEquipmentIds: ['helmet20'] })).toBeNull()
  })
})
