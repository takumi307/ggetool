import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const fixture = {
  "schemaVersion": 1,
  "exportedAt": "2026-11-07T00:00:00Z",
  "stores": {
    "equipment": [
      {
        "id": "locked-helmet",
        "name": "locked-helmet",
        "slotType": "helmet",
        "effects": [
          {
            "statId": "test-power",
            "value": 80
          },
          {
            "statId": "test-other-a",
            "value": 0
          },
          {
            "statId": "test-other-b",
            "value": 0
          }
        ],
        "memo": "",
        "createdAt": "2026-11-07T00:00:00Z",
        "updatedAt": "2026-11-07T00:00:00Z"
      },
      {
        "id": "locked-weapon",
        "name": "locked-weapon",
        "slotType": "weapon",
        "effects": [
          {
            "statId": "test-power",
            "value": 0
          },
          {
            "statId": "test-other-a",
            "value": 0
          },
          {
            "statId": "test-other-b",
            "value": 0
          }
        ],
        "memo": "",
        "createdAt": "2026-11-07T00:00:00Z",
        "updatedAt": "2026-11-07T00:00:00Z"
      },
      {
        "id": "locked-armor",
        "name": "locked-armor",
        "slotType": "armor",
        "effects": [
          {
            "statId": "test-power",
            "value": 0
          },
          {
            "statId": "test-other-a",
            "value": 0
          },
          {
            "statId": "test-other-b",
            "value": 0
          }
        ],
        "memo": "",
        "createdAt": "2026-11-07T00:00:00Z",
        "updatedAt": "2026-11-07T00:00:00Z"
      },
      {
        "id": "locked-artifact",
        "name": "locked-artifact",
        "slotType": "artifact",
        "effects": [
          {
            "statId": "test-power",
            "value": 0
          },
          {
            "statId": "test-other-a",
            "value": 0
          },
          {
            "statId": "test-other-b",
            "value": 0
          }
        ],
        "memo": "",
        "createdAt": "2026-11-07T00:00:00Z",
        "updatedAt": "2026-11-07T00:00:00Z"
      },
      {
        "id": "unlocked-helmet",
        "name": "unlocked-helmet",
        "slotType": "helmet",
        "effects": [
          {
            "statId": "test-power",
            "value": 5
          },
          {
            "statId": "test-other-a",
            "value": 0
          },
          {
            "statId": "test-other-b",
            "value": 0
          }
        ],
        "memo": "",
        "createdAt": "2026-11-07T00:00:00Z",
        "updatedAt": "2026-11-07T00:00:00Z"
      },
      {
        "id": "unlocked-weapon",
        "name": "unlocked-weapon",
        "slotType": "weapon",
        "effects": [
          {
            "statId": "test-power",
            "value": 0
          },
          {
            "statId": "test-other-a",
            "value": 0
          },
          {
            "statId": "test-other-b",
            "value": 0
          }
        ],
        "memo": "",
        "createdAt": "2026-11-07T00:00:00Z",
        "updatedAt": "2026-11-07T00:00:00Z"
      },
      {
        "id": "unlocked-armor",
        "name": "unlocked-armor",
        "slotType": "armor",
        "effects": [
          {
            "statId": "test-power",
            "value": 0
          },
          {
            "statId": "test-other-a",
            "value": 0
          },
          {
            "statId": "test-other-b",
            "value": 0
          }
        ],
        "memo": "",
        "createdAt": "2026-11-07T00:00:00Z",
        "updatedAt": "2026-11-07T00:00:00Z"
      },
      {
        "id": "unlocked-artifact",
        "name": "unlocked-artifact",
        "slotType": "artifact",
        "effects": [
          {
            "statId": "test-power",
            "value": 0
          },
          {
            "statId": "test-other-a",
            "value": 0
          },
          {
            "statId": "test-other-b",
            "value": 0
          }
        ],
        "memo": "",
        "createdAt": "2026-11-07T00:00:00Z",
        "updatedAt": "2026-11-07T00:00:00Z"
      },
      {
        "id": "upgrade-helmet",
        "name": "upgrade-helmet",
        "slotType": "helmet",
        "effects": [
          {
            "statId": "test-power",
            "value": 30
          },
          {
            "statId": "test-other-a",
            "value": 0
          },
          {
            "statId": "test-other-b",
            "value": 0
          }
        ],
        "memo": "",
        "createdAt": "2026-11-07T00:00:00Z",
        "updatedAt": "2026-11-07T00:00:00Z"
      }
    ],
    "gems": [
      {
        "id": "locked-gem",
        "name": "locked-gem",
        "effects": [
          {
            "statId": "test-gem",
            "value": 1
          }
        ],
        "allowedSlots": [
          "helmet",
          "weapon"
        ],
        "memo": "",
        "createdAt": "2026-11-07T00:00:00Z",
        "updatedAt": "2026-11-07T00:00:00Z"
      },
      {
        "id": "unlocked-gem",
        "name": "unlocked-gem",
        "effects": [
          {
            "statId": "test-gem",
            "value": 1
          }
        ],
        "allowedSlots": [
          "helmet",
          "weapon"
        ],
        "memo": "",
        "createdAt": "2026-11-07T00:00:00Z",
        "updatedAt": "2026-11-07T00:00:00Z"
      }
    ],
    "stats": [
      {
        "id": "test-power",
        "name": "test-power",
        "category": "equipment",
        "cap": null,
        "unit": "%",
        "capStatus": "unknown",
        "description": ""
      },
      {
        "id": "test-other-a",
        "name": "test-other-a",
        "category": "equipment",
        "cap": null,
        "unit": "%",
        "capStatus": "unknown",
        "description": ""
      },
      {
        "id": "test-other-b",
        "name": "test-other-b",
        "category": "equipment",
        "cap": null,
        "unit": "%",
        "capStatus": "unknown",
        "description": ""
      },
      {
        "id": "test-gem",
        "name": "test-gem",
        "category": "gem",
        "cap": null,
        "unit": "%",
        "capStatus": "unknown",
        "description": ""
      }
    ],
    "presets": [
      {
        "id": "test-preset",
        "name": "検証プリセット",
        "targets": [
          {
            "statId": "test-power",
            "minValue": 25
          }
        ],
        "priorityStats": [],
        "maximizeStats": [],
        "defaultCount": 2,
        "priority": 1,
        "description": ""
      }
    ],
    "plans": [],
    "commanders": [
      {
        "id": "locked",
        "position": 1,
        "locked": true,
        "name": "検証-locked",
        "presetId": "test-preset",
        "equipmentIds": {
          "helmet": "locked-helmet",
          "weapon": "locked-weapon",
          "armor": "locked-armor",
          "artifact": "locked-artifact"
        },
        "gemAssignments": [
          {
            "slotType": "weapon",
            "gemId": "locked-gem"
          }
        ],
        "calculatedStats": {},
        "createdAt": "2026-11-07T00:00:00Z"
      },
      {
        "id": "unlocked",
        "position": 2,
        "locked": false,
        "name": "検証-unlocked",
        "presetId": "test-preset",
        "equipmentIds": {
          "helmet": "unlocked-helmet",
          "weapon": "unlocked-weapon",
          "armor": "unlocked-armor",
          "artifact": "unlocked-artifact"
        },
        "gemAssignments": [
          {
            "slotType": "weapon",
            "gemId": "unlocked-gem"
          }
        ],
        "calculatedStats": {},
        "createdAt": "2026-11-07T00:00:00Z"
      }
    ],
    "equipmentAllocations": [
      {
        "slotType": "helmet",
        "equipmentId": "locked-helmet",
        "commanderBuildId": "locked",
        "allocatedAt": "2026-11-07T00:00:00Z"
      },
      {
        "slotType": "weapon",
        "equipmentId": "locked-weapon",
        "commanderBuildId": "locked",
        "allocatedAt": "2026-11-07T00:00:00Z"
      },
      {
        "slotType": "armor",
        "equipmentId": "locked-armor",
        "commanderBuildId": "locked",
        "allocatedAt": "2026-11-07T00:00:00Z"
      },
      {
        "slotType": "artifact",
        "equipmentId": "locked-artifact",
        "commanderBuildId": "locked",
        "allocatedAt": "2026-11-07T00:00:00Z"
      },
      {
        "slotType": "helmet",
        "equipmentId": "unlocked-helmet",
        "commanderBuildId": "unlocked",
        "allocatedAt": "2026-11-07T00:00:00Z"
      },
      {
        "slotType": "weapon",
        "equipmentId": "unlocked-weapon",
        "commanderBuildId": "unlocked",
        "allocatedAt": "2026-11-07T00:00:00Z"
      },
      {
        "slotType": "armor",
        "equipmentId": "unlocked-armor",
        "commanderBuildId": "unlocked",
        "allocatedAt": "2026-11-07T00:00:00Z"
      },
      {
        "slotType": "artifact",
        "equipmentId": "unlocked-artifact",
        "commanderBuildId": "unlocked",
        "allocatedAt": "2026-11-07T00:00:00Z"
      }
    ],
    "gemAllocations": [
      {
        "slotType": "weapon",
        "gemId": "locked-gem",
        "commanderBuildId": "locked",
        "allocatedAt": "2026-11-07T00:00:00Z"
      },
      {
        "slotType": "weapon",
        "gemId": "unlocked-gem",
        "commanderBuildId": "unlocked",
        "allocatedAt": "2026-11-07T00:00:00Z"
      }
    ],
    "settings": []
  }
}
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const root = 'http://127.0.0.1:4173'
  const link = name => page.getByText(name, { exact: true })
  const button = name => page.getByRole('button', { name, exact: true })
  const select = name => page.getByRole('combobox', { name, exact: true })
  const option = name => page.getByRole('option', { name, exact: true })
  const card = name => page.locator('.v-card').filter({ has: link(name) })
  const visible = locator => locator.waitFor({ state: 'visible' })

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
  await select('最適化モード').click()
  await option('指定司令官を再最適化').click()
  await select('再最適化する司令官（複数選択）').click()
  await visible(option('司令官 2：検証-unlocked'))
  assert.equal(await option('司令官 1：検証-locked').count(), 0)
  await select('再最適化する司令官（複数選択）').press('Escape')
  await select('最適化モード').click()
  await option('司令官全体を再最適化（ロック中は除外）').click()
  await button('CP-SATで再最適化').click()
  await visible(link('CP-SAT最適化結果（1体）'))
  await visible(page.getByText('現在の構成から変更する装備・ジェム：1箇所。', { exact: false }))
  await button('全1体を安全に一括更新').click()
  await visible(page.getByText('1体を一括更新しました', { exact: false }))

  await link('保存済み司令官を確認').click()
  await page.reload()
  await visible(card('検証-locked').getByText('ロック中', { exact: true }))
  await visible(card('検証-locked').getByText(/兜：locked-helmet/))
  await visible(card('検証-locked').getByText(/ジェム：locked-gem/))
  await visible(card('検証-unlocked').getByText(/兜：upgrade-helmet/))
  await visible(card('検証-unlocked').getByText(/ジェム：unlocked-gem/))
  console.log('Browser reoptimization, atomic save, and persistence verified')
} finally {
  await browser.close()
}
