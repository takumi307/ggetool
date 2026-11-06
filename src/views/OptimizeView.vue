<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useDb, useAppStore } from '@/stores/app'
import { saveCommander } from '@/domain/commanderService'
import { optimizeCpSat, cpSatEndpoint, type CpSatBuild } from '@/domain/cpSatClient'
import { SLOT_TYPES, SLOT_LABELS, type BuildPreset, type BuildPlan, type Equipment, type Gem, type StatDefinition, type SlotType } from '@/domain'
import { optimizeSingle, type OptimizationResult, type OptimizerMode } from '@/domain/optimizer'
const app = useAppStore()
const route = useRoute()
const commanderName = ref(''), saved = ref(''), saving = ref(false)
const plans = ref<BuildPlan[]>([])
const progress = ref('')
const batchResults = ref<{ name: string; preset: string; result: OptimizationResult }[]>([])
const cpSatPreview = ref<CpSatBuild[]>([])
const cpSatStatus = ref('')
const cpSatOptimal = ref(false)
const cpSatUpperBound = ref<number | null>(null)
const timeLimitSeconds = ref(60)
const controller = ref<AbortController | null>(null)
const committing = ref(false)
const activePlans = computed(() => plans.value.filter(p => p.enabled).sort((a,b) => a.priority - b.priority))
const mode = ref<OptimizerMode>('auto')
const modeOptions = [{ title: '自動（推奨）', value: 'auto' }, { title: '高精度', value: 'precise' }, { title: '高速', value: 'fast' }]
const presets = ref<BuildPreset[]>([]), equipment = ref<Equipment[]>([]), gems = ref<Gem[]>([]), stats = ref<StatDefinition[]>([])
const selected = ref(''), result = ref<OptimizationResult | null>(null), message = ref(''), running = ref(false)
const preset = computed(() => presets.value.find(p => p.id === selected.value))
const statName = (id: string) => stats.value.find(s => s.id === id)?.name ?? id
const eqName = (id?: string) => equipment.value.find(e => e.id === id)?.name ?? '未選択'
const gemName = (id?: string) => gems.value.find(g => g.id === id)?.name ?? 'なし'
const effectText = (id: string, value: number) => `${statName(id)}：${value}${stats.value.find(s => s.id === id)?.unit ?? '%'}`
const itemEffects = (slot: SlotType, r: OptimizationResult) => equipment.value.find(e => e.id === r.equipmentIds[slot])?.effects ?? []
const gemEffects = (slot: SlotType, r: OptimizationResult) => gems.value.find(g => g.id === r.gemAssignments.find(a => a.slotType === slot)?.gemId)?.effects ?? []
onMounted(async () => {
  const db = useDb()
  ;[presets.value, equipment.value, gems.value, stats.value, plans.value] = await Promise.all([
    db.repo('presets').getAll(), db.repo('equipment').getAll(), db.repo('gems').getAll(), db.repo('stats').getAll(), db.repo('plans').getAll()
  ])
  const requestedPresetId = typeof route.query.presetId === 'string' ? route.query.presetId : ''
  selected.value = presets.value.some(p => p.id === requestedPresetId) ? requestedPresetId : (presets.value[0]?.id ?? '')
  const settings = await db.repo('settings').get('app')
  if (settings?.optimizerId === 'precise' || settings?.optimizerId === 'fast') mode.value = settings.optimizerId
})
async function saveResult() {
  if (!result.value || !preset.value) return
  saving.value = true; message.value = ''; saved.value = ''
  try {
    const build = await saveCommander(useDb(), commanderName.value, preset.value.id, result.value)
    saved.value = '「' + build.name + '」を保存しました。装備・ジェムは使用中として確保されます。'
    result.value = null
    await app.refreshCounts()
  } catch (e) { message.value = String(e) } finally { saving.value = false }
}
async function run() {
  if (activePlans.value.length) { await runPlans(); return }
  if (!preset.value) return
  running.value = true; message.value = ''; saved.value = ''; result.value = null
  try {
    const db = useDb()
    const [usedEq, usedGem] = await Promise.all([
      db.repo('equipmentAllocations').getAll(), db.repo('gemAllocations').getAll()
    ])
    // Yield once to let the progress indicator render.
    await new Promise(resolve => setTimeout(resolve, 0))
    result.value = optimizeSingle({
      equipment: equipment.value, gems: gems.value, stats: stats.value, preset: preset.value,
      reservedEquipmentIds: usedEq.map(a => a.equipmentId), reservedGemIds: usedGem.map(a => a.gemId),
      mode: mode.value
    })
    if (!result.value) message.value = '各部位に未使用の装備が1件以上必要です'
    else commanderName.value = (preset.value?.name ?? '司令官') + ' ' + new Date().toLocaleDateString('ja-JP')
  } catch (e) { message.value = String(e) } finally { running.value = false }
}
async function runPlans() {
  if (running.value) return
  running.value = true; message.value = ''; saved.value = ''; result.value = null
  batchResults.value = []; cpSatPreview.value = []; cpSatStatus.value = ''; cpSatUpperBound.value = null
  controller.value = new AbortController()
  try {
    const db = useDb()
    const [commanders, usedEq, usedGem] = await Promise.all([
      db.repo('commanders').getAll(), db.repo('equipmentAllocations').getAll(), db.repo('gemAllocations').getAll()
    ])
    const jobs = activePlans.value.flatMap(plan => {
      const preset = presets.value.find(p => p.id === plan.presetId)
      if (!preset) return []
      const done = commanders.filter(c => c.presetId === preset.id).length
      return Array.from({ length: Math.min(100, Math.max(0, plan.count - done)) },
        (_, index) => ({ preset, ordinal: done + index + 1, priority: plan.priority }))
    }).slice(0, 100)
    if (!jobs.length) { message.value = '最適化対象がありません'; return }
    progress.value = `CP-SATで${jobs.length}体の装備配分を計算中（最大${timeLimitSeconds.value}秒/段階）。通信は短時間の状況確認に切り替えます`
    const response = await optimizeCpSat({
      jobs, equipment: equipment.value, gems: gems.value, stats: stats.value,
      reservedEquipmentIds: usedEq.map(a => a.equipmentId),
      reservedGemIds: usedGem.map(a => a.gemId),
      timeLimitSeconds: timeLimitSeconds.value,
      signal: controller.value.signal,
      onProgress: (text: string) => { progress.value = text }
    })
    cpSatPreview.value = response.builds
    cpSatStatus.value = response.status
    cpSatOptimal.value = response.optimal
    cpSatUpperBound.value = response.upperBound ?? null
    message.value = `${response.achieved} / ${response.requested}体が目標達成。理論上の上限：${response.upperBound ?? '算出不可'}体。判定：${response.optimal ? 'OPTIMAL（最適性証明済み）' : response.status + '（最適性未証明）'}。内容を確認して保存してください。`
  } catch (e) {
    message.value = e instanceof Error && e.name === 'AbortError'
      ? '画面での待機を中断しました。サーバー側の計算は継続する場合があります。保存はしていません。'
      : String(e)
  } finally { running.value = false; progress.value = ''; controller.value = null }
}
async function saveCpSat() {
  if (committing.value || !cpSatPreview.value.length) return
  committing.value = true; message.value = ''; saved.value = ''
  let count = 0
  try {
    const db = useDb()
    for (const entry of cpSatPreview.value) {
      const name = `${entry.job.preset.name} ${entry.job.ordinal}`
      await saveCommander(db, name, entry.job.preset.id, entry.result)
      batchResults.value.push({ name, preset: entry.job.preset.name, result: entry.result })
      count++
    }
    saved.value = `${count}体の司令官を保存しました`
    cpSatPreview.value = []
    await app.refreshCounts()
  } catch (e) {
    cpSatPreview.value = []
    message.value = `${count}体を保存したところで停止しました：${String(e)}。再最適化してください。`
    await app.refreshCounts()
  } finally { committing.value = false }
}

