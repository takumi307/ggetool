<script setup lang="ts">
import { onMounted, ref, computed, watch, onBeforeUnmount } from 'vue'
import OptimizationSummary from '@/components/OptimizationSummary.vue'
import BuildStatsPreview from '@/components/BuildStatsPreview.vue'
import { STAGE_LABELS, inspectTargets, requiredEquipmentIssues, objectiveOrderIssue, objectiveDescription, maximumStages, jobPresets } from '@/domain/optimizationInsight'
import EquipmentAvailability from '@/components/EquipmentAvailability.vue'
import { equipmentAvailability } from '@/domain/equipmentAvailability'
import { buildBreakdown, effectiveTotals, effectiveValue, knownCaps } from '@/domain/effects'
import { canonicalStatId } from '@/domain/statAliases'
import { useRoute } from 'vue-router'
import type { StoreSnapshot } from '@/repositories/types'
import { useDb, useAppStore } from '@/stores/app'
import { saveCommander, saveCommanders, commanderNumber, MAX_COMMANDERS, replaceCommanderAssignments } from '@/domain/commanderService'
import { optimizeCpSat, cpSatEndpoint, type CpSatBuild, type CpSatJob, type CpSatOutcome, type CpSatProgress } from '@/domain/cpSatClient'
import { SLOT_TYPES, SLOT_LABELS, type BuildPreset, type BuildPlan, type Equipment, type EquipmentAllocation, type GemAllocation, type Gem, type StatDefinition, type SlotType, type CommanderBuild } from '@/domain'
import type { OptimizationResult } from '@/domain/optimizer'

const db = useDb()
const app = useAppStore()
const { roleLabel, workspace } = app
const route = useRoute()
const commanderName = ref(''), saved = ref(''), saving = ref(false)
const plans = ref<BuildPlan[]>([])
const progress = ref('')
const searchProgress = ref<CpSatProgress | null>(null)
const outcome = ref<CpSatOutcome | null>(null)
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
const executionOptions = [
  ...(cpSatEndpoint ? [{ title: 'Render（クラウド）', value: 'render' }] : []),
  { title: 'このPC', value: 'local' },
]
const timeOptions = computed(() => executionMode.value === 'local'
  ? [{ title: '1分', value: 60 }, { title: '5分', value: 300 }, { title: '10分', value: 600 }, { title: '30分', value: 1800 }]
  : [{ title: '30秒', value: 30 }, { title: '1分', value: 60 }, { title: '5分', value: 300 }])
watch(executionMode, () => {
  if (!timeOptions.value.some(option => option.value === timeLimitSeconds.value)) timeLimitSeconds.value = 60
})
const localEndpoint = 'http://127.0.0.1:8765'
const controller = ref<AbortController | null>(null)
onBeforeUnmount(() => controller.value?.abort())
const committing = ref(false)
const allocationMode = ref<'single' | 'new' | 'selected' | 'all'>('single')
const existingCommanders = ref<CommanderBuild[]>([])
const equipmentAllocations = ref<EquipmentAllocation[]>([])
const gemAllocations = ref<GemAllocation[]>([])
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
const singleBuild = computed(() => allocationMode.value === 'single')
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
const canRun = computed(() => !configurationIssue.value && ready.value && !running.value && !committing.value && !saving.value &&
  availableSlots.value.every(slot => slot.available > 0) &&
  (reoptimizing.value ? targetCommanders.value.length > 0 : freePositions.value > 0) &&
  (allocationMode.value === 'new' ? pendingPlanCount.value > 0 : !singleBuild.value || Boolean(preset.value)))
