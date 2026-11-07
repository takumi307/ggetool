<script setup lang="ts">
import { onMounted, ref, computed, watch, onBeforeUnmount } from 'vue'
import EquipmentAvailability from '@/components/EquipmentAvailability.vue'
import { equipmentAvailability } from '@/domain/equipmentAvailability'
import { buildBreakdown, effectiveTotals, effectiveValue, knownCaps } from '@/domain/effects'
import { canonicalStatId } from '@/domain/statAliases'
import { useRoute } from 'vue-router'
import type { StoreSnapshot } from '@/repositories/types'
import { useDb, useAppStore } from '@/stores/app'
import { saveCommander, commanderNumber, MAX_COMMANDERS, replaceCommanderAssignments } from '@/domain/commanderService'
import { optimizeCpSat, cpSatEndpoint, type CpSatBuild, type CpSatJob } from '@/domain/cpSatClient'
import { SLOT_TYPES, SLOT_LABELS, type BuildPreset, type BuildPlan, type Equipment, type EquipmentAllocation, type Gem, type StatDefinition, type SlotType, type CommanderBuild } from '@/domain'
import { type OptimizationResult, type OptimizerMode } from '@/domain/optimizer'
import { runCastellanPlan, runOptimizeSingle } from '@/domain/optimizerRunner'

const db = useDb()
const app = useAppStore()
const { roleLabel, workspace } = app
const route = useRoute()
const commanderName = ref(''), saved = ref(''), saving = ref(false)
const plans = ref<BuildPlan[]>([])
const progress = ref('')
const batchResults = ref<{ name: string; preset: string; result: OptimizationResult }[]>([])
const cpSatPreview = ref<CpSatBuild[]>([])
let previewInputs: StoreSnapshot = {}
const cpSatStatus = ref('')
const zeroDiagnostics = ref<{ preset: string; stat: string; required: number; optimistic: number; impossible: boolean }[]>([])
const missingSlots = ref<string[]>([])
const cpSatOptimal = ref(false)
const cpSatUpperBound = ref<number | null>(null)
const timeLimitSeconds = ref(60)
const executionMode = ref<'render' | 'local'>(cpSatEndpoint ? 'render' : 'local')
const localEndpoint = 'http://127.0.0.1:8765'
const controller = ref<AbortController | null>(null)
onBeforeUnmount(() => controller.value?.abort())
const committing = ref(false)
const allocationMode = ref<'single' | 'new' | 'selected' | 'all'>('single')
const existingCommanders = ref<CommanderBuild[]>([])
const equipmentAllocations = ref<EquipmentAllocation[]>([])
const ready = ref(false)
const selectedCommanderIds = ref<string[]>([])
const replacementPreview = computed(() => cpSatPreview.value.filter(e => Boolean(e.job.commanderId)))
const movedItems = computed(() => replacementPreview.value.reduce((total, entry) => {
  const previous = existingCommanders.value.find(c => c.id === entry.job.commanderId)
  if (!previous) return total
  return total + SLOT_TYPES.filter(slot => previous.equipmentIds[slot] !== entry.result.equipmentIds[slot]).length +
    SLOT_TYPES.filter(slot => (previous.gemAssignments.find(a => a.slotType === slot)?.gemId ?? '') !==
      (entry.result.gemAssignments.find(a => a.slotType === slot)?.gemId ?? '')).length
}, 0))
const eligibleCommanders = computed(() => existingCommanders.value.filter(c => !c.locked && presets.value.some(p => p.id === c.presetId)))
const targetCommanders = computed(() => {
  if (allocationMode.value === 'all') return eligibleCommanders.value
  if (allocationMode.value === 'selected') return eligibleCommanders.value.filter(c => selectedCommanderIds.value.includes(c.id))
  return []
})
const canSaveCpSat = computed(() => {
  const builds = cpSatPreview.value
  if (!builds.length) return false
  if (allocationMode.value === 'new') return builds.every(entry => !entry.job.commanderId)
  const ids = new Set(builds.map(entry => entry.job.commanderId))
  return builds.length === targetCommanders.value.length && targetCommanders.value.every(c => ids.has(c.id))
})
const commanderChoices = computed(() => eligibleCommanders.value.map(c => ({
  title: roleLabel + ' ' + (commanderNumber(c, existingCommanders.value) ?? '未設定') + '：' + c.name, value: c.id
})))

