import { expect, it } from 'vitest'
import { inspectTargets, objectiveOrderIssue } from '@/domain/optimizationInsight'
import { defaultPresetObjective } from '@/domain/presetObjective'
import { SLOT_TYPES, type BuildPreset, type Equipment, type StatDefinition, type Gem } from '@/domain'

const preset: BuildPreset = { id: 'p', name: 'p', targets: [], priorityStats: [], maximizeStats: [], defaultCount: 1, priority: 1, description: '' }
const gear: Equipment[] = SLOT_TYPES.map(slot => ({ id: slot, name: slot, slotType: slot,
  effects: [{ statId: 'S003', value: 30 }], memo: '', createdAt: '', updatedAt: '' }))
const gem: Gem = { id: 'g', name: 'g', allowedSlots: [...SLOT_TYPES], effects: [{ statId: 'G008', value: 30 }], memo: '', createdAt: '', updatedAt: '' }
const cap: StatDefinition = { id: 'S003', name: '中庭', category: 'equipment', capStatus: 'known', cap: 100, unit: '%', description: '' }
it('preflight uses shared courtyard cap despite optimistic gem reuse', () => {
  const check = inspectTargets([{ ...preset, targets: [{ statId: 'S003', minValue: 101 }] }], gear, [gem], [cap])[0]
  expect(check.optimistic).toBe(100)
  expect(check.impossible).toBe(true)
})
it('reports incompatible objective orders before network submission', () => {
  const a = { ...preset, objective: defaultPresetObjective(preset) }
  const b = { ...preset, id: 'b', name: 'b', objective: defaultPresetObjective(preset) }
  expect(objectiveOrderIssue([a, b])).toBe('')
  b.objective.order.reverse()
  expect(objectiveOrderIssue([a, b])).toContain('優先順')
})
