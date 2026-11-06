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
  const usedPositions = new Set(commanders.map(c => commanderNumber(c, commanders)).filter((n): n is number => n !== undefined))
  const position = Array.from({length:35}, (_,i)=>i+1).find(n=>!usedPositions.has(n))
  if (!position) throw Error('司令官は35体までです。空き番号がありません')
  const id = crypto.randomUUID(), now = new Date().toISOString()
  const equipmentIds = Object.fromEntries(chosen.map(v => [v.slot, v.id])) as Partial<Record<SlotType, string>>
  const build: CommanderBuild = {
    id, position, name: name.trim(), presetId, equipmentIds, gemAssignments: result.gemAssignments.map(a => ({ ...a })),
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

/** Stable physical position on the game's 1–35 commander roster. */
export function commanderNumber(build: CommanderBuild, all: CommanderBuild[]): number | undefined {
  if (Number.isInteger(build.position) && build.position! >= 1 && build.position! <= 35) return build.position
  const taken = new Set(all.map(b => b.position).filter((n): n is number => Number.isInteger(n) && n! >= 1 && n! <= 35))
  const legacy = [...all].filter(b => !b.position).sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  for (const b of legacy) {
    const next = Array.from({ length: 35 }, (_,i) => i + 1).find(n => !taken.has(n))
    if (!next) break
    if (b.id === build.id) return next
    taken.add(next)
  }
  return undefined
}

export async function setCommanderPosition(db: Database, id: string, position: number): Promise<void> {
  if (!Number.isInteger(position) || position < 1 || position > 35) throw Error('司令官番号は1〜35で指定してください')
  const builds = await db.repo('commanders').getAll()
  const build = builds.find(b => b.id === id)
  if (!build) throw Error('司令官が見つかりません')
  if (builds.some(b => b.id !== id && commanderNumber(b, builds) === position)) throw Error('この番号は別の司令官が使用中です')
  await db.repo('commanders').put({ ...build, position })
}
export async function setCommanderLocked(db: Database, id: string, locked: boolean): Promise<void> {
  const build = await db.repo('commanders').get(id)
  if (!build) throw Error('司令官が見つかりません')
  await db.repo('commanders').put({ ...build, locked })
}

export interface ReplacementBuild {
  commanderId: string
  equipmentIds: Partial<Record<SlotType, string>>
  gemAssignments: { slotType: SlotType; gemId: string }[]
  calculatedStats: Record<string, unknown>
  expectedEquipmentIds: Partial<Record<SlotType, string>>
  expectedGemAssignments: { slotType: SlotType; gemId: string }[]
}
/** One IndexedDB transaction replaces all affected allocations or none.
 * Reject stale previews, locked commanders, and every conflicting item. */
export async function replaceCommanderAssignments(db: Database, replacements: ReplacementBuild[]): Promise<void> {
  if (!replacements.length) throw Error('保存する変更がありません')
  const [builds, equipment, gems, eqAlloc, gemAlloc] = await Promise.all([
    db.repo('commanders').getAll(), db.repo('equipment').getAll(), db.repo('gems').getAll(),
    db.repo('equipmentAllocations').getAll(), db.repo('gemAllocations').getAll()
  ])
  const ids = new Set(replacements.map(r => r.commanderId))
  if (ids.size !== replacements.length) throw Error('司令官が重複しています')
  const eqById = new Map(equipment.map(e => [e.id,e]))
  const gemById = new Map(gems.map(g => [g.id,g]))
  const usedEq = new Set(eqAlloc.filter(a => !ids.has(a.commanderBuildId)).map(a => a.equipmentId))
  const usedGem = new Set(gemAlloc.filter(a => !ids.has(a.commanderBuildId)).map(a => a.gemId))
  const updated = new Map<string, CommanderBuild>()
  const newEq: typeof eqAlloc = [], newGem: typeof gemAlloc = []
  const now = new Date().toISOString()
  for (const r of replacements) {
    const old = builds.find(b => b.id === r.commanderId)
    if (!old || old.locked) throw Error('対象司令官が見つからないか、ロックされています')
    if (JSON.stringify(old.equipmentIds) !== JSON.stringify(r.expectedEquipmentIds) ||
        JSON.stringify([...old.gemAssignments].sort((a,b)=>a.slotType.localeCompare(b.slotType))) !== JSON.stringify([...r.expectedGemAssignments].sort((a,b)=>a.slotType.localeCompare(b.slotType))))
      throw Error('最適化後に司令官の構成が変更されました。再実行してください')
    for (const slot of SLOT_TYPES) {
      const id = r.equipmentIds[slot]
      if (!id || eqById.get(id)?.slotType !== slot || usedEq.has(id)) throw Error('装備の重複または部位不一致：' + slot)
      usedEq.add(id)
      newEq.push({ equipmentId: id, commanderBuildId: old.id, slotType: slot, allocatedAt: now })
    }
    const seenSlots = new Set<SlotType>()
    for (const a of r.gemAssignments) {
      if (seenSlots.has(a.slotType) || !gemById.get(a.gemId)?.allowedSlots.includes(a.slotType) || usedGem.has(a.gemId)) throw Error('ジェムの重複または部位不一致')
      seenSlots.add(a.slotType); usedGem.add(a.gemId)
      newGem.push({ gemId: a.gemId, commanderBuildId: old.id, slotType: a.slotType, allocatedAt: now })
    }
    updated.set(old.id, { ...old, equipmentIds: { ...r.equipmentIds }, gemAssignments: r.gemAssignments.map(a => ({ ...a })), calculatedStats: { ...r.calculatedStats } })
  }
  // Stale preview protection: items owned by a target must still match its
  // original allocation before a replacement can commit.
  for (const old of builds.filter(b => ids.has(b.id))) {
    const expectedEq = Object.values(old.equipmentIds).filter(Boolean).sort()
    const currentEq = eqAlloc.filter(a => a.commanderBuildId === old.id).map(a => a.equipmentId).sort()
    const expectedGem = old.gemAssignments.map(a => a.gemId).sort()
    const currentGem = gemAlloc.filter(a => a.commanderBuildId === old.id).map(a => a.gemId).sort()
    if (JSON.stringify(expectedEq) !== JSON.stringify(currentEq) || JSON.stringify(expectedGem) !== JSON.stringify(currentGem))
      throw Error('装備の割当が変更されました。再度最適化してください')
  }
  await db.replaceAll({
    commanders: builds.map(b => updated.get(b.id) ?? b),
    equipmentAllocations: [...eqAlloc.filter(a => !ids.has(a.commanderBuildId)), ...newEq],
    gemAllocations: [...gemAlloc.filter(a => !ids.has(a.commanderBuildId)), ...newGem]
  })
}
