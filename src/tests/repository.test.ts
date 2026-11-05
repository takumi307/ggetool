import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { IndexedDbDatabase, MemoryDatabase, type Database } from '@/repositories'
import { seedIfEmpty } from '@/stores/app'
import { STAT_SEEDS, type Equipment } from '@/domain'

const eqp = (id: string): Equipment => ({
  id, name: id, slotType: 'helmet', effects: [{ statId: 'S001', value: 10 }],
  memo: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
})

const impls: [string, () => Promise<Database>][] = [
  ['memory', async () => new MemoryDatabase()],
  ['indexeddb', async () => IndexedDbDatabase.open('test-' + Math.random())],
]

describe.each(impls)('Database (%s)', (_n, make) => {
  it('put/get/getAll/delete/count', async () => {
    const db = await make()
    const r = db.repo('equipment')
    await r.put(eqp('a'))
    await r.bulkPut([eqp('b'), eqp('c')])
    expect(await r.count()).toBe(3)
    expect((await r.get('b'))?.id).toBe('b')
    await r.delete('b')
    expect((await r.getAll()).map((e) => e.id).sort()).toEqual(['a', 'c'])
  })
  it('replaceAll は指定ストアのみ置換する', async () => {
    const db = await make()
    await db.repo('equipment').put(eqp('old'))
    await db.repo('gems').put({ id: 'g', name: 'g', effects: [], allowedSlots: [], memo: '', createdAt: '', updatedAt: '' })
    await db.replaceAll({ equipment: [eqp('new')] })
    expect((await db.repo('equipment').getAll()).map((e) => e.id)).toEqual(['new'])
    expect(await db.repo('gems').count()).toBe(1)
  })
  it('seedIfEmpty は初回のみ投入し、既存の上限編集を上書きしない', async () => {
    const db = await make()
    await seedIfEmpty(db)
    expect(await db.repo('stats').count()).toBe(STAT_SEEDS.length)
    const s = (await db.repo('stats').get('S001'))!
    await db.repo('stats').put({ ...s, cap: 150 })
    await seedIfEmpty(db)
    expect((await db.repo('stats').get('S001'))!.cap).toBe(150)
  })
})
