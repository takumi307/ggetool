import { describe, it, expect } from 'vitest'
import { MemoryDatabase } from '@/repositories/memoryDatabase'
import { saveCommander, deleteCommander } from '@/domain/commanderService'
import { SLOT_TYPES, type Equipment, type BuildPreset } from '@/domain/types'
import type { OptimizationResult } from '@/domain/optimizer'
const preset: BuildPreset = { id: 'p', name: 'test', targets: [], priorityStats: [], maximizeStats: [], defaultCount: 1, priority: 1, description: '' }
const equipment: Equipment[] = SLOT_TYPES.map(slot => ({ id: slot, name: slot, slotType: slot, effects: [], memo: '', createdAt: '', updatedAt: '' }))
const result: OptimizationResult = { equipmentIds: { helmet: 'helmet', weapon: 'weapon', armor: 'armor', artifact: 'artifact' }, gemAssignments: [], totals: {}, shortfalls: [], overflow: [], evaluated: 1, approximate: false }
describe('commander allocations', () => {
  it('saves and releases equipment atomically', async () => {
    const db = new MemoryDatabase()
    await db.repo('presets').put(preset)
    await db.repo('equipment').bulkPut(equipment)
    const b = await saveCommander(db, 'first', 'p', result)
    expect(await db.repo('equipmentAllocations').count()).toBe(4)
    await expect(saveCommander(db, 'second', 'p', result)).rejects.toThrow('使用中')
    expect(await db.repo('commanders').count()).toBe(1)
    await deleteCommander(db, b.id)
    expect(await db.repo('equipmentAllocations').count()).toBe(0)
    expect(await db.repo('commanders').count()).toBe(0)
  })
})
