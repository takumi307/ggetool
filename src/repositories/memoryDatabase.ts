import { STORE_KEYS, STORE_NAMES, type Database, type Repository, type StoreName, type StoreSchemas } from './types'

/** テスト・フォールバック用のメモリ実装 */
export class MemoryDatabase implements Database {
  private data = new Map<StoreName, Map<string, unknown>>()
  constructor() { STORE_NAMES.forEach((n) => this.data.set(n, new Map())) }

  repo<K extends StoreName>(name: K): Repository<StoreSchemas[K]> {
    type T = StoreSchemas[K]
    const keyPath = STORE_KEYS[name]
    const m = () => this.data.get(name)!
    const keyOf = (i: T) => String((i as unknown as Record<string, unknown>)[keyPath])
    return {
      getAll: async () => [...m().values()].map((v) => structuredClone(v) as T),
      get: async (k) => { const v = m().get(k); return v === undefined ? undefined : (structuredClone(v) as T) },
      put: async (i) => { m().set(keyOf(i), structuredClone(i)) },
      bulkPut: async (is) => { is.forEach((i) => m().set(keyOf(i), structuredClone(i))) },
      delete: async (k) => { m().delete(k) },
      clear: async () => { m().clear() },
      count: async () => m().size,
    }
  }

  async replaceAll(data: Partial<{ [K in StoreName]: StoreSchemas[K][] }>): Promise<void> {
    const backup = new Map([...this.data].map(([k, v]) => [k, new Map(v)]))
    try {
      for (const name of STORE_NAMES) {
        const items = data[name]
        if (!items) continue
        const keyPath = STORE_KEYS[name]
        const next = new Map<string, unknown>()
        items.forEach((i) => next.set(String((i as unknown as Record<string, unknown>)[keyPath]), structuredClone(i)))
        this.data.set(name, next)
      }
    } catch (e) {
      this.data = backup
      throw e
    }
  }

  close(): void {}
}
