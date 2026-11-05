import type {
  AppSettings, BuildPlan, BuildPreset, CommanderBuild, Equipment,
  EquipmentAllocation, Gem, GemAllocation, StatDefinition,
} from '@/domain'

/** ストア名 → 型 */
export interface StoreSchemas {
  equipment: Equipment
  gems: Gem
  stats: StatDefinition
  presets: BuildPreset
  plans: BuildPlan
  commanders: CommanderBuild
  equipmentAllocations: EquipmentAllocation
  gemAllocations: GemAllocation
  settings: AppSettings
}
export type StoreName = keyof StoreSchemas

/** 各ストアの keyPath */
export const STORE_KEYS: Record<StoreName, string> = {
  equipment: 'id',
  gems: 'id',
  stats: 'id',
  presets: 'id',
  plans: 'id',
  commanders: 'id',
  equipmentAllocations: 'equipmentId',
  gemAllocations: 'gemId',
  settings: 'id',
}
export const STORE_NAMES = Object.keys(STORE_KEYS) as StoreName[]

export interface Repository<T> {
  getAll(): Promise<T[]>
  get(key: string): Promise<T | undefined>
  put(item: T): Promise<void>
  bulkPut(items: T[]): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  count(): Promise<number>
}

/** UI/ストアはこのインターフェースだけに依存する（IndexedDB実装は差し替え可能） */
export interface Database {
  repo<K extends StoreName>(name: K): Repository<StoreSchemas[K]>
  /** 指定ストアを一括置換（Phase 2 のJSON復元で使用。失敗時は全体ロールバック） */
  replaceAll(data: Partial<{ [K in StoreName]: StoreSchemas[K][] }>): Promise<void>
  close(): void
}
