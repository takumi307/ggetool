import { defineStore } from 'pinia'
import { SCHEMA_VERSION, STAT_SEEDS } from '@/domain'
import { openDatabase, type Database } from '@/repositories'

let database: Database | null = null
/** Repository への参照口。各ストアはここ経由でDBに触れる */
export function useDb(): Database {
  if (!database) throw new Error('Database is not initialized')
  return database
}

export const useAppStore = defineStore('app', {
  state: () => ({
    ready: false,
    persistent: false,
    error: '' as string,
    counts: { equipment: 0, gems: 0, stats: 0, presets: 0, plans: 0, commanders: 0 },
  }),
  actions: {
    async init() {
      const r = await openDatabase()
      database = r.db
      this.persistent = r.persistent
      this.error = r.error ?? ''
      await seedIfEmpty(r.db)
      await this.refreshCounts()
      this.ready = true
    },
    async refreshCounts() {
      const db = useDb()
      for (const k of Object.keys(this.counts) as (keyof typeof this.counts)[]) {
        this.counts[k] = await db.repo(k).count()
      }
    },
  },
})

/** 初回起動時のみ初期データ投入（既存データは上書きしない） */
export async function seedIfEmpty(db: Database): Promise<void> {
  if ((await db.repo('stats').count()) === 0) await db.repo('stats').bulkPut(STAT_SEEDS)
  if (!(await db.repo('settings').get('app'))) {
    await db.repo('settings').put({ id: 'app', schemaVersion: SCHEMA_VERSION, optimizerId: 'default' })
  }
}
