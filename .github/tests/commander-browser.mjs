import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const slots = ['helmet', 'weapon', 'armor', 'artifact']
const at = '2026-11-07T00:00:00Z'
const makeStat = (id, category) => ({ id, name: id, category, cap: null, unit: '%', capStatus: 'unknown', description: '' })
const makeGear = (owner, slot, power) => ({
  id: owner + '-' + slot, name: owner + '-' + slot, slotType: slot,
  effects: [
    { statId: 'test-power', value: power },
    { statId: 'test-other-a', value: 0 },
    { statId: 'test-other-b', value: 0 },
  ],
  memo: '', createdAt: at, updatedAt: at,
})
const commanders = ['locked', 'unlocked-a', 'unlocked-b'].map((id, index) => ({
  id, position: index + 1, locked: index === 0, name: '検証-' + id,
  presetId: 'test-preset',
  equipmentIds: Object.fromEntries(slots.map(slot => [slot, id + '-' + slot])),
  gemAssignments: [{ slotType: 'weapon', gemId: id + '-gem' }],
  calculatedStats: {}, createdAt: at,
}))
const fixture = {
  schemaVersion: 1,
  exportedAt: at,
  stores: {
    equipment: [
      ...commanders.flatMap(c => slots.map(slot => makeGear(c.id, slot, slot === 'helmet' ? (c.locked ? 80 : 5) : 0))),
      makeGear('upgrade-a', 'helmet', 30),
      makeGear('upgrade-b', 'helmet', 40),
    ],
    gems: commanders.map(c => ({
      id: c.id + '-gem', name: c.id + '-gem', effects: [{ statId: 'test-gem', value: 1 }],
      allowedSlots: ['helmet', 'weapon'], memo: '', createdAt: at, updatedAt: at,
    })),
    stats: [
      ...['test-power', 'test-other-a', 'test-other-b'].map(id => makeStat(id, 'equipment')),
      makeStat('test-gem', 'gem'),
    ],
    presets: [{
      id: 'test-preset', name: '検証プリセット', targets: [{ statId: 'test-power', minValue: 25 }],
      priorityStats: [], maximizeStats: [], defaultCount: 3, priority: 1, description: '',
    }],
    plans: [],
    commanders,
    equipmentAllocations: commanders.flatMap(c => slots.map(slotType => ({
      slotType, equipmentId: c.equipmentIds[slotType], commanderBuildId: c.id, allocatedAt: at,
    }))),
    gemAllocations: commanders.map(c => ({ ...c.gemAssignments[0], commanderBuildId: c.id, allocatedAt: at })),
    settings: [],
  },
}
const browser = await chromium.launch()
const page = await browser.newPage()
page.setDefaultTimeout(12000)
try {
  const root = 'http://127.0.0.1:4173'
  const link = name => page.getByText(name, { exact: true })
  const button = name => page.getByRole('button', { name, exact: true })
  const select = name => page.getByRole('combobox', { name, exact: true })
  const option = name => page.getByRole('option', { name, exact: true })
  const card = name => page.locator('.v-card').filter({ has: link(name) })
  const visible = locator => locator.waitFor({ state: 'visible' })

  await page.goto(root + '/#/')
  await visible(page.getByRole('heading', { name: 'ダッシュボード', exact: true }))
  await link('鎧を登録').click()
  await page.waitForURL(root + '/#/equipment/edit?slot=armor')
  await visible(page.getByRole('combobox', { name: '装備部位', exact: true }))
  assert.equal(await page.getByRole('combobox', { name: '装備部位', exact: true }).inputValue(), '鎧')

  await page.goto(root + '/#/backup')
  await page.locator('input[type=file]').setInputFiles({
    name: 'reoptimization-fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  })
  page.once('dialog', dialog => dialog.accept())
  await button('確認して全件置換').click()
  await visible(link('復元しました'))

  await link('最適化実行').click()
  await select('最適化モード').press('ArrowDown')
  await option('指定司令官を再最適化').click()
  await select('再最適化する司令官（複数選択）').press('ArrowDown')
  await visible(option('司令官 2：検証-unlocked-a'))
  await visible(option('司令官 3：検証-unlocked-b'))
  assert.equal(await option('司令官 1：検証-locked').count(), 0)
  await select('再最適化する司令官（複数選択）').press('Escape')
  await select('最適化モード').press('ArrowDown')
  await option('司令官全体を再最適化（ロック中は除外）').click()
  await button('CP-SATで再最適化').click()
  await visible(link('CP-SAT最適化結果（2体）'))
  await visible(page.getByText('現在の構成から変更する装備・ジェム：2箇所。', { exact: false }))
  await button('全2体を安全に一括更新').click()
  await visible(page.getByText('2体を一括更新しました', { exact: false }))

  await link('保存済み司令官を確認').click()
  await page.waitForURL(root + '/#/commanders')
  await visible(page.getByRole('heading', { name: '保存済み司令官', exact: true }))
  await page.reload()
  await visible(card('検証-locked').getByText('ロック中', { exact: true }))
  await visible(card('検証-locked').getByText(/兜：locked-helmet/))
  await visible(card('検証-locked').getByText(/ジェム：locked-gem/))
  const helmets = []
  for (const id of ['unlocked-a', 'unlocked-b']) {
    const commander = card('検証-' + id)
    const helmet = commander.getByText(/兜：upgrade-[ab]-helmet/)
    await visible(helmet)
    helmets.push((await helmet.innerText()).match(/upgrade-[ab]-helmet/)[0])
    await visible(commander.getByText('ジェム：' + id + '-gem', { exact: false }))
  }
  assert.deepEqual(helmets.sort(), ['upgrade-a-helmet', 'upgrade-b-helmet'])
  console.log('Browser reoptimization, atomic save, and persistence verified')

  const tab = name => page.getByRole('tab', { name, exact: true })
  const heading = name => page.getByRole('heading', { name, exact: true })
  const selectBackup = data => page.locator('input[type=file]').setInputFiles({
    name: 'workspace-fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  })

  await tab('城代').click()
  await visible(heading('保存済み城代'))
  assert.equal(await card('検証-locked').count(), 0)
  await link('ビルドプリセット').click()
  await button('標準プリセットを追加').click()
  await visible(link('防御バランス（例）'))

  await link('バックアップ・復元').click()
  await selectBackup(fixture)
  await visible(link('Error: 司令官タブでこのバックアップを復元してください'))
  assert.equal(await button('確認して全件置換').count(), 0)

  const defenseStat = { ...makeStat('C001', 'equipment'), name: '防御時の乱闘兵の戦闘力', capStatus: 'known', cap: 35 }
  const defenseGemStat = { ...makeStat('CG001', 'gem'), name: '防御時の乱闘兵の戦闘力（ジェム）' }
  const castellanFixture = {
    ...fixture, workspace: 'castellan',
    stores: {
      ...fixture.stores,
      equipment: slots.map(slot => ({
        ...makeGear('defense', slot, 10),
        effects: ['C001', 'test-other-a', 'test-other-b'].map((statId, i) => ({ statId, value: i ? 0 : 10 })),
      })),
      gems: [{
        ...fixture.stores.gems[0], id: 'defense-gem', name: 'defense-gem',
        effects: [{ statId: 'CG001', value: 15 }],
      }],
      stats: [...fixture.stores.stats, defenseStat, defenseGemStat],
      presets: [{
        ...fixture.stores.presets[0], name: '城代検証', targets: [{ statId: 'C001', minValue: 50 }],
      }],
      plans: [{ id: 'castellan-plan', presetId: 'test-preset', count: 2, priority: 1, enabled: true }],
      commanders: [], equipmentAllocations: [], gemAllocations: [],
    },
  }
  await selectBackup(castellanFixture)
  page.once('dialog', dialog => dialog.accept())
  await button('確認して全件置換').click()
  await visible(link('復元しました'))
  await link('最適化実行').click()
  await visible(heading('城代の最適化'))
  await visible(button('CP-SATで新規作成'))
  await select('最適化モード').press('ArrowDown')
  await option('1体だけ作る').click()
  await visible(link('防御時の乱闘兵の戦闘力：50%以上'))
  const workerStarted = page.waitForEvent('worker')
  await button('最適化を実行').click()
  await workerStarted
  await visible(page.getByText('防御時の乱闘兵の戦闘力：50 / 50', { exact: false }))
  await page.getByRole('textbox', { name: '城代名', exact: true }).fill('検証城代')
  await button('この構成を保存して装備を確保').click()
  await visible(page.getByText('「検証城代」を保存しました', { exact: false }))
  await link('保存済み城代を確認').click()
  await visible(heading('保存済み城代'))
  await page.reload()
  const castellanCard = card('検証城代')
  await visible(castellanCard.getByText(/兜：defense-helmet/))
  await castellanCard.getByText('結果の詳細', { exact: true }).click()
  await visible(heading('最適化結果'))
  await visible(page.getByText('防御時の乱闘兵の戦闘力：50 / 50', { exact: false }))
  await tab('司令官').click()
  await visible(heading('最適化結果'))
  await link('保存済み司令官').click()
  await visible(heading('保存済み司令官'))
  await visible(card('検証-locked').getByText(/兜：locked-helmet/))
  assert.equal(await card('検証城代').count(), 0)
  console.log('Castellan optimization and independent saves verified')
} catch (error) {
  console.error(await page.locator('body').innerText())
  throw error
} finally {
  await browser.close()
}