const presets = ref<BuildPreset[]>([]), equipment = ref<Equipment[]>([]), gems = ref<Gem[]>([]), stats = ref<StatDefinition[]>([])
const selected = ref(''), result = ref<OptimizationResult | null>(null), message = ref(''), running = ref(false)
watch([allocationMode, selectedCommanderIds, selected], () => {
  cpSatPreview.value = []
  outcome.value = null
  saved.value = ''
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
  const parts = buildBreakdown(r, equipment.value, gems.value)
  return effectiveTotals(parts.equipment, parts.gem, knownCaps(stats.value))
}
const gemEffects = (slot: SlotType, r: OptimizationResult) => gems.value.find(g => g.id === r.gemAssignments.find(a => a.slotType === slot)?.gemId)?.effects ?? []

function createJobs(): CpSatJob[] {
  return singleBuild.value
      ? (preset.value ? [{ preset: preset.value, ordinal: 1, priority: 1 }] : [])
      : allocationMode.value === 'new'
      ? activePlans.value.flatMap(plan => {
          const chosen = presets.value.find(p => p.id === plan.presetId)
          if (!chosen) return []
          const done = existingCommanders.value.filter(c => c.presetId === chosen.id).length
          return Array.from({ length: Math.min(100, Math.max(0, plan.count - done)) },
            (_, index) => ({ preset: chosen, ordinal: done + index + 1, priority: plan.priority }))
        }).slice(0, 100)
      : targetCommanders.value.map((c, index) => ({
          preset: presets.value.find(p => p.id === c.presetId)!,
          ordinal: index + 101,
          priority: activePlans.value.find(p => p.presetId === c.presetId)?.priority ?? 1,
          commanderId: c.id,
          previousEquipmentIds: c.equipmentIds,
          previousGemIds: Object.fromEntries(c.gemAssignments.map(a => [a.slotType, a.gemId]))
        }))
}
const plannedJobs = computed(createJobs)
const involvedPresets = computed(() => jobPresets(plannedJobs.value))
const configurationIssue = computed(() => objectiveOrderIssue(involvedPresets.value))
const availableEquipment = computed(() => {
  const released = new Set(targetCommanders.value.map(c => c.id))
  const reserved = new Set(equipmentAllocations.value.filter(a => !released.has(a.commanderBuildId)).map(a => a.equipmentId))
  return equipment.value.filter(e => !reserved.has(e.id))
})
const availableGems = computed(() => {
  const released = new Set(targetCommanders.value.map(c => c.id))
  const reserved = new Set(gemAllocations.value.filter(a => !released.has(a.commanderBuildId)).map(a => a.gemId))
  return gems.value.filter(g => !reserved.has(g.id))
})
const targetChecks = computed(() => inspectTargets(involvedPresets.value, availableEquipment.value, availableGems.value, stats.value))
const impossibleTargets = computed(() => targetChecks.value.filter(t => t.impossible))
const missingRequirements = computed(() => requiredEquipmentIssues(involvedPresets.value, availableEquipment.value))
const inventoryBound = computed(() => Math.min(plannedJobs.value.length,
  reoptimizing.value ? targetCommanders.value.length : freePositions.value,
  ...availableSlots.value.map(slot => slot.available)))
const estimatedMinutes = computed(() => Math.ceil(timeLimitSeconds.value * maximumStages(involvedPresets.value, workspace === 'castellan') / 60))
const blockedReason = computed(() => {
  if (configurationIssue.value) return configurationIssue.value
  if (!ready.value || running.value) return ''
  if (reoptimizing.value && !targetCommanders.value.length) return '再最適化する対象を選んでください。'
  if (!reoptimizing.value && !freePositions.value) return '空き枠がありません。再最適化モードを選んでください。'
  const missing = availableSlots.value.filter(slot => !slot.available).map(slot => SLOT_LABELS[slot.slot])
  if (missing.length) return missing.join('・') + 'の使用可能な装備がありません。装備を登録するか、再最適化で使用中の装備を対象に含めてください。'
  if (!plannedJobs.value.length) return 'プリセットまたは不足分のある作成計画を選んでください。'
  return ''
})

function applyRequestedMode() {
  const requestedPresetId = typeof route.query.presetId === 'string' ? route.query.presetId : ''
  const requestedPreset = presets.value.find(p => p.id === requestedPresetId)
  if (requestedPreset) selected.value = requestedPreset.id
  if (route.query.mode === 'new') allocationMode.value = 'new'
  else if (route.query.mode === 'single' || requestedPreset) allocationMode.value = 'single'
  else if (route.query.mode === 'all') allocationMode.value = 'all'
}
watch(() => [route.query.presetId, route.query.mode], () => {
  if (!running.value && !committing.value && !saving.value) applyRequestedMode()
})
async function refreshAvailability() {
  ;[existingCommanders.value, equipmentAllocations.value, gemAllocations.value] = await Promise.all([
    db.repo('commanders').getAll(), db.repo('equipmentAllocations').getAll(), db.repo('gemAllocations').getAll(),
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
    ready.value = true
  } catch (error) { message.value = String(error) }
})
async function saveResult() {
  if (running.value || saving.value || !result.value || !preset.value) return
  saving.value = true; message.value = ''; saved.value = ''
  try {
    const build = await saveCommander(db, commanderName.value, preset.value.id, result.value, previewInputs)
    saved.value = '「' + build.name + '」を保存しました。装備・ジェムは使用中として確保されます。'
    result.value = null
    outcome.value = null
    await refreshAvailability()
    await app.refreshCounts(db)
  } catch (e) { message.value = String(e) } finally { saving.value = false }
}
async function run() {
  if (!canRun.value) return
  running.value = true; message.value = ''; saved.value = ''; result.value = null
  outcome.value = null; searchProgress.value = null;
  batchResults.value = []; cpSatPreview.value = []; cpSatStatus.value = ''; cpSatUpperBound.value = null; zeroDiagnostics.value = []; missingSlots.value = []
  controller.value = new AbortController()
  try {
    const [commanders, usedEq, usedGem, currentEquipment, currentGems, currentStats, currentPresets] = await Promise.all([
      db.repo('commanders').getAll(), db.repo('equipmentAllocations').getAll(), db.repo('gemAllocations').getAll(),
      db.repo('equipment').getAll(), db.repo('gems').getAll(), db.repo('stats').getAll(), db.repo('presets').getAll()
    ])
    existingCommanders.value = commanders
    equipmentAllocations.value = usedEq
    gemAllocations.value = usedGem
    equipment.value = currentEquipment
    gems.value = currentGems
    stats.value = currentStats
    presets.value = currentPresets
    const targets = targetCommanders.value
    const freePositions = Math.max(0, MAX_COMMANDERS - commanders.length)
    if (!reoptimizing.value && !freePositions) {
      message.value = roleLabel + 'の空き番号がありません。'
      return
    }
    if (reoptimizing.value && !targets.length) {
      message.value = '再最適化する' + roleLabel + 'がありません。対象を選ぶか、ロックを解除してください。'; return
    }
    const chosenPreset = preset.value
    const jobs = plannedJobs.value
    if (!jobs.length) { message.value = '最適化対象がありません'; return }
    const releasedIds = new Set(targets.map(c => c.id))
    const reservedEq = usedEq.filter(a => !releasedIds.has(a.commanderBuildId))
    const reservedGem = usedGem.filter(a => !releasedIds.has(a.commanderBuildId))
    const input = {
      jobs, equipment: equipment.value, gems: gems.value, stats: stats.value,
      reservedEquipmentIds: reservedEq.map(a => a.equipmentId),
      reservedGemIds: reservedGem.map(a => a.gemId),
      maxAchieved: allocationMode.value === 'new' ? freePositions : undefined,
    }
    previewInputs = { equipment: currentEquipment, gems: currentGems, stats: currentStats, presets: currentPresets }
    const response = await optimizeCpSat({
      ...input, castellan: workspace === 'castellan', timeLimitSeconds: timeLimitSeconds.value, signal: controller.value.signal,
      endpoint: executionMode.value === 'local' ? localEndpoint : cpSatEndpoint,
      local: executionMode.value === 'local',
      onProgress: (text: string) => { progress.value = text },
      onSearchProgress: value => { searchProgress.value = value },
    })
    outcome.value = response
    if (response.achieved === 0) {
      missingSlots.value = availableSlots.value.filter(s => !s.available).map(s => SLOT_LABELS[s.slot])
      zeroDiagnostics.value = targetChecks.value.map(t => ({ ...t, stat: statName(t.statId) }))
    }
    if (allocationMode.value === 'new' && response.builds.length > freePositions) {
      throw Error('最適化サーバーを最新版に更新してから再実行してください。結果が' + roleLabel + 'の空き枠を超えています。')
    }
    if (singleBuild.value) {
      result.value = response.builds[0]?.result ?? null
      if (result.value) commanderName.value = (chosenPreset?.name ?? roleLabel) + ' ' + new Date().toLocaleDateString('ja-JP')
      else message.value = response.optimal ? '最低目標と必須装備条件を満たす構成がありません。' : '制限時間内に条件を満たす構成が見つかりませんでした。'
      return
    }
    previewInputs = { equipment: currentEquipment, gems: currentGems, stats: currentStats, presets: currentPresets }
    cpSatPreview.value = response.builds
    cpSatStatus.value = response.status
    cpSatOptimal.value = response.optimal
    cpSatUpperBound.value = response.upperBound ?? null
    if (!response.achieved) message.value = response.optimal ? '条件を満たす構成がありません。下の診断を確認してください。' : '制限時間内に構成が見つかりませんでした。時間を長くして再実行できます。'
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
    const entries = cpSatPreview.value.map(entry => ({
      name: `${entry.job.preset.name} ${entry.job.ordinal}`, presetId: entry.job.preset.id, result: entry.result,
    }))
    await saveCommanders(db, entries, previewInputs)
    batchResults.value = cpSatPreview.value.map((entry, index) => ({
      name: entries[index].name, preset: entry.job.preset.name, result: entry.result,
    }))
    count = entries.length
    saved.value = `${count}体の${roleLabel}を保存しました`
    cpSatPreview.value = []
    await refreshAvailability()
    await app.refreshCounts(db)
  } catch (e) {
    cpSatPreview.value = []
    message.value = `保存できませんでした。今回の変更は保存されていません：${String(e)}。再最適化してください。`
    await app.refreshCounts(db)
  } finally { committing.value = false }
}

</script>
<template>
  <header class="mb-4">
    <h2 class="text-h5">{{ roleLabel }}の最適化</h2>
    <p class="text-body-2 text-medium-emphasis mt-1">1. 対象と目標を選ぶ → 2. 組み合わせを探す → 3. 比較して保存</p>
  </header>
  <v-card v-if="ready" variant="outlined" class="pa-4">
    <h3 class="text-subtitle-1 font-weight-bold mb-3">1. 対象と目標</h3>
    <v-select v-model="allocationMode" :disabled="running || committing || saving"
      :items="[
        { title: '1体だけ作る', value: 'single' },
        { title: '作成計画の不足分をまとめて作る', value: 'new' },
        { title: '指定' + roleLabel + 'を再最適化', value: 'selected' },
        { title: roleLabel + '全体を再最適化（ロック中は除外）', value: 'all' },
      ]" label="最適化モード" />
    <v-select v-if="singleBuild && presets.length" v-model="selected" :disabled="running || saving"
      :items="presets.map(p => ({ title: p.name, value: p.id }))" label="ビルドプリセット" />
    <div v-if="singleBuild && preset" class="d-flex flex-wrap ga-2 mb-3">
      <v-chip v-for="target in preset.targets" :key="target.statId" size="small">
        {{ effectText(target.statId, target.minValue) }}以上
      </v-chip>
      <span v-if="!preset.targets.length" class="text-body-2">最低目標の設定はありません。</span>
    </div>
    <div v-if="involvedPresets.length" class="mb-4 pa-3 rounded bg-grey-lighten-4">
      <div v-for="p in involvedPresets" :key="p.id" class="mb-2">
        <strong class="text-body-2">{{ p.name }}</strong>
        <p class="text-caption">{{ objectiveDescription(p, workspace === 'castellan') }}</p>
      </div>
      <v-btn size="small" variant="text" :disabled="running"  :to="{ path: '/presets', query: singleBuild ? { edit: selected } : {} }">目標・加点効果を編集</v-btn>
    </div>
    <v-alert v-if="singleBuild && !presets.length" type="warning" variant="tonal" class="mb-3">
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
      <p class="text-body-2 mb-2">使用可能な装備（4部位に各1件以上必要）・ジェム {{ availableGems.length }}個</p>
      <EquipmentAvailability :slots="availableSlots" />
    </template>
    <v-alert v-if="!reoptimizing && !freePositions" type="warning" variant="tonal" class="mt-3">
      管理枠が埋まっています。既存の構成を使う場合は再最適化を選んでください。
    </v-alert>
    <v-alert v-if="executionMode === 'local'" type="info" variant="tonal" class="mt-3">
      このPCでPython最適化サーバーを起動してください。
      <a href="https://github.com/takumi307/ggetool/blob/main/optimizer-service/LOCAL_WINDOWS.md" target="_blank" rel="noopener">起動手順</a>
    </v-alert>
    <v-alert v-if="configurationIssue" type="error" variant="tonal" class="mt-3">{{ configurationIssue }}</v-alert>
    <v-alert v-if="impossibleTargets.length || missingRequirements.length" type="warning" variant="tonal" class="mt-3">
      <strong>実行前の条件確認</strong>
      <div v-for="t in impossibleTargets" :key="t.preset + t.statId">
        {{ t.preset }}：{{ statName(t.statId) }}の目標 {{ t.required }} に対して、登録済み候補の上限は {{ Number(t.optimistic.toFixed(3)) }}。
      </div>
      <div v-for="issue in missingRequirements" :key="issue">{{ issue }}</div>
      <p class="text-caption mt-1">該当する条件では達成できません。他のプリセットも含めて探索することはできます。</p>
    </v-alert>
    <p v-if="plannedJobs.length" class="text-body-2 mt-3">
      対象 {{ plannedJobs.length }}体 ／ 装備数・空き枠から作れる上限 {{ inventoryBound }}体
      <span class="text-caption">（効果の条件を考慮すると減る場合があります）</span>
    </p>
    <section class="mt-4" aria-label="計算設定">
      <h3 class="text-subtitle-1 font-weight-bold mb-2">2. 計算設定</h3>
      <v-row dense>
        <v-col cols="12" sm="6">
          <v-select v-model="executionMode" :disabled="running || committing || saving" :items="executionOptions"
            label="最適化の実行先" density="comfortable" />
        </v-col>
        <v-col cols="12" sm="6">
          <v-select v-model="timeLimitSeconds" :disabled="running || committing || saving" :items="timeOptions"
            label="計算時間（各段階）" density="comfortable" />
        </v-col>
      </v-row>
      <p class="text-caption mb-3">探索は最大 {{ maximumStages(involvedPresets, workspace === 'castellan') }}段階、計算時間の目安は最大 {{ estimatedMinutes }}分＋起動・通信時間です。より良い構成を探す場合は時間を長くしてください。</p>
    </section>
    <p v-if="blockedReason" class="text-body-2 mb-3" role="status">{{ blockedReason }}</p>
    <div class="d-flex align-center ga-2 flex-wrap">
      <v-btn color="primary" :disabled="!canRun" :loading="running" @click="run">{{ singleBuild ? '最適化を実行' : reoptimizing ? 'CP-SATで再最適化' : 'CP-SATで新規作成' }}</v-btn>
      <v-btn v-if="running" color="warning" variant="outlined" @click="controller?.abort()">待機を中断</v-btn>
    </div>
  </v-card>
  <v-progress-linear v-else-if="!message" indeterminate />
  <v-card v-if="running" class="pa-4 mt-3" role="status" aria-live="polite">
    <h3 class="text-subtitle-1 mb-2">{{ searchProgress ? STAGE_LABELS[searchProgress.stage] ?? searchProgress.stage : '計算の準備' }}</h3>
    <p>{{ progress }}</p>
    <p v-if="searchProgress" class="text-body-2 mt-2">
      第 {{ searchProgress.stageIndex }} / {{ searchProgress.stageCount }}段階 ／ 発見 {{ searchProgress.achieved }}体・人数の上限 {{ searchProgress.upperBound }}体
    </p>
    <v-progress-linear indeterminate color="primary" class="mt-3" />
  </v-card>
  <v-card v-if="outcome && !running" class="pa-4 mt-3">
    <h3 class="text-subtitle-1 font-weight-bold mb-3">3. 探索結果を確認</h3>
    <OptimizationSummary :outcome="outcome" />
  </v-card>
  <v-card v-if="cpSatPreview.length" class="pa-4 mt-3">
    <h3 class="text-subtitle-1 mb-2">CP-SAT最適化結果（{{ cpSatPreview.length }}体）</h3>

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
          <BuildStatsPreview :result="entry.result" :previous="existingCommanders.find(c => c.id === entry.job.commanderId)" :equipment="equipment" :gems="gems" :stats="stats" />
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
    <div class="text-caption mt-2">全項目が「可能性あり」でも、複数条件の同時達成や装備・ジェムの重複禁止によって0体になる場合があります。設定値を自動変更することはありません。</div>
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
          <v-chip :color="entry.result.approximate ? 'warning' : 'success'" size="small">{{ entry.result.approximate ? "暫定解" : "最適性証明済み" }}</v-chip>
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
      {{ result.approximate ? '暫定解（最適性未証明）' : '最適性証明済み' }}
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
      <BuildStatsPreview :result="result" :equipment="equipment" :gems="gems" :stats="stats" />
    </v-card>
  </template>
</template>
