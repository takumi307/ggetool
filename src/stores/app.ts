import { defineStore } from 'pinia'
import { SCHEMA_VERSION, STAT_SEEDS } from '@/domain'
import { CASTELLAN_STAT_SEEDS } from '@/domain/castellanStats'
import { WORKSPACE_LABELS, type BuildWorkspace } from '@/domain/workspace'
import { openDatabase, type Database } from '@/repositories'

const databases = new Map<BuildWorkspace, Awaited<ReturnType<typeof openDatabase>>>()
let database: Database | null = null
/** Repository への参照口。各ストアはここ経由でDBに触れる */
export function useDb(): Database {
  if (!database) throw new Error('Database is not initialized')
  return database
}

export const useAppStore = defineStore('app', {
  state: () => ({
    ready: false,
    workspace: 'commander' as BuildWorkspace,
    persistent: false,
    error: '' as string,
    counts: { equipment: 0, gems: 0, stats: 0, presets: 0, plans: 0, commanders: 0 },
  }),
  getters: {
    roleLabel: state => WORKSPACE_LABELS[state.workspace],
  },
  actions: {
    async init(workspace: BuildWorkspace = 'commander') {
      this.ready = false
      const cached = databases.get(workspace)
      const result = cached ?? await openDatabase(workspace === 'castellan' ? 'e4k-castellan-builder' : undefined)
      await seedIfEmpty(result.db, workspace)
      databases.set(workspace, result)
      database = result.db
      this.workspace = workspace
      this.persistent = result.persistent
      this.error = result.error ?? ''
      await this.refreshCounts(result.db)
      this.ready = true
    },
    async refreshCounts(db = useDb()) {
      const keys = Object.keys(this.counts) as (keyof typeof this.counts)[]
      const counts = await Promise.all(keys.map(key => db.repo(key).count()))
      if (db === database) keys.forEach((key, index) => { this.counts[key] = counts[index] })
    },
  },
})

/** 初回起動時のみ初期データ投入（既存データは上書きしない） */
export async function seedIfEmpty(db: Database, workspace: BuildWorkspace = 'commander'): Promise<void> {
  // Add only missing built-in effects, preserving all existing user data.
  const existing = new Set((await db.repo('stats').getAll()).map(s => s.id))
  const seeds = workspace === 'castellan' ? CASTELLAN_STAT_SEEDS : STAT_SEEDS
  const missing = seeds.filter(s => !existing.has(s.id))
  if (missing.length) await db.repo('stats').bulkPut(missing)
  if (!(await db.repo('settings').get('app'))) {
    await db.repo('settings').put({ id: 'app', schemaVersion: SCHEMA_VERSION, optimizerId: 'default' })
  }
}
