import { STORE_KEYS, STORE_NAMES, type Database, type Repository, type StoreName, type StoreSchemas, type StoreSnapshot } from './types'

export const DB_NAME = 'e4k-commander-builder'
/** IndexedDB のスキーマ版（JSONの schemaVersion とは別管理） */
export const DB_VERSION = 1

const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })

const txDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((res, rej) => {
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
    tx.onabort = () => rej(tx.error ?? new Error('transaction aborted'))
  })

export class IndexedDbDatabase implements Database {
  private constructor(private db: IDBDatabase) {}

  static open(name = DB_NAME): Promise<IndexedDbDatabase> {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(name, DB_VERSION)
      r.onupgradeneeded = () => {
        const db = r.result
        for (const s of STORE_NAMES) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: STORE_KEYS[s] })
        }
      }
      r.onsuccess = () => resolve(new IndexedDbDatabase(r.result))
      r.onerror = () => reject(r.error)
      r.onblocked = () => reject(new Error('IndexedDB open blocked'))
    })
  }

  repo<K extends StoreName>(name: K): Repository<StoreSchemas[K]> {
    type T = StoreSchemas[K]
    const os = (mode: IDBTransactionMode) => this.db.transaction(name, mode).objectStore(name)
    return {
      getAll: () => req(os('readonly').getAll() as IDBRequest<T[]>),
      get: (k) => req(os('readonly').get(k) as IDBRequest<T | undefined>),
      put: async (i) => { await req(os('readwrite').put(i)) },
      bulkPut: async (items) => {
        const tx = this.db.transaction(name, 'readwrite')
        items.forEach((i) => tx.objectStore(name).put(i))
        await txDone(tx)
      },
      delete: async (k) => { await req(os('readwrite').delete(k)) },
      clear: async () => { await req(os('readwrite').clear()) },
      count: () => req(os('readonly').count()),
    }
  }

  /** 1トランザクションで置換。途中失敗は abort で全体ロールバック（既存データを壊さない） */
  async replaceAll(data: StoreSnapshot, expected?: StoreSnapshot): Promise<void> {
    const targets = STORE_NAMES.filter(n => data[n])
    if (!targets.length) return
    const checks = STORE_NAMES.filter(n => expected?.[n])
    const tx = this.db.transaction([...new Set([...targets, ...checks])], 'readwrite')
    const done = txDone(tx)
    try {
      const current = await Promise.all(checks.map(n => req(tx.objectStore(n).getAll())))
      if (checks.some((n, i) => JSON.stringify(current[i]) !== JSON.stringify(expected?.[n]))) {
        throw Error('保存中にデータが変更されました。最新の状態で再実行してください')
      }
      for (const n of targets) {
        const os = tx.objectStore(n)
        os.clear()
        for (const item of data[n] as unknown[]) os.put(item)
      }
    } catch (e) {
      tx.abort()
      await done.catch(() => {})
      throw e
    }
    await done
  }

  close(): void { this.db.close() }
}
