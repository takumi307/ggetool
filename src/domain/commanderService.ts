import { SLOT_TYPES, type CommanderBuild, type Equipment, type Gem, type SlotType } from './types'
import type { Database } from '@/repositories/types'
import type { OptimizationResult } from './optimizer'

/** Persist build and allocations together; IndexedDB replaceAll uses one transaction. */
export async function saveCommander(db: Database, name: string, presetId: string, result: OptimizationResult): Promise<CommanderBuild> {
  if (!name.trim()) throw Error('司令官名を入力してください')
  if (!await db.repo('presets').get(presetId)) throw Error('プリセットが見つかりません')
  const [equipment, gems, commanders, eqAlloc, gemAlloc] = await Promise.all([
    db.repo('equipment').getAll(), db.repo('gems').getAll(), db.repo('commanders').getAll(),
    db.repo('equipmentAllocations').getAll(), db.repo('gemAllocations').getAll()
  ])
  const chosen = SLOT_TYPES.map(slot => ({ slot, id: result.equipmentIds[slot] }))
  if (chosen.some(v => !v.id)) throw Error('4部位すべての装備が必要です')
  const eqIds = chosen.map(v => v.id as string)
  const gemIds = result.gemAssignments.map(v => v.gemId)
  if (new Set(eqIds).size !== 4 || new Set(gemIds).size !== gemIds.length) throw Error('装備・ジェムの重複使用はできません')
  if (eqIds.some(id => eqAlloc.some(a => a.equipmentId === id)) || gemIds.some(id => gemAlloc.some(a => a.gemId === id))) throw Error('他の司令官が使用中の装備・ジェムがあります。再最適化してください')
  for (const { slot, id } of chosen) if (!equipment.some((e: Equipment) => e.id === id && e.slotType === slot)) throw Error('装備が変更または削除されています')
  for (const a of result.gemAssignments) {
    if (!SLOT_TYPES.includes(a.slotType) || !gems.some((g: Gem) => g.id === a.gemId && g.allowedSlots.includes(a.slotType))) throw Error('ジェムが変更または削除されています')
  }
  if (new Set(result.gemAssignments.map(a => a.slotType)).size !== result.gemAssignments.length) throw Error('同じ部位に複数のジェムは装着できません')
  const id = crypto.randomUUID(), now = new Date().toISOString()
  const equipmentIds = Object.fromEntries(chosen.map(v => [v.slot, v.id])) as Partial<Record<SlotType, string>>
  const build: CommanderBuild = {
    id, name: name.trim(), presetId, equipmentIds, gemAssignments: result.gemAssignments.map(a => ({ ...a })),
    calculatedStats: { ...result.totals, _approximate: result.approximate }, createdAt: now
  }
  await db.replaceAll({
    commanders: [...commanders, build],
    equipmentAllocations: [...eqAlloc, ...chosen.map(v => ({ equipmentId: v.id as string, commanderBuildId: id, slotType: v.slot, allocatedAt: now }))],
    gemAllocations: [...gemAlloc, ...result.gemAssignments.map(a => ({ gemId: a.gemId, commanderBuildId: id, slotType: a.slotType, allocatedAt: now }))]
  })
  return build
}
export async function deleteCommander(db: Database, id: string): Promise<void> {
  const [commanders, eqAlloc, gemAlloc] = await Promise.all([
    db.repo('commanders').getAll(), db.repo('equipmentAllocations').getAll(), db.repo('gemAllocations').getAll()
  ])
  if (!commanders.some(c => c.id === id)) throw Error('司令官が見つかりません')
  await db.replaceAll({
    commanders: commanders.filter(c => c.id !== id),
    equipmentAllocations: eqAlloc.filter(a => a.commanderBuildId !== id),
    gemAllocations: gemAlloc.filter(a => a.commanderBuildId !== id)
  })
}