const activePlans = computed(() => {
  const npcRank = (plan: BuildPlan) => workspace === 'castellan' &&
    presets.value.find(preset => preset.id === plan.presetId)?.castellanObjective === 'npc' ? 0 : 1
  return plans.value.filter(p => p.enabled).sort((a, b) => npcRank(a) - npcRank(b) || a.priority - b.priority)
})
const usesCpSat = computed(() => allocationMode.value !== 'single')
const browserBatch = computed(() => workspace === 'castellan' && usesCpSat.value)
const reoptimizing = computed(() => allocationMode.value === 'selected' || allocationMode.value === 'all')
const availableSlots = computed(() => {
  const released = new Set(targetCommanders.value.map(commander => commander.id))
  return equipmentAvailability(equipment.value, equipmentAllocations.value.filter(item => !released.has(item.commanderBuildId)))
})
const pendingPlanCount = computed(() => activePlans.value.reduce((sum, plan) => {
  if (!presets.value.some(preset => preset.id === plan.presetId)) return sum
  const completed = existingCommanders.value.filter(commander => commander.presetId === plan.presetId).length
  return sum + Math.max(0, plan.count - completed)
}, 0))
const freePositions = computed(() => Math.max(0, MAX_COMMANDERS - existingCommanders.value.length))
const canRun = computed(() => ready.value && !running.value && !committing.value && !saving.value &&
  availableSlots.value.every(slot => slot.available > 0) &&
  (reoptimizing.value ? targetCommanders.value.length > 0 : freePositions.value > 0) &&
  (allocationMode.value === 'new' ? pendingPlanCount.value > 0 : usesCpSat.value || Boolean(preset.value)) &&
  (!usesCpSat.value || browserBatch.value || executionMode.value === 'local' || Boolean(cpSatEndpoint)))
const mode = ref<OptimizerMode>('auto')
const modeOptions = [{ title: '自動（推奨）', value: 'auto' }, { title: '高精度', value: 'precise' }, { title: '高速', value: 'fast' }]
const presets = ref<BuildPreset[]>([]), equipment = ref<Equipment[]>([]), gems = ref<Gem[]>([]), stats = ref<StatDefinition[]>([])
const selected = ref(''), result = ref<OptimizationResult | null>(null), message = ref(''), running = ref(false)
watch([allocationMode, selectedCommanderIds, executionMode, timeLimitSeconds, selected, mode], () => {
  cpSatPreview.value = []
  zeroDiagnostics.value = []
  missingSlots.value = []
  message.value = ''
  result.value = null
}, { flush: 'sync' })

