import type { Database } from './types'
import { IndexedDbDatabase } from './indexedDbDatabase'
import { MemoryDatabase } from './memoryDatabase'

export * from './types'
export { IndexedDbDatabase, MemoryDatabase }

export interface OpenResult { db: Database; persistent: boolean; error?: string }

/** IndexedDBが使えない環境（プライベートモード等）ではメモリにフォールバックし、persistent=false で通知 */
export async function openDatabase(name?: string): Promise<OpenResult> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available')
    return { db: await IndexedDbDatabase.open(name), persistent: true }
  } catch (e) {
    return { db: new MemoryDatabase(), persistent: false, error: e instanceof Error ? e.message : String(e) }
  }
}
