import { describe, expect, it } from 'vitest'
import { optimizeSingle } from '@/domain/optimizer'
import { SLOT_TYPES, type Equipment, type BuildPreset } from '@/domain/types'

const equipment: Equipment[] = SLOT_TYPES.flatMap(slot => [10, 20].map(value => ({
  id: slot + value, name: slot + value, slotType: slot,
  effects: [{ statId: 'S001', value }], memo: '', createdAt: '', updatedAt: ''
})))
const preset: BuildPreset = {
  id: 'p', name: 'p', targets: [{ statId: 'S001', minValue: 70 }],
  priorityStats: ['S001'], maximizeStats: ['S001'],
  defaultCount: 1, priority: 1, description: ''
}
describe('optimizer modes', () => {
  it('precise exhausts small candidate sets', () => {
    const result = optimizeSingle({ equipment, gems: [], stats: [], preset, mode: 'precise' })
    expect(result?.totals.S001).toBe(80)
    expect(result?.approximate).toBe(false)
  })
  it('fast never claims exact optimality', () => {
    const result = optimizeSingle({ equipment, gems: [], stats: [], preset, mode: 'fast' })
    expect(result?.approximate).toBe(true)
  })
  it('truncated precise is approximate', () => {
    const result = optimizeSingle({ equipment, gems: [], stats: [], preset, mode: 'precise', maxEvaluations: 1 })
    expect(result?.approximate).toBe(true)
  })
})
