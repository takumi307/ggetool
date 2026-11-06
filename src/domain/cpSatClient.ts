import { canonicalStatId } from './statAliases'
import type { BuildPreset, Equipment, Gem, StatDefinition } from './types'
import type { OptimizationResult } from './optimizer'

const npcBonusId = (preset: BuildPreset, statId: string): string | undefined => preset.name.includes('援軍特化') && canonicalStatId(statId) === 'S002' ? 'G005' : undefined
export interface CpSatJob { preset: BuildPreset; ordinal: number; priority: number }
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
export const cpSatEndpoint = (import.meta.env.VITE_OPTIMIZER_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

export async function optimizeCpSat(input: {
  jobs: CpSatJob[]
  equipment: Equipment[]
  gems: Gem[]
  stats: StatDefinition[]
  reservedEquipmentIds: string[]
  reservedGemIds: string[]
  timeLimitSeconds: number
  signal?: AbortSignal
  endpoint?: string
  onProgress?: (message: string) => void
}): Promise<CpSatOutcome> {
  const endpoint = input.endpoint ?? cpSatEndpoint
  if (!endpoint) throw new Error('CP-SAT APIが未設定です。VITE_OPTIMIZER_API_URLを設定してください。')
  // Submit once, then poll short requests; a 5-minute solve must not depend
  // on keeping a single browser/Cloudflare/Render connection open.
  const response = await fetch(endpoint + '/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: input.signal,
    body: JSON.stringify({
      equipment: input.equipment,
      gems: input.gems.map(g => ({ ...g, effects: g.effects.map(e => ({ ...e, statId: canonicalStatId(e.statId) })) })),
      stats: input.stats,
      jobs: input.jobs.map(j => ({
        presetId: j.preset.id, ordinal: j.ordinal, priority: j.priority,
        requireEquipment: Boolean(j.preset.requiredEquipmentStatId || j.preset.requiredEquipmentKeyword?.trim()),
        requiredEquipmentIds: j.preset.requiredEquipmentStatId ? input.equipment.filter(e => e.effects.some(x => canonicalStatId(x.statId) === canonicalStatId(j.preset.requiredEquipmentStatId!) && x.value > 0)).map(e => e.id) : j.preset.requiredEquipmentKeyword?.trim() ? input.equipment.filter(e => e.name.includes(j.preset.requiredEquipmentKeyword!.trim())).map(e => e.id) : [],
        targets: j.preset.targets.map(t => ({ ...t, statId: canonicalStatId(t.statId), npcBonusStatId: npcBonusId(j.preset, t.statId) }))
      })),
      reservedEquipmentIds: input.reservedEquipmentIds,
      reservedGemIds: input.reservedGemIds,
      timeLimitSeconds: input.timeLimitSeconds
    })
  })
  if (!response.ok) throw new Error('CP-SATジョブ開始エラー: HTTP ' + response.status)
  const started = await response.json() as { jobId: string }
  if (!/^[a-f0-9]{32}$/.test(started.jobId)) throw new Error('不正なジョブIDです')
  const deadline = Date.now() + input.timeLimitSeconds * 2000 + 120000
  let data: ServerResponse | undefined
  while (Date.now() < deadline) {
    await new Promise<void>((resolve, reject) => {
      if (input.signal?.aborted) { reject(new DOMException('中断しました', 'AbortError')); return }
      const timer = setTimeout(() => { input.signal?.removeEventListener('abort', abort); resolve() }, 3000)
      const abort = () => { clearTimeout(timer); reject(new DOMException('中断しました', 'AbortError')) }
      input.signal?.addEventListener('abort', abort, { once: true })
    })
    const poll = await fetch(endpoint + '/jobs/' + started.jobId, { signal: input.signal })
    if (poll.status === 404) throw new Error('Renderが再起動し、計算ジョブが失われました。再実行してください。')
    if (!poll.ok) throw new Error('計算状況の取得に失敗: HTTP ' + poll.status)
    const state = await poll.json() as { state: string; result?: ServerResponse; error?: string }
    if (state.state === 'failed') throw new Error('CP-SAT計算エラー: ' + (state.error ?? '不明'))
    if (state.state === 'completed') { data = state.result; break }
    input.onProgress?.('CP-SAT計算中… 経過 ' + Math.round((input.timeLimitSeconds * 2000 + 120000 - (deadline - Date.now())) / 1000) + '秒')
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
    if (job.preset.requiredEquipmentStatId && !slots.some(slot => eq.get(b.equipmentIds[slot]!)?.effects.some(x => canonicalStatId(x.statId) === canonicalStatId(job.preset.requiredEquipmentStatId!) && x.value > 0))) throw new Error('必須装備効果を持つ武具が含まれていません')
    if (!job.preset.requiredEquipmentStatId && job.preset.requiredEquipmentKeyword?.trim() && !slots.some(slot => eq.get(b.equipmentIds[slot]!)?.name.includes(job.preset.requiredEquipmentKeyword!.trim()))) throw new Error('必須装備の条件を満たしていません')
    const gemSlots = new Set<string>()
    for (const a of b.gemAssignments) {
      const gem = gems.get(a.gemId)
      if (!gem || !slots.includes(a.slotType) || !gem.allowedSlots.includes(a.slotType) ||
        gemSlots.has(a.slotType) || usedGem.has(a.gemId) || reservedGem.has(a.gemId)) throw new Error('ジェムの割当が不正です')
      gemSlots.add(a.slotType); usedGem.add(a.gemId)
    }
    // Recalculate from local equipment to avoid trusting arbitrary API totals.
    const totals: Record<string, number> = {}
    const add = (effects: { statId: string; value: number }[]) => {
      for (const e of effects) totals[canonicalStatId(e.statId)] = (totals[canonicalStatId(e.statId)] ?? 0) + e.value
    }
    for (const slot of slots) add(eq.get(b.equipmentIds[slot]!)!.effects)
    for (const a of b.gemAssignments) add(gems.get(a.gemId)!.effects)
    const caps = new Map(input.stats.filter(s => s.capStatus === 'known' && s.cap !== null).map(s => [s.id, s.cap!]))
    const equipmentTotals: Record<string, number> = {}
    const gemTotals: Record<string, number> = {}
    const addTo = (target: Record<string, number>, effects: { statId: string; value: number }[]) => {
      for (const e of effects) {
        const id = canonicalStatId(e.statId)
        target[id] = (target[id] ?? 0) + e.value
      }
    }
    for (const slot of slots) addTo(equipmentTotals, eq.get(b.equipmentIds[slot]!)!.effects)
    for (const a of b.gemAssignments) addTo(gemTotals, gems.get(a.gemId)!.effects)
    const shortfalls = job.preset.targets.map(t => {
      const id = canonicalStatId(t.statId)
      const actual = Math.min(equipmentTotals[id] ?? 0, caps.get(id) ?? Infinity) + (gemTotals[id] ?? 0) + (gemTotals[npcBonusId(job.preset, t.statId) ?? ''] ?? 0)
      return { statId: t.statId, required: t.minValue, actual, missing: Math.max(0, t.minValue - actual - 1e-8) }
    })
    if (shortfalls.some(s => s.missing > 1e-8)) throw new Error('APIの候補が最低目標を満たしていません')
    builds.push({ job, result: {
      equipmentIds: b.equipmentIds, gemAssignments: b.gemAssignments, totals, shortfalls,
      overflow: [...caps].filter(([id, cap]) => (totals[id] ?? 0) > cap)
        .map(([statId, cap]) => ({ statId, cap, raw: totals[statId] })),
      evaluated: 0, approximate: !data.optimal
    } })
  }
  if (builds.length !== data.achieved || builds.length > input.jobs.length) throw new Error('APIの件数が不正です')
  return { status: data.status, optimal: data.optimal, achieved: builds.length, upperBound: data.upperBound, requested: data.requested, builds }
}
