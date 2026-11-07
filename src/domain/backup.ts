import { SCHEMA_VERSION, SLOT_TYPES, type Equipment, type Gem, type StatDefinition } from './types'
import { STORE_NAMES, STORE_KEYS, type Database, type StoreName, type StoreSchemas } from '@/repositories/types'
import { mergeCastellanStats } from './castellanStats'
import { WORKSPACE_LABELS, type BuildWorkspace } from './workspace'
import { validateEquipment, validateGem, validateStat } from './validation'

export type BackupData = {
  schemaVersion: number
  workspace?: BuildWorkspace
  exportedAt: string
  stores: { [K in StoreName]: StoreSchemas[K][] }
}
const record = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
export async function exportBackup(db: Database, workspace: BuildWorkspace = 'commander'): Promise<BackupData> {
  const stores = {} as BackupData['stores']
  for (const name of STORE_NAMES) (stores as unknown as Record<string, unknown>)[name] = await db.repo(name).getAll()
  return { schemaVersion: SCHEMA_VERSION, ...(workspace === 'castellan' ? { workspace } : {}), exportedAt: new Date().toISOString(), stores }
}
export function parseBackup(text: string, workspace: BuildWorkspace = 'commander'): BackupData {
  const raw: unknown = JSON.parse(text)
  if (!record(raw) || raw.schemaVersion !== SCHEMA_VERSION || !record(raw.stores)) throw Error('非対応のバックアップ形式・バージョンです')
  if (raw.workspace !== undefined && raw.workspace !== 'commander' && raw.workspace !== 'castellan') throw Error('バックアップの種類が不正です')
  const sourceWorkspace = raw.workspace ?? 'commander'
  if (sourceWorkspace !== workspace) throw Error(WORKSPACE_LABELS[sourceWorkspace] + 'タブでこのバックアップを復元してください')
  const stores = raw.stores
  for (const name of STORE_NAMES) {
    const rows = stores[name]
    if (!Array.isArray(rows)) throw Error(name + ' が配列ではありません')
    const seen = new Set<string>()
    for (const item of rows) {
      if (!record(item) || typeof item[STORE_KEYS[name]] !== 'string' || !item[STORE_KEYS[name]]) throw Error(name + ' に不正なIDがあります')
      const id = item[STORE_KEYS[name]] as string
      if (seen.has(id)) throw Error(name + ' に重複IDがあります')
      seen.add(id)
    }
  }
  const stats = stores.stats as StatDefinition[]
  for (const stat of stats) if (validateStat(stat)) throw Error('ステータス定義に不正なデータがあります')
  for (const item of stores.equipment as Equipment[]) {
    if (!Array.isArray(item.effects) || validateEquipment(item, stats)) throw Error('装備のデータが不正です')
  }
  for (const item of stores.gems as Gem[]) {
    if (!Array.isArray(item.effects) || !Array.isArray(item.allowedSlots) || validateGem(item, stats)) throw Error('ジェムのデータが不正です')
  }
  const keys = (name: StoreName, key = 'id') => new Set((stores[name] as Record<string, unknown>[]).map(v => String(v[key])))
  const statIds = keys('stats'), eqIds = keys('equipment'), gemIds = keys('gems')
  const presetIds = keys('presets'), commanderIds = keys('commanders')
  for (const p of stores.presets as StoreSchemas['presets'][]) {
    if (p.castellanObjective !== undefined && (workspace !== 'castellan' || !['general', 'npc', 'lord'].includes(p.castellanObjective))) throw Error('城代の最適化方針が不正です')
    if (!Array.isArray(p.targets) || !Array.isArray(p.priorityStats) || !Array.isArray(p.maximizeStats)) throw Error('プリセットが不正です')
    if (p.targets.some(v => !statIds.has(v.statId) || !Number.isFinite(v.minValue)) || [...p.priorityStats, ...p.maximizeStats].some(id => !statIds.has(id))) throw Error('プリセットに不正な効果参照があります')
  }
  for (const plan of stores.plans as StoreSchemas['plans'][]) if (!presetIds.has(plan.presetId)) throw Error('作成計画に不正な参照があります')
  for (const commander of stores.commanders as StoreSchemas['commanders'][]) {
    if (!presetIds.has(commander.presetId) || !record(commander.equipmentIds) || !Array.isArray(commander.gemAssignments)) throw Error('司令官が不正です')
    if (Object.values(commander.equipmentIds).some(id => typeof id !== 'string' || !eqIds.has(id))) throw Error('司令官の装備参照が不正です')
    if (commander.gemAssignments.some(a => !gemIds.has(a.gemId) || !SLOT_TYPES.includes(a.slotType))) throw Error('司令官のジェム参照が不正です')
  }
  for (const a of stores.equipmentAllocations as StoreSchemas['equipmentAllocations'][]) if (!eqIds.has(a.equipmentId) || !commanderIds.has(a.commanderBuildId)) throw Error('装備割当が不正です')
  for (const a of stores.gemAllocations as StoreSchemas['gemAllocations'][]) if (!gemIds.has(a.gemId) || !commanderIds.has(a.commanderBuildId)) throw Error('ジェム割当が不正です')
  if ((stores.settings as StoreSchemas['settings'][]).some(s => s.id !== 'app')) throw Error('アプリ設定IDが不正です')
  return raw as unknown as BackupData
}
export async function importBackup(db: Database, backup: BackupData): Promise<void> {
  // 全ストアを単一トランザクションで置換。失敗時には既存データを維持する
  // Vue ref() wraps the parsed backup in reactive Proxies. IndexedDB cannot
  // structured-clone Proxy objects, so detach the JSON data before put().
  // JSON backup data is intentionally JSON-serializable; this also detaches
  // nested arrays/objects while preserving the single-transaction rollback.
  const plainStores = JSON.parse(JSON.stringify(backup.stores)) as BackupData['stores']
  if (backup.workspace === 'castellan') plainStores.stats = mergeCastellanStats(plainStores.stats)
  await db.replaceAll(plainStores)
}
