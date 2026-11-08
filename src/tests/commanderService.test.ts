import { describe, it, expect } from 'vitest'
import { MemoryDatabase } from '@/repositories/memoryDatabase'
import { saveCommander, saveCommanders, deleteCommander } from '@/domain/commanderService'
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

it('rolls back the whole new batch when a later build reuses an item', async () => {
  const db = new MemoryDatabase()
  await db.repo('presets').put(preset)
  await db.repo('equipment').bulkPut(equipment)
  await expect(saveCommanders(db, [
    { name: 'first', presetId: 'p', result }, { name: 'second', presetId: 'p', result },
  ])).rejects.toThrow('重複')
  expect(await db.repo('commanders').count()).toBe(0)
  expect(await db.repo('equipmentAllocations').count()).toBe(0)
})
it('rejects a new build when equipment changed after the preview', async () => {
  const db = new MemoryDatabase()
  await db.repo('presets').put(preset)
  await db.repo('equipment').bulkPut(equipment)
  await db.repo('equipment').put({ ...equipment[0], effects: [{ statId: 'changed', value: 1 }] })
  await expect(saveCommander(db, 'stale', 'p', result, { equipment })).rejects.toThrow('データが変更')
  expect(await db.repo('commanders').count()).toBe(0)
})
it('saves a valid multi-build batch with distinct positions', async () => {
  const db = new MemoryDatabase()
  await db.repo('presets').put(preset)
  await db.repo('equipment').bulkPut([...equipment, ...equipment.map(e => ({ ...e, id: e.id + '2' }))])
  const second = { ...result, equipmentIds: Object.fromEntries(SLOT_TYPES.map(slot => [slot, slot + '2'])) }
  const builds = await saveCommanders(db, [{ name: 'one', presetId: 'p', result }, { name: 'two', presetId: 'p', result: second }])
  expect(builds.map(b => b.position)).toEqual([1, 2])
  expect(await db.repo('equipmentAllocations').count()).toBe(8)
})
