// ドメイン型定義（設計書 §13）。Vue / IndexedDB に依存しない。

export const SLOT_TYPES = ['helmet', 'weapon', 'armor', 'artifact'] as const
export type SlotType = (typeof SLOT_TYPES)[number]

export const SLOT_LABELS: Record<SlotType, string> = {
  helmet: '兜',
  weapon: '武器',
  armor: '鎧',
  artifact: '工芸品',
}

/** 効果1件。value は「ゲーム内表示値」(例: 12.5 = 12.5%) */
export interface EffectEntry {
  statId: string
  value: number
}

export interface Equipment {
  id: string
  name: string
  slotType: SlotType
  /** 3効果または4効果（検証は Phase 2 で実装） */
  effects: EffectEntry[]
  memo: string
  createdAt: string // ISO8601
  updatedAt: string
}

export interface Gem {
  id: string
  name: string
  effects: EffectEntry[]
  /** 装着可能部位。全4部位なら SLOT_TYPES 全て */
  allowedSlots: SlotType[]
  memo: string
  createdAt: string
  updatedAt: string
}

/** equipment=通常装備用, gem=ジェム専用 */
export type StatCategory = 'equipment' | 'gem'

/**
 * known    : cap に数値がある
 * unknown  : 上限未確認（cap=null）。「上限なし」とは区別する
 * disabled : 上限を無効化（管理画面で明示的にOFF）
 */
export type CapStatus = 'known' | 'unknown' | 'disabled'

export interface StatDefinition {
  id: string
  name: string
  category: StatCategory
  cap: number | null
  unit: string
  capStatus: CapStatus
  description: string
}

/** 目標条件 */
export interface BuildTarget {
  statId: string
  /** 最低目標値 */
  minValue: number
}

export interface BuildPreset {
  id: string
  name: string
  targets: BuildTarget[]
  /** 目標以外で高めたい優先ステータス（順序＝優先順位） */
  priorityStats: string[]
  /** 最大化ステータス（順序＝辞書式比較の優先順位。ユーザー変更可） */
  maximizeStats: string[]
  defaultCount: number
  priority: number
  description: string
}

export interface BuildPlan {
  id: string
  presetId: string
  count: number
  priority: number
  enabled: boolean
}

export interface GemAssignment {
  slotType: SlotType
  gemId: string
}

export interface CommanderBuild {
  id: string
  name: string
  presetId: string
  equipmentIds: Partial<Record<SlotType, string>>
  gemAssignments: GemAssignment[]
  /** 保存時点の計算結果スナップショット（Phase 3 で型を精緻化） */
  calculatedStats: Record<string, unknown>
  createdAt: string
}

/** 装備の使用状態の唯一の正（設計書 §13） */
export interface EquipmentAllocation {
  equipmentId: string
  commanderBuildId: string
  slotType: SlotType
  allocatedAt: string
}

/** ジェムの使用状態（装備と同様に一元管理。仮設定: 設計書に型定義がないため追加） */
export interface GemAllocation {
  gemId: string
  commanderBuildId: string
  slotType: SlotType
  allocatedAt: string
}

export interface AppSettings {
  id: 'app'
  schemaVersion: number
  /** 最適化アルゴリズムID（将来の差し替え用） */
  optimizerId: string
}

export const SCHEMA_VERSION = 1
