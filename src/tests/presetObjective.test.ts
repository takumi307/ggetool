import { expect, it } from 'vitest'
import { defaultPresetObjective, objectiveTargetIds, validatePresetObjective } from '@/domain/presetObjective'
import type { BuildPreset } from '@/domain/types'

const preset: BuildPreset = {
  id: 'p', name: '援軍特化', targets: [{ statId: 'S002', minValue: 140 }],
  priorityStats: [], maximizeStats: ['G005', 'G008', 'S003'], defaultCount: 1, priority: 1, description: '',
}

it('initializes detail weights from old backups without double-counting aliases or target bonuses', () => {
  const objective = defaultPresetObjective(preset)
  expect(objective.weights).toEqual([{ statId: 'S003', weight: 1 }])
  expect(validatePresetObjective(objective, new Set(['S003']), objectiveTargetIds(preset))).toBeNull()
  expect(validatePresetObjective({ ...objective, weights: [{ statId: 'G005', weight: 1 }] }, new Set(['G005']), objectiveTargetIds(preset))).not.toBeNull()
  expect(validatePresetObjective({ ...objective, order: ['weighted', 'weighted', 'stability', 'overshoot'] }, new Set(['S003']), objectiveTargetIds(preset))).not.toBeNull()
})