const preset = computed(() => presets.value.find(p => p.id === selected.value))
const statName = (id: string) => stats.value.find(s => s.id === id)?.name ?? id
const eqName = (id?: string) => equipment.value.find(e => e.id === id)?.name ?? '未選択'
const gemName = (id?: string) => gems.value.find(g => g.id === id)?.name ?? 'なし'
const effectText = (id: string, value: number) => `${statName(id)}：${value}${stats.value.find(s => s.id === id)?.unit ?? '%'}`
const itemEffects = (slot: SlotType, r: OptimizationResult) => equipment.value.find(e => e.id === r.equipmentIds[slot])?.effects ?? []
const shownTotals = (r: OptimizationResult) => {
  if (workspace !== 'castellan') return r.totals
  const parts = buildBreakdown(r, equipment.value, gems.value)
  return effectiveTotals(parts.equipment, parts.gem, knownCaps(stats.value))
}
const gemEffects = (slot: SlotType, r: OptimizationResult) => gems.value.find(g => g.id === r.gemAssignments.find(a => a.slotType === slot)?.gemId)?.effects ?? []
function applyRequestedMode() {
  const requestedPresetId = typeof route.query.presetId === 'string' ? route.query.presetId : ''
  const requestedPreset = presets.value.find(p => p.id === requestedPresetId)
  if (requestedPreset) selected.value = requestedPreset.id
  if (route.query.mode === 'single' || requestedPreset) allocationMode.value = 'single'
}
watch(() => [route.query.presetId, route.query.mode], () => {
  if (!running.value && !committing.value && !saving.value) applyRequestedMode()
})
async function refreshAvailability() {
  ;[existingCommanders.value, equipmentAllocations.value] = await Promise.all([
    db.repo('commanders').getAll(), db.repo('equipmentAllocations').getAll(),
  ])
}
onMounted(async () => {
  try {
    ;[presets.value, equipment.value, gems.value, stats.value, plans.value] = await Promise.all([
      db.repo('presets').getAll(), db.repo('equipment').getAll(), db.repo('gems').getAll(), db.repo('stats').getAll(), db.repo('plans').getAll(),
    ])
    selected.value = presets.value[0]?.id ?? ''
    allocationMode.value = activePlans.value.length ? 'new' : 'single'
    applyRequestedMode()
    await refreshAvailability()
    const settings = await db.repo('settings').get('app')
    if (settings?.optimizerId === 'precise' || settings?.optimizerId === 'fast') mode.value = settings.optimizerId
    ready.value = true
  } catch (error) { message.value = String(error) }
})
async function saveResult() {
  if (running.value || saving.value || !result.value || !preset.value) return
  saving.value = true; message.value = ''; saved.value = ''
  try {
    const build = await saveCommander(db, commanderName.value, preset.value.id, result.value)
    saved.value = '「' + build.name + '」を保存しました。装備・ジェムは使用中として確保されます。'
    result.value = null
    await refreshAvailability()
    await app.refreshCounts(db)
  } catch (e) { message.value = String(e) } finally { saving.value = false }
}
async function run() {
  if (!canRun.value) return
  if (usesCpSat.value) { await runPlans(); return }
  if (!preset.value) return
  running.value = true; message.value = ''; saved.value = ''; result.value = null
  const search = new AbortController()
  controller.value = search
  try {
    const [usedEq, usedGem] = await Promise.all([
      db.repo('equipmentAllocations').getAll(), db.repo('gemAllocations').getAll()
    ])
    equipmentAllocations.value = usedEq
    result.value = await runOptimizeSingle({
      equipment: equipment.value, gems: gems.value, stats: stats.value, preset: preset.value,
      reservedEquipmentIds: usedEq.map(a => a.equipmentId), reservedGemIds: usedGem.map(a => a.gemId),
      mode: mode.value
    }, search.signal)
    if (!result.value) message.value = (preset.value.requiredEquipmentStatId || preset.value.requiredEquipmentKeyword?.trim())
      ? '各部位に未使用の装備が1件以上必要です。また、このプリセットの必須武具条件を満たす未使用の武具が必要です'
      : '各部位に未使用の装備が1件以上必要です'
    else commanderName.value = (preset.value?.name ?? roleLabel) + ' ' + new Date().toLocaleDateString('ja-JP')
  } catch (e) {
    message.value = e instanceof DOMException && e.name === 'AbortError' ? '探索を中止しました。' : String(e)
  } finally { running.value = false; controller.value = null }
}
async function runPlans() {
  if (running.value) return
  running.value = true; message.value = ''; saved.value = ''; result.value = null
  batchResults.value = []; cpSatPreview.value = []; cpSatStatus.value = ''; cpSatUpperBound.value = null; zeroDiagnostics.value = []; missingSlots.value = []
  controller.value = new AbortController()
  try {
    const [commanders, usedEq, usedGem, currentEquipment, currentGems, currentStats, currentPresets] = await Promise.all([
      db.repo('commanders').getAll(), db.repo('equipmentAllocations').getAll(), db.repo('gemAllocations').getAll(),
      db.repo('equipment').getAll(), db.repo('gems').getAll(), db.repo('stats').getAll(), db.repo('presets').getAll()
    ])
    existingCommanders.value = commanders
    equipmentAllocations.value = usedEq
    equipment.value = currentEquipment
    gems.value = currentGems
    stats.value = currentStats
    presets.value = currentPresets
    const targets = targetCommanders.value
    const freePositions = Math.max(0, MAX_COMMANDERS - commanders.length)
    if (allocationMode.value === 'new' && !freePositions) {
      message.value = roleLabel + 'の空き番号がありません。'
      return
    }
    if (allocationMode.value !== 'new' && !targets.length) {
      message.value = '再最適化する' + roleLabel + 'がありません。対象を選ぶか、ロックを解除してください。'; return
    }
    const jobs: CpSatJob[] = allocationMode.value === 'new'
      ? activePlans.value.flatMap(plan => {
          const chosen = presets.value.find(p => p.id === plan.presetId)
          if (!chosen) return []
          const done = commanders.filter(c => c.presetId === chosen.id).length
          return Array.from({ length: Math.min(100, Math.max(0, plan.count - done)) },
            (_, index) => ({ preset: chosen, ordinal: done + index + 1, priority: plan.priority }))
        }).slice(0, 100)
      : targets.map((c, index) => ({
          preset: presets.value.find(p => p.id === c.presetId)!,
          ordinal: index + 101,
          priority: activePlans.value.find(p => p.presetId === c.presetId)?.priority ?? 1,
          commanderId: c.id,
          previousEquipmentIds: c.equipmentIds,
          previousGemIds: Object.fromEntries(c.gemAssignments.map(a => [a.slotType, a.gemId]))
        }))
    if (!jobs.length) { message.value = '最適化対象がありません'; return }
    if (!browserBatch.value && executionMode.value === 'local') {
      try {
        const check = await fetch(localEndpoint + '/health', { signal: controller.value.signal })
        if (!check.ok) throw new Error('HTTP ' + check.status)
      } catch {
        throw new Error('PC内の最適化サーバーに接続できません。ローカルサーバーを起動し、CORS_ORIGINSにこのサイトのURLを設定してください。')
      }
    }
    const releasedIds = new Set(targets.map(c => c.id))
    const reservedEq = usedEq.filter(a => !releasedIds.has(a.commanderBuildId))
    const reservedGem = usedGem.filter(a => !releasedIds.has(a.commanderBuildId))
    progress.value = browserBatch.value
      ? `ブラウザで${jobs.length}体の城代の装備配分を計算中…`
      : `CP-SATで${jobs.length}体の装備配分を計算中（最大${timeLimitSeconds.value}秒/段階）。`
    const input = {
      jobs, equipment: equipment.value, gems: gems.value, stats: stats.value,
      reservedEquipmentIds: reservedEq.map(a => a.equipmentId),
      reservedGemIds: reservedGem.map(a => a.gemId),
      maxAchieved: allocationMode.value === 'new' ? freePositions : undefined,
    }
    const response = browserBatch.value ? await runCastellanPlan(input, controller.value.signal) : await optimizeCpSat({
      ...input, timeLimitSeconds: timeLimitSeconds.value, signal: controller.value.signal,
      endpoint: executionMode.value === 'local' ? localEndpoint : cpSatEndpoint,
      onProgress: (text: string) => { progress.value = text },
    })
    if (response.achieved === 0) {
      const reservedEqSet = new Set(reservedEq.map(a => a.equipmentId))
      const reservedGemSet = new Set(reservedGem.map(a => a.gemId))
      const availableEq = equipment.value.filter(e => !reservedEqSet.has(e.id))
      const availableGems = gems.value.filter(g => !reservedGemSet.has(g.id))
      const slots = SLOT_TYPES
      missingSlots.value = slots.filter(slot => !availableEq.some(e => e.slotType === slot)).map(slot => SLOT_LABELS[slot])
      const capMap = new Map(stats.value.filter(s => s.capStatus === 'known' && s.cap !== null).map(s => [canonicalStatId(s.id), s.cap!]))
      const effectSum = (effects: { statId: string; value: number }[], id: string) => effects.reduce((n, e) => n + (canonicalStatId(e.statId) === id ? e.value : 0), 0)
      const distinctPresets = [...new Map(jobs.map(j => [j.preset.id, j.preset])).values()]
      zeroDiagnostics.value = distinctPresets.flatMap(p => p.targets.map(t => {
        const id = canonicalStatId(t.statId)
        const equipmentMax = slots.reduce((sum, slot) => sum + Math.max(0, ...availableEq.filter(e => e.slotType === slot).map(e => effectSum(e.effects, id))), 0)
        const gemMax = slots.reduce((sum, slot) => sum + Math.max(0, ...availableGems.filter(g => g.allowedSlots.includes(slot)).map(g => effectSum(g.effects, id) + (p.name.includes('援軍特化') && id === 'S002' ? effectSum(g.effects, 'G005') : 0))), 0)
        const optimistic = effectiveValue({ [id]: equipmentMax }, { [id]: gemMax }, capMap, id)
        return { preset: p.name, stat: statName(t.statId), required: t.minValue, optimistic, impossible: optimistic + 1e-8 < t.minValue }
      }))
    }
    if (allocationMode.value === 'new' && response.builds.length > freePositions) {
      throw Error('最適化サーバーを最新版に更新してから再実行してください。結果が' + roleLabel + 'の空き枠を超えています。')
    }
    previewInputs = { equipment: currentEquipment, gems: currentGems, stats: currentStats, presets: currentPresets }
    cpSatPreview.value = response.builds
    cpSatStatus.value = response.status
    cpSatOptimal.value = response.optimal
    cpSatUpperBound.value = response.upperBound ?? null
    message.value = browserBatch.value
      ? `${response.achieved} / ${response.requested}体の暫定候補。内容を確認して保存してください。`
      : `${response.achieved} / ${response.requested}体が目標達成。理論上の上限：${response.upperBound ?? '算出不可'}体。判定：${response.optimal ? 'OPTIMAL（最適性証明済み）' : response.status + '（最適性未証明）'}。内容を確認して保存してください。`
  } catch (e) {
    message.value = e instanceof Error && e.name === 'AbortError'
      ? '画面での待機を中断しました。サーバー側の計算は継続する場合があります。保存はしていません。'
      : String(e)
  } finally { running.value = false; progress.value = ''; controller.value = null }
}
async function saveCpSat() {
  if (running.value || committing.value || !canSaveCpSat.value) return
  committing.value = true; message.value = ''; saved.value = ''
  let count = 0
  try {
    if (allocationMode.value !== 'new') {
      await replaceCommanderAssignments(db, cpSatPreview.value.map(entry => ({
        commanderId: entry.job.commanderId!,
        equipmentIds: entry.result.equipmentIds,
        gemAssignments: entry.result.gemAssignments,
        calculatedStats: { ...entry.result.totals, _approximate: entry.result.approximate },
        expectedEquipmentIds: existingCommanders.value.find(c => c.id === entry.job.commanderId)!.equipmentIds,
        expectedGemAssignments: existingCommanders.value.find(c => c.id === entry.job.commanderId)!.gemAssignments
      })), previewInputs)
      saved.value = `${cpSatPreview.value.length}体を一括更新しました（変更した装備・ジェムの割当：${movedItems.value}箇所）`
      cpSatPreview.value = []
      await refreshAvailability()
      await app.refreshCounts(db)
      return
    }
    for (const entry of cpSatPreview.value) {
      const name = `${entry.job.preset.name} ${entry.job.ordinal}`
      await saveCommander(db, name, entry.job.preset.id, entry.result)
      batchResults.value.push({ name, preset: entry.job.preset.name, result: entry.result })
      count++
    }
    saved.value = `${count}体の${roleLabel}を保存しました`
    cpSatPreview.value = []
    await refreshAvailability()
    await app.refreshCounts(db)
  } catch (e) {
    cpSatPreview.value = []
    message.value = `${count}体を保存したところで停止しました：${String(e)}。再最適化してください。`
    await app.refreshCounts(db)
  } finally { committing.value = false }
}

