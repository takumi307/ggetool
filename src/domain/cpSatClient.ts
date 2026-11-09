import { canonicalStatId } from './statAliases'
import { addEffects, castellanScoringScales, castellanScoringStats, knownCaps, npcBonusId, requiredEquipmentMatcher, targetActual, type Totals } from './effects'
import { objectiveTargetIds } from './presetObjective'
import type { BuildPreset, Equipment, Gem, SlotType, StatDefinition } from './types'
import type { OptimizationResult } from './optimizer'

export interface CpSatJob { preset: BuildPreset; ordinal: number; priority: number; commanderId?: string; previousEquipmentIds?: Partial<Record<SlotType, string>>; previousGemIds?: Partial<Record<SlotType, string>> }
export interface CpSatBuild { job: CpSatJob; result: OptimizationResult }
export interface CpSatStage { id: string; status: string; value: number; bound?: number | null }
export interface CpSatProgress {
  stage: string; stageIndex: number; stageCount: number
  achieved: number; upperBound: number; countOptimal: boolean; elapsedSeconds: number
}
export interface CpSatOutcome {
  countOptimal?: boolean
  stages?: CpSatStage[]
  elapsedSeconds?: number
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
  countOptimal?: boolean
  stages?: CpSatStage[]
  elapsedSeconds?: number
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
  onSearchProgress?: (progress: CpSatProgress) => void
}): Promise<CpSatOutcome> {
  const endpoint = input.endpoint ?? cpSatEndpoint
  if (!endpoint) throw new Error('CP-SAT APIが未設定です。VITE_OPTIMIZER_API_URLを設定してください。')
  const wait = (ms: number) => new Promise<void>((resolve, reject) => {
    if (input.signal?.aborted) { reject(new DOMException('中断しました', 'AbortError')); return }
    const timer = setTimeout(() => { input.signal?.removeEventListener('abort', abort); resolve() }, ms)
    const abort = () => { clearTimeout(timer); reject(new DOMException('中断しました', 'AbortError')) }
    input.signal?.addEventListener('abort', abort, { once: true })
  })
  const objectives = input.jobs.flatMap(job => job.preset.objective ? [job.preset.objective] : [])
  const objectiveOrder = objectives[0]?.order
  if (objectiveOrder && objectives.some(objective => objective.order.join(',') !== objectiveOrder.join(','))) {
    throw new Error('一緒に計算するプリセットの詳細設定で、優先順をそろえてください。')
  }
  const scales = input.castellan || objectiveOrder ? castellanScoringScales(input.stats, [...input.equipment, ...input.gems]) : new Map<string, number>()
  // Cloud retries reuse the same ID so a lost response cannot start another calculation.
  const requestId = endpoint === '/api/optimizer' ? crypto.randomUUID().replace(/-/g, '') : undefined
  const body = JSON.stringify({
    requestId,
    castellan: input.castellan,
    objectiveOrder,
    equipment: input.equipment.map(({ id, slotType, effects }) => ({ id, slotType, effects: effects.map(e => ({ ...e, statId: canonicalStatId(e.statId) })) })),
    gems: input.gems.map(({ id, allowedSlots, effects }) => ({
      id, allowedSlots, effects: effects.map(e => ({ ...e, statId: canonicalStatId(e.statId) })),
    })),
    stats: input.stats.map(({ id, cap, capStatus }) => ({ id, cap, capStatus })),
    jobs: input.jobs.map(j => {
      const objective = j.preset.objective
      const targets = objectiveTargetIds(j.preset)
      return {
        presetId: j.preset.id, ordinal: j.ordinal, priority: j.priority,
        scoring: objective ? objective.weights
          .map(({ statId, weight }) => ({ id: canonicalStatId(statId), weight }))
          .filter(({ id }) => !targets.has(id) && scales.has(id))
          .map(stat => ({ ...stat, scale: scales.get(stat.id)! }))
          .filter(stat => stat.scale > 0)
          : input.castellan ? castellanScoringStats({ ...j.preset, castellanObjective: j.preset.castellanObjective ?? 'general' }, scales) : undefined,
        overshoot: objective?.overshoot,
        keepEquipment: objective?.reopt.minimizeSwaps ?? !input.castellan,
        keepGems: objective?.reopt.keepGems ?? !input.castellan,
        previousEquipmentIds: j.previousEquipmentIds ?? {}, previousGemIds: j.previousGemIds ?? {},
        requireEquipment: Boolean(requiredEquipmentMatcher(j.preset)),
        requiredEquipmentIds: (() => { const match = requiredEquipmentMatcher(j.preset); return match ? input.equipment.filter(match).map(e => e.id) : [] })(),
        targets: j.preset.targets.map(t => ({ ...t, statId: canonicalStatId(t.statId), npcBonusStatId: npcBonusId(j.preset, t.statId) }))
      }
    }),
    reservedEquipmentIds: input.reservedEquipmentIds,
    reservedGemIds: input.reservedGemIds,
    maxAchieved: input.maxAchieved,
    timeLimitSeconds: input.timeLimitSeconds
  })
  const transient = (status: number) => [502, 503, 504, 522, 524].includes(status)
  // Render may return 502 while waking up. Give it time to recover without
  // starting a second job if it already accepted the first submission.
  const submissionDeadline = Date.now() + 120000
  let retryDelay = 2000
  let response: Response | undefined
  input.onProgress?.('計算データをサーバーへ送信中…')
  while (true) {
    const remaining = submissionDeadline - Date.now()
    if (requestId && remaining <= 0) break
    const timeout = requestId ? AbortSignal.timeout(Math.min(58000, remaining)) : undefined
    const signal = timeout && input.signal ? AbortSignal.any([timeout, input.signal]) : timeout ?? input.signal
    response = await fetch(endpoint + '/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body,
    }).catch(error => {
      if (input.signal?.aborted) throw error
      return undefined
    })
    if (!requestId || (response && !transient(response.status))) break
    await response?.body?.cancel().catch(() => {})
    const timeLeft = submissionDeadline - Date.now()
    if (timeLeft <= 0) break
    input.onProgress?.('Renderの応答を待っています。復帰後に計算を開始します…')
    await wait(Math.min(retryDelay, timeLeft))
    retryDelay = Math.min(retryDelay * 2, 12000)
  }
  if (!response) throw new Error(input.local
    ? 'このPCの計算サーバーに接続できません。サーバーの起動とブラウザのローカルネットワーク許可を確認してください。'
    : 'Renderへの送信中に接続が途切れました。少し待ってから再実行してください。')
  if (response.status === 429) throw new Error('計算サーバーが別の計算を実行中です。完了後に再実行してください。')
  if (transient(response.status)) throw new Error('計算サーバーの応答を受け取れませんでした（HTTP ' + response.status + '）。' +
    (requestId ? '2分間再試行しました。Renderの稼働状況を確認してください。' : '少し待って再実行してください。'))
  if (!response.ok) throw new Error('計算を開始できません（HTTP ' + response.status + '）。')
  const started = await response.json() as { jobId: string; castellan?: boolean; objectiveVersion?: number }
  if (objectiveOrder && started.objectiveVersion !== 1) throw new Error('詳細設定を使うには計算サーバーを最新版に更新してください。')
  if (input.castellan && started.castellan !== true) throw new Error('この計算サーバーは城代に未対応です。計算サーバーを最新版に更新してください。')
  if (!/^[a-f0-9]{32}$/.test(started.jobId)) throw new Error('不正なジョブIDです')
  const waitMs = input.timeLimitSeconds * 1000 * (objectiveOrder ? objectiveOrder.length + 1 : input.castellan ? 3 : 2) + 120000
  const deadline = Date.now() + waitMs
  let data: ServerResponse | undefined
  let failures = 0
  while (Date.now() < deadline) {
    await wait(Math.min(10000, 3000 + failures * 1000))
    let poll: Response
    try {
      poll = await fetch(endpoint + '/jobs/' + started.jobId, { signal: input.signal })
    } catch (error) {
      if (input.signal?.aborted) throw error
      failures++
      input.onProgress?.('通信の復帰を待っています。開始済みの計算結果に再接続します…')
      continue
    }
    if (transient(poll.status) || poll.status === 429) {
      failures++
      input.onProgress?.('サーバーとの通信を再試行しています。計算は再送しません…')
      continue
    }
    if (poll.status === 404) throw new Error('計算サーバーが再起動し、計算ジョブが消えました。再実行してください。')
    if (!poll.ok) throw new Error('計算状況の取得に失敗: HTTP ' + poll.status)
    failures = 0
    const state = await poll.json() as { state: string; result?: ServerResponse; error?: string; progress?: CpSatProgress }
    if (state.state === 'failed') throw new Error('CP-SAT計算エラー: ' + (state.error ?? '不明'))
    if (state.state === 'completed') { data = state.result; break }
    if (state.progress) input.onSearchProgress?.(state.progress)
    input.onProgress?.('組み合わせを探索中… 経過 ' + Math.round((waitMs - (deadline - Date.now())) / 1000) + '秒')
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
  const usedJobs = new Set<string>()
  for (const b of data.builds) {
    const jobKey = b.presetId + ':' + b.ordinal
    const job = jobs.get(jobKey)
    if (usedJobs.has(jobKey)) throw new Error('APIが同じ対象を複数回返しました')
    usedJobs.add(jobKey)
    if (!job) throw new Error('CP-SAT APIが未知のビルドを返しました')
    if (!b.equipmentIds || !Array.isArray(b.gemAssignments)) throw new Error('APIの装備構成が不正です')
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
  if (data.requested !== input.jobs.length || builds.length !== data.achieved || builds.length > input.jobs.length || (input.maxAchieved !== undefined && builds.length > input.maxAchieved)) throw new Error('APIの件数が不正です')
  return { countOptimal: data.countOptimal, stages: data.stages, elapsedSeconds: data.elapsedSeconds, status: data.status, optimal: data.optimal, achieved: builds.length, upperBound: data.upperBound, requested: data.requested, builds }
}