</script>
<template>
  <h2 class="text-h6 mb-3">司令官の最適化</h2>
  <v-alert type="info" variant="tonal" class="mb-4">4部位の装備と、各部位に最大1個のジェムを組み合わせます。装備・ジェムは重複使用しません。目標達成を優先し、その後に指定した効果を優先順位順で比較します。</v-alert>
  <v-alert v-if="activePlans.length" type="info" variant="tonal" class="mb-3">有効な計画の不足分（最大100体）をCP-SATで同時に最適化します。計算結果を確認してから保存できます。OPTIMALは最適性証明済み、FEASIBLEは暫定解です。既存の司令官は変更しません。</v-alert>
  <v-select v-model="selected" :disabled="activePlans.length > 0" :items="presets.map(p => ({ title: p.name, value: p.id }))" label="ビルドプリセット" />
  <v-alert v-if="!presets.length" type="warning" class="mb-3">プリセットが登録されていません。先にプリセットを登録してください。</v-alert>
  <v-alert v-if="activePlans.length && !cpSatEndpoint" type="warning" variant="tonal" class="mb-3">CP-SATサーバーが未設定です。VITE_OPTIMIZER_API_URLをCloudflareのビルド環境に設定してください。</v-alert>
  <v-select v-if="!activePlans.length" v-model="mode" :items="modeOptions" label="最適化方法" hint="高速は暫定解。高精度も探索上限到達時は暫定解です。" persistent-hint class="mb-3" />
  <v-select v-if="activePlans.length" v-model="timeLimitSeconds" :items="[{ title: '30秒', value: 30 }, { title: '1分', value: 60 }, { title: '5分', value: 300 }]" label="CP-SAT計算時間（各段階）" class="mb-3" />
  <div class="d-flex align-center ga-2 flex-wrap">
    <v-btn color="primary" :disabled="(!preset && !activePlans.length) || (activePlans.length > 0 && !cpSatEndpoint) || running" :loading="running" @click="run">{{ activePlans.length ? "CP-SATで全体最適化" : "最適化を実行" }}</v-btn>
    <v-btn v-if="running && activePlans.length" color="warning" variant="outlined" @click="controller?.abort()">待機を中断</v-btn>
  </div>
  <v-alert v-if="progress" type="info" class="mt-3">{{ progress }}</v-alert>
  <v-card v-if="cpSatPreview.length" class="pa-4 mt-3">
    <h3 class="text-subtitle-1 mb-2">CP-SAT最適化結果（{{ cpSatPreview.length }}体）</h3>
    <v-chip :color="cpSatOptimal ? 'success' : 'warning'" class="mb-3">{{ cpSatOptimal ? 'OPTIMAL：最適性証明済み' : cpSatStatus + '：暫定解' }}</v-chip>
    <div v-if="cpSatUpperBound !== null" class="mb-3">達成 {{ cpSatPreview.length }}体 ／ 理論上の上限 {{ cpSatUpperBound }}体 <span class="text-medium-emphasis">（差 {{ Math.max(0, cpSatUpperBound - cpSatPreview.length) }}体）</span></div>
    <div><v-btn color="primary" :loading="committing" :disabled="running" @click="saveCpSat">この{{ cpSatPreview.length }}体を保存</v-btn></div>
    <v-expansion-panels variant="accordion" class="mt-3">
      <v-expansion-panel v-for="(entry, index) in cpSatPreview" :key="index" :title="entry.job.preset.name + ' ' + entry.job.ordinal">
        <v-expansion-panel-text>
          <div v-for="slot in SLOT_TYPES" :key="slot" class="mb-2">
            <strong>{{ SLOT_LABELS[slot] }}：{{ eqName(entry.result.equipmentIds[slot]) }}</strong>
            <div v-for="(effect, i) in itemEffects(slot, entry.result)" :key="i" class="text-body-2">{{ effectText(effect.statId, effect.value) }}</div>
            <div>ジェム：{{ gemName(entry.result.gemAssignments.find(a => a.slotType === slot)?.gemId) }}</div>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </v-card>
  <v-alert v-if="message" type="warning" class="mt-4">{{ message }}</v-alert>
  <v-alert v-if="saved" type="success" class="mt-4">{{ saved }} <router-link to="/commanders">保存済み司令官を確認</router-link></v-alert>
  <v-card v-if="batchResults.length" class="pa-3 mt-4">
    <h3 class="text-subtitle-1 mb-2">今回作成した司令官（{{ batchResults.length }}体）</h3>
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
      <h3 class="text-subtitle-1 mb-2">結果を保存</h3>
      <v-text-field v-model="commanderName" label="司令官名" />
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
      <div v-for="(value, id) in result.totals" :key="id">{{ statName(String(id)) }}：{{ value }}</div>
      <v-alert v-if="result.overflow.length" type="warning" variant="tonal" class="mt-3">
        上限超過：{{ result.overflow.map(s => statName(s.statId) + ' ' + s.raw + ' / ' + s.cap).join('、') }}
      </v-alert>
    </v-card>
  </template>
</template>