</script>
<template>
  <h2 class="text-h6 mb-3">{{ roleLabel }}の最適化</h2>
  <v-card v-if="ready" variant="outlined" class="pa-4">
    <v-select v-model="allocationMode" :disabled="running || committing || saving"
      :items="[
        { title: '1体だけ作る', value: 'single' },
        { title: '作成計画の不足分をまとめて作る', value: 'new' },
        { title: '指定' + roleLabel + 'を再最適化', value: 'selected' },
        { title: roleLabel + '全体を再最適化（ロック中は除外）', value: 'all' },
      ]" label="最適化モード" />
    <v-select v-if="!usesCpSat && presets.length" v-model="selected" :disabled="running || saving"
      :items="presets.map(p => ({ title: p.name, value: p.id }))" label="ビルドプリセット" />
    <div v-if="!usesCpSat && preset" class="d-flex flex-wrap ga-2 mb-3">
      <v-chip v-for="target in preset.targets" :key="target.statId" size="small">
        {{ effectText(target.statId, target.minValue) }}以上
      </v-chip>
      <span v-if="preset.castellanObjective" class="text-body-2">{{ preset.castellanObjective === 'npc' ? '通常＋NPC効果を最大化' : '通常＋対城主効果をバランス配分' }}</span>
      <span v-else-if="!preset.targets.length" class="text-body-2">最低目標の設定はありません。</span>
    </div>
    <v-alert v-if="!usesCpSat && !presets.length" type="warning" variant="tonal" class="mb-3">
      先に<router-link to="/presets">プリセットを登録</router-link>してください。
    </v-alert>
    <div v-if="allocationMode === 'new'" class="mb-3 text-body-2">
      <router-link to="/plan">作成計画</router-link>の残り {{ pendingPlanCount }}体 ／ 保存できる空き {{ freePositions }}枠
      <p v-if="!pendingPlanCount">追加で作成する計画がありません。</p>
    </div>
    <v-select v-if="allocationMode === 'selected'" v-model="selectedCommanderIds" :disabled="running || committing"
      :items="commanderChoices" :label="'再最適化する' + roleLabel + '（複数選択）'" multiple chips closable-chips />
    <p v-if="reoptimizing" class="text-body-2 mb-3">
      対象 {{ targetCommanders.length }}体。ロック中は対象外です。全員が目標を達成したときに一括更新できます。
    </p>
    <v-alert v-if="reoptimizing && !eligibleCommanders.length" type="warning" variant="tonal" class="mb-3">
      再最適化できる構成がありません。<router-link to="/commanders">保存済みの構成</router-link>でロックやプリセットを確認してください。
    </v-alert>
    <template v-if="!reoptimizing || targetCommanders.length">
      <p class="text-body-2 mb-2">使用可能な装備（4部位に各1件以上必要）</p>
      <EquipmentAvailability :slots="availableSlots" />
    </template>
    <v-alert v-if="!reoptimizing && !freePositions" type="warning" variant="tonal" class="mt-3">
      管理枠が埋まっています。既存の構成を使う場合は再最適化を選んでください。
    </v-alert>
    <v-alert v-if="usesCpSat && !browserBatch && executionMode === 'local'" type="info" variant="tonal" class="mt-3">
      このPCでPython最適化サーバーを起動してください。
      <a href="https://github.com/takumi307/ggetool/blob/main/optimizer-service/LOCAL_WINDOWS.md" target="_blank" rel="noopener">起動手順</a>
    </v-alert>
    <p v-if="browserBatch" class="text-body-2 mt-3 mb-4">ブラウザでNPC向けから割り当て、残りを配分します。結果は暫定候補です。</p>
    <details v-else class="my-4">
      <summary class="text-body-2">計算設定{{ usesCpSat ? (executionMode === 'local' ? '（このPC）' : '（クラウド）') : '' }}</summary>
      <v-select v-if="!usesCpSat" v-model="mode" :disabled="running || saving" :items="modeOptions"
        label="最適化方法" class="mt-2" />
      <template v-else>
        <v-select v-model="executionMode" :disabled="running || committing"
          :items="cpSatEndpoint ? [{ title: 'Render（クラウド）', value: 'render' }, { title: 'このPC', value: 'local' }] : [{ title: 'このPC', value: 'local' }]"
          label="最適化の実行先" class="mt-2" />
        <v-select v-model="timeLimitSeconds" :disabled="running || committing"
          :items="executionMode === 'local' ? [{ title: '1分', value: 60 }, { title: '5分', value: 300 }, { title: '10分', value: 600 }, { title: '30分', value: 1800 }] : [{ title: '30秒', value: 30 }, { title: '1分', value: 60 }, { title: '5分', value: 300 }]"
          label="計算時間（各段階）" />
      </template>
    </details>
    <div class="d-flex align-center ga-2 flex-wrap">
      <v-btn color="primary" :disabled="!canRun" :loading="running" @click="run">{{ browserBatch ? (reoptimizing ? '城代を再最適化' : '城代をまとめて作成') : usesCpSat ? (reoptimizing ? 'CP-SATで再最適化' : 'CP-SATで新規作成') : '最適化を実行' }}</v-btn>
      <v-btn v-if="running" color="warning" variant="outlined" @click="controller?.abort()">{{ usesCpSat && !browserBatch ? '待機を中断' : '探索を中止' }}</v-btn>
    </div>
  </v-card>
  <v-progress-linear v-else-if="!message" indeterminate />
  <v-alert v-if="progress" type="info" class="mt-3">{{ progress }}</v-alert>
  <v-card v-if="cpSatPreview.length" class="pa-4 mt-3">
    <h3 class="text-subtitle-1 mb-2">{{ browserBatch ? '城代の最適化結果' : 'CP-SAT最適化結果' }}（{{ cpSatPreview.length }}体）</h3>
    <v-chip :color="cpSatOptimal ? 'success' : 'warning'" class="mb-3">{{ cpSatOptimal ? 'OPTIMAL：最適性証明済み' : cpSatStatus + '：暫定解' }}</v-chip>
    <div v-if="cpSatUpperBound !== null" class="mb-3">達成 {{ cpSatPreview.length }}体 ／ 理論上の上限 {{ cpSatUpperBound }}体 <span class="text-medium-emphasis">（差 {{ Math.max(0, cpSatUpperBound - cpSatPreview.length) }}体）</span></div>
    <v-alert v-if="allocationMode !== 'new'" type="info" variant="tonal" class="mb-3">
      現在の構成から変更する装備・ジェム：{{ movedItems }}箇所。
      {{ canSaveCpSat ? '結果を確認してから一括更新できます。' : '対象全員が目標を達成した結果のみ保存できます。' }}
    </v-alert>
    <div><v-btn color="primary" :loading="committing" :disabled="running || committing || !canSaveCpSat" @click="saveCpSat">
      {{ allocationMode === 'new' ? 'この' + cpSatPreview.length + '体を保存' : '全' + cpSatPreview.length + '体を安全に一括更新' }}
    </v-btn></div>
    <v-expansion-panels variant="accordion" class="mt-3">
      <v-expansion-panel v-for="(entry, index) in cpSatPreview" :key="index" :title="entry.job.commanderId ? roleLabel + ' ' + (commanderNumber(existingCommanders.find(c=>c.id===entry.job.commanderId)!, existingCommanders) ?? '未設定') + '：' + entry.job.preset.name : entry.job.preset.name + ' ' + entry.job.ordinal">
        <v-expansion-panel-text>
          <div v-if="entry.job.commanderId" class="mb-2 text-caption">現在の構成 → 新しい構成</div>
          <div v-for="slot in SLOT_TYPES" :key="slot" class="mb-2">
            <div v-if="entry.job.commanderId" class="text-caption">
              現在：{{ eqName(existingCommanders.find(c=>c.id===entry.job.commanderId)?.equipmentIds[slot]) }}
              / ジェム：{{ gemName(existingCommanders.find(c=>c.id===entry.job.commanderId)?.gemAssignments.find(a=>a.slotType===slot)?.gemId) }}
            </div>
            <strong>{{ SLOT_LABELS[slot] }}：{{ eqName(entry.result.equipmentIds[slot]) }}</strong>
            <div v-for="(effect, i) in itemEffects(slot, entry.result)" :key="i" class="text-body-2">{{ effectText(effect.statId, effect.value) }}</div>
            <div>ジェム：{{ gemName(entry.result.gemAssignments.find(a => a.slotType === slot)?.gemId) }}</div>
          </div>
          <div v-if="browserBatch" class="mt-3">
            <strong>上限適用後の効果</strong>
            <div v-for="(value, id) in shownTotals(entry.result)" :key="id">{{ effectText(String(id), value) }}</div>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </v-card>
  <v-card v-if="zeroDiagnostics.length || missingSlots.length" class="pa-4 mt-3">
    <h3 class="text-subtitle-1 mb-2">0体の原因診断（利用可能な装備・ジェムから計算）</h3>
    <v-alert v-if="missingSlots.length" type="error" variant="tonal" class="mb-2">未使用装備がない部位：{{ missingSlots.join('、') }}</v-alert>
    <v-alert type="info" variant="tonal" class="mb-3">下記の「楽観的最大値」は、各部位の装備・ジェムの最高値を個別に合算した上界です。同じジェムを複数部位で数える場合があり、実際に組める保証はありません。最低目標未満なら、その効果単独でも達成不可能です。</v-alert>
    <v-table density="compact"><thead><tr><th>プリセット</th><th>効果</th><th>最低目標</th><th>楽観的最大値</th><th>判定</th></tr></thead>
      <tbody><tr v-for="(d, i) in zeroDiagnostics" :key="i"><td>{{ d.preset }}</td><td>{{ d.stat }}</td><td>{{ d.required }}</td><td>{{ Number(d.optimistic.toFixed(3)) }}</td><td>{{ d.impossible ? '単独でも達成不可' : '単独では可能性あり' }}</td></tr></tbody></v-table>
    <div class="text-caption mt-2">全項目が「可能性あり」でも、5条件の同時達成や装備・ジェムの重複禁止によって0体になる場合があります。設定値を自動変更することはありません。</div>
  </v-card>
  <v-alert v-if="message" type="warning" class="mt-4">{{ message }}</v-alert>
  <v-alert v-if="saved" type="success" class="mt-4">{{ saved }} <router-link to="/commanders">保存済み{{ roleLabel }}を確認</router-link></v-alert>
  <v-card v-if="batchResults.length" class="pa-3 mt-4">
    <h3 class="text-subtitle-1 mb-2">今回作成した{{ roleLabel }}（{{ batchResults.length }}体）</h3>
    <v-expansion-panels variant="accordion">
      <v-expansion-panel v-for="(entry, index) in batchResults" :key="index" :title="entry.name">
        <v-expansion-panel-text>
          <div v-for="slot in SLOT_TYPES" :key="slot" class="mb-3">
            <strong>{{ SLOT_LABELS[slot] }}：{{ eqName(entry.result.equipmentIds[slot]) }}</strong>
            <div v-for="(effect, i) in itemEffects(slot, entry.result)" :key="i" class="text-body-2">{{ effectText(effect.statId, effect.value) }}</div>
            <div class="mt-1">ジェム：{{ gemName(entry.result.gemAssignments.find(a => a.slotType === slot)?.gemId) }}</div>
            <div v-for="(effect, i) in gemEffects(slot, entry.result)" :key="i" class="text-body-2">{{ effectText(effect.statId, effect.value) }}</div>
          </div>
          <v-chip :color="entry.result.approximate ? 'warning' : 'success'" size="small">{{ entry.result.approximate ? "暫定解" : "全候補探索" }}</v-chip>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </v-card>
  <template v-if="result">
    <v-card class="pa-3 mt-4">
      <h3 class="text-subtitle-1 mb-2">結果を確認して保存</h3>
      <v-chip v-if="result.shortfalls.length" class="mb-3" :color="result.shortfalls.some(target => target.missing > 0) ? 'warning' : 'success'">
        目標 {{ result.shortfalls.filter(target => target.missing === 0).length }} / {{ result.shortfalls.length }}件達成
      </v-chip>
      <v-text-field v-model="commanderName" :label="roleLabel + '名'" />
      <v-btn color="primary" :loading="saving" @click="saveResult">この構成を保存して装備を確保</v-btn>
    </v-card>
    <v-alert :type="result.approximate ? 'warning' : 'success'" class="mt-4">
      {{ result.approximate ? '暫定最良解（候補絞り込み・探索打切りの可能性があり、最適性は保証されません）' : '全候補を探索しました' }}
      ／ 評価 {{ result.evaluated.toLocaleString() }} 件
    </v-alert>
    <v-card class="pa-3 mt-3">
      <h3 class="text-subtitle-1 mb-2">装備とジェムの組み合わせ</h3>
      <div v-for="slot in SLOT_TYPES" :key="slot" class="py-2">
        <strong>{{ SLOT_LABELS[slot] }}</strong>：{{ eqName(result.equipmentIds[slot]) }}
        <div v-for="(effect, i) in itemEffects(slot, result)" :key="i" class="text-body-2 ml-3">{{ effectText(effect.statId, effect.value) }}</div>
        <div class="text-caption mt-2">ジェム：{{ gemName(result.gemAssignments.find(a => a.slotType === slot)?.gemId) }}</div>
        <div v-for="(effect, i) in gemEffects(slot, result)" :key="i" class="text-body-2 ml-3">{{ effectText(effect.statId, effect.value) }}</div>
      </div>
    </v-card>
    <v-card class="pa-3 mt-3">
      <h3 class="text-subtitle-1 mb-2">目標達成状況</h3>
      <div v-for="s in result.shortfalls" :key="s.statId">
        {{ statName(s.statId) }}：{{ s.actual }} / {{ s.required }}
        <v-chip size="x-small" :color="s.missing ? 'warning' : 'success'">{{ s.missing ? '不足 ' + s.missing : '達成' }}</v-chip>
      </div>
      <h3 class="text-subtitle-1 mt-3 mb-2">全ステータス</h3>
      <div v-for="(value, id) in shownTotals(result)" :key="id">{{ statName(String(id)) }}：{{ value }}</div>
      <v-alert v-if="result.overflow.length" type="warning" variant="tonal" class="mt-3">
        装備の上限超過：{{ result.overflow.map(s => statName(s.statId) + ' ' + s.raw + ' / ' + s.cap).join('、') }}
      </v-alert>
    </v-card>
  </template>
</template>
