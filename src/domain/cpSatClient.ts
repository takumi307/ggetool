import { canonicalStatId } from './statAliases'
import { addEffects, castellanScoringScales, castellanScoringStats, knownCaps, npcBonusId, requiredEquipmentMatcher, targetActual, type Totals } from './effects'
import type { BuildPreset, Equipment, Gem, SlotType, StatDefinition } from './types'
import type { OptimizationResult } from './optimizer'

export interface CpSatJob { preset: BuildPreset; ordinal: number; priority: number; commanderId?: string; previousEquipmentIds?: Partial<Record<SlotType, string>>; previousGemIds?: Partial<Record<SlotType, string>> }
export interface CpSatBuild { job: CpSatJob; result: OptimizationResult }
export interface CpSatOutcome {
  status: string
  optimal: boolean
  achieved: number
  upperBound?: number | null
  requested: number
  builds: CpSatBuild[]
}
interface ServerBuild {
  presetId: string
  ordinal: number
  equipmentIds: OptimizationResult['equipmentIds']
  gemAssignments: OptimizationResult['gemAssignments']
  totals: OptimizationResult['totals']
  shortfalls: OptimizationResult['shortfalls']
  overflow: OptimizationResult['overflow']
}
interface ServerResponse {
  status: string
  optimal: boolean
  achieved: number
  upperBound?: number | null
  requested: number
  builds: ServerBuild[]
}
export const cpSatEndpoint = globalThis.location?.hostname === 'ggetool.takutaku307.workers.dev'
  ? '/api/optimizer'
  : (import.meta.env.VITE_OPTIMIZER_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

export async function optimizeCpSat(input: {
  jobs: CpSatJob[]
  equipment: Equipment[]
  gems: Gem[]
  stats: StatDefinition[]
  reservedEquipmentIds: string[]
  reservedGemIds: string[]
  timeLimitSeconds: number
  castellan?: boolean
  maxAchieved?: number
  signal?: AbortSignal
  endpoint?: string
  local?: boolean
  onProgress?: (message: string) => void
}): Promise<CpSatOutcome> {
  const endpoint = input.endpoint ?? cpSatEndpoint
  if (!endpoint) throw new Error('CP-SAT APIが未設定です。VITE_OPTIMIZER_API_URLを設定してください。')
  const wait = (ms: number) => new Promise<void>((resolve, reject) => {
    if (input.signal?.aborted) { reject(new DOMException('中断しました', 'AbortError')); return }
    const timer = setTimeout(() => { input.signal?.removeEventListener('abort', abort); resolve() }, ms)
    const abort = () => { clearTimeout(timer); reject(new DOMException('中断しました', 'AbortError')) }
    input.signal?.addEventListener('abort', abort, { once: true })
  })
  const scales = input.castellan ? castellanScoringScales(input.stats, [...input.equipment, ...input.gems]) : new Map<string, number>()
  // Submit once, then poll short requests; a 5-minute solve must not depend
  // on keeping a single browser/Cloudflare/Render connection open.
  input.onProgress?.('計算データをサーバーへ送信中…')
  const response = await fetch(endpoint + '/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: input.signal,
    body: JSON.stringify({
      castellan: input.castellan,
      equipment: input.equipment.map(({ id, slotType, effects }) => ({ id, slotType, effects })),
      gems: input.gems.map(({ id, allowedSlots, effects }) => ({
        id, allowedSlots, effects: effects.map(e => ({ ...e, statId: canonicalStatId(e.statId) })),
      })),
      stats: input.stats.map(({ id, cap, capStatus }) => ({ id, cap, capStatus })),
      jobs: input.jobs.map(j => ({
        presetId: j.preset.id, ordinal: j.ordinal, priority: j.priority,
        scoring: input.castellan ? castellanScoringStats({ ...j.preset, castellanObjective: j.preset.castellanObjective ?? 'general' }, scales) : undefined,
        previousEquipmentIds: j.previousEquipmentIds ?? {}, previousGemIds: j.previousGemIds ?? {},
        requireEquipment: Boolean(requiredEquipmentMatcher(j.preset)),
        requiredEquipmentIds: (() => { const match = requiredEquipmentMatcher(j.preset); return match ? input.equipment.filter(match).map(e => e.id) : [] })(),
        targets: j.preset.targets.map(t => ({ ...t, statId: canonicalStatId(t.statId), npcBonusStatId: npcBonusId(j.preset, t.statId) }))
      })),
      reservedEquipmentIds: input.reservedEquipmentIds,
      reservedGemIds: input.reservedGemIds,
      maxAchieved: input.maxAchieved,
      timeLimitSeconds: input.timeLimitSeconds
    })
  }).catch(error => {
    if (input.signal?.aborted) throw error
    throw new Error(input.local
      ? 'このPCの計算サーバーに接続できません。サーバーの起動とブラウザのローカルネットワーク許可を確認してください。'
      : 'Renderへの送信中に接続が途切れました。少し待ってから再実行してください。')
  })
  if (response.status === 429) throw new Error('計算サーバーが別の計算を実行中です。完了後に再実行してください。')
  if ([502, 503, 504].includes(response.status)) throw new Error('Renderの計算サーバーに接続できません（HTTP ' + response.status + '）。少し待って再実行してください。')
  if (!response.ok) throw new Error('計算を開始できません（HTTP ' + response.status + '）。')
  const started = await response.json() as { jobId: string; castellan?: boolean }
  if (input.castellan && started.castellan !== true) throw new Error('この計算サーバーは城代に未対応です。計算サーバーを最新版に更新してください。')
  if (!/^[a-f0-9]{32}$/.test(started.jobId)) throw new Error('不正なジョブIDです')
  const waitMs = input.timeLimitSeconds * (input.castellan ? 3000 : 2000) + 120000
  const deadline = Date.now() + waitMs
  let data: ServerResponse | undefined
  while (Date.now() < deadline) {
    await wait(3000)
    const poll = await fetch(endpoint + '/jobs/' + started.jobId, { signal: input.signal })
    if (poll.status === 404) throw new Error('Renderが再起動し、計算ジョブが失われました。再実行してください。')
    if (!poll.ok) throw new Error('計算状況の取得に失敗: HTTP ' + poll.status)
    const state = await poll.json() as { state: string; result?: ServerResponse; error?: string }
    if (state.state === 'failed') throw new Error('CP-SAT計算エラー: ' + (state.error ?? '不明'))
    if (state.state === 'completed') { data = state.result; break }
    input.onProgress?.('CP-SAT計算中… 経過 ' + Math.round((waitMs - (deadline - Date.now())) / 1000) + '秒')
  }
  if (!data) throw new Error('計算待ちが制限時間を超えました。Renderのログを確認してください。')
  if (!Array.isArray(data.builds)) throw new Error('CP-SAT APIから不正な応答が返されました')
  const jobs = new Map(input.jobs.map(j => [j.preset.id + ':' + j.ordinal, j]))
  const eq = new Map(input.equipment.map(e => [e.id, e]))
  const gems = new Map(input.gems.map(g => [g.id, g]))
  const reservedEq = new Set(input.reservedEquipmentIds)
  const reservedGem = new Set(input.reservedGemIds)
  const usedEq = new Set<string>()
  const usedGem = new Set<string>()
  const builds: CpSatBuild[] = []
  for (const b of data.builds) {
    const job = jobs.get(b.presetId + ':' + b.ordinal)
    if (!job) throw new Error('CP-SAT APIが未知のビルドを返しました')
    const slots = ['helmet', 'weapon', 'armor', 'artifact'] as const
    for (const slot of slots) {
      const id = b.equipmentIds[slot]
      if (!id || !eq.has(id) || eq.get(id)?.slotType !== slot || reservedEq.has(id) || usedEq.has(id)) throw new Error('装備の割当が不正です')
      usedEq.add(id)
    }
    const matchesRequired = requiredEquipmentMatcher(job.preset)
    if (matchesRequired && !slots.some(slot => matchesRequired(eq.get(b.equipmentIds[slot]!)!))) throw new Error('必須装備の条件を満たしていません')
    const gemSlots = new Set<string>()
    for (const a of b.gemAssignments) {
      const gem = gems.get(a.gemId)
      if (!gem || !slots.includes(a.slotType) || !gem.allowedSlots.includes(a.slotType) ||
        gemSlots.has(a.slotType) || usedGem.has(a.gemId) || reservedGem.has(a.gemId)) throw new Error('ジェムの割当が不正です')
      gemSlots.add(a.slotType); usedGem.add(a.gemId)
    }
    // Recalculate from local equipment to avoid trusting arbitrary API totals.
    const caps = knownCaps(input.stats)
    const totals: Totals = {}
    const equipmentTotals: Totals = {}
    const gemTotals: Totals = {}
    for (const slot of slots) { const effects = eq.get(b.equipmentIds[slot]!)!.effects; addEffects(totals, effects); addEffects(equipmentTotals, effects) }
    for (const a of b.gemAssignments) { const effects = gems.get(a.gemId)!.effects; addEffects(totals, effects); addEffects(gemTotals, effects) }
    const shortfalls = job.preset.targets.map(t => {
      const actual = targetActual(job.preset, t.statId, equipmentTotals, gemTotals, caps)
      return { statId: t.statId, required: t.minValue, actual, missing: Math.max(0, t.minValue - actual - 1e-8) }
    })
    if (shortfalls.some(s => s.missing > 1e-8)) throw new Error('APIの候補が最低目標を満たしていません')
    builds.push({ job, result: {
      equipmentIds: b.equipmentIds, gemAssignments: b.gemAssignments, totals, shortfalls,
      overflow: [...caps].filter(([id, cap]) => (equipmentTotals[id] ?? 0) > cap)
        .map(([statId, cap]) => ({ statId, cap, raw: equipmentTotals[statId] })),
      evaluated: 0, approximate: !data.optimal
    } })
  }
  if (builds.length !== data.achieved || builds.length > input.jobs.length) throw new Error('APIの件数が不正です')
  return { status: data.status, optimal: data.optimal, achieved: builds.length, upperBound: data.upperBound, requested: data.requested, builds }
}
