<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { canonicalStatId } from '@/domain/statAliases'
import { useRoute } from 'vue-router'
import { useDb, useAppStore } from '@/stores/app'
import { saveCommander, commanderNumber, replaceCommanderAssignments } from '@/domain/commanderService'
import { optimizeCpSat, cpSatEndpoint, type CpSatBuild } from '@/domain/cpSatClient'
import { SLOT_TYPES, SLOT_LABELS, type BuildPreset, type BuildPlan, type Equipment, type Gem, type StatDefinition, type SlotType, type CommanderBuild } from '@/domain'
import { optimizeSingle, type OptimizationResult, type OptimizerMode } from '@/domain/optimizer'
const app = useAppStore()
const route = useRoute()
const commanderName = ref(''), saved = ref(''), saving = ref(false)
const plans = ref<BuildPlan[]>([])
const progress = ref('')
const batchResults = ref<{ name: string; preset: string; result: OptimizationResult }[]>([])
const cpSatPreview = ref<CpSatBuild[]>([])
const cpSatStatus = ref('')
const zeroDiagnostics = ref<{ preset: string; stat: string; required: number; optimistic: number; impossible: boolean }[]>([])
const missingSlots = ref<string[]>([])
const cpSatOptimal = ref(false)
const cpSatUpperBound = ref<number | null>(null)
const timeLimitSeconds = ref(60)
const executionMode = ref<'render' | 'local'>('render')
const localEndpoint = 'http://127.0.0.1:8765'
const controller = ref<AbortController | null>(null)
const committing = ref(false)
const allocationMode = ref<'new' | 'selected' | 'all'>('new')
const existingCommanders = ref<CommanderBuild[]>([])
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
const commanderChoices = computed(() => eligibleCommanders.value.map(c => ({
  title: '司令官 ' + (commanderNumber(c, existingCommanders.value) ?? '未設定') + '：' + c.name, value: c.id
})))

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
  existingCommanders.value = await db.repo('commanders').getAll()
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
  batchResults.value = []; cpSatPreview.value = []; cpSatStatus.value = ''; cpSatUpperBound.value = null; zeroDiagnostics.value = []; missingSlots.value = []
  controller.value = new AbortController()
  try {
    const db = useDb()
    const [commanders, usedEq, usedGem] = await Promise.all([
      db.repo('commanders').getAll(), db.repo('equipmentAllocations').getAll(), db.repo('gemAllocations').getAll()
    ])
    existingCommanders.value = commanders
    const targetCommanders = allocationMode.value === 'all'
      ? eligibleCommanders.value
      : allocationMode.value === 'selected'
        ? eligibleCommanders.value.filter(c => selectedCommanderIds.value.includes(c.id))
        : []
    if (allocationMode.value !== 'new' && !targetCommanders.length) {
      message.value = '再最適化する司令官がありません。対象を選ぶか、ロックを解除してください。'; return
    }
    const jobs = allocationMode.value === 'new'
      ? activePlans.value.flatMap(plan => {
          const chosen = presets.value.find(p => p.id === plan.presetId)
          if (!chosen) return []
          const done = commanders.filter(c => c.presetId === chosen.id).length
          return Array.from({ length: Math.min(100, Math.max(0, plan.count - done)) },
            (_, index) => ({ preset: chosen, ordinal: done + index + 1, priority: plan.priority }))
        }).slice(0, 100)
      : targetCommanders.map((c, index) => ({
          preset: presets.value.find(p => p.id === c.presetId)!,
          ordinal: index + 101,
          priority: activePlans.value.find(p => p.presetId === c.presetId)?.priority ?? 1,
          commanderId: c.id,
          previousEquipmentIds: c.equipmentIds,
          previousGemIds: c.gemAssignments.map(a => a.gemId)
        }))
    if (!jobs.length) { message.value = '最適化対象がありません'; return }
    if (executionMode.value === 'local') {
      try {
        const check = await fetch(localEndpoint + '/health', { signal: controller.value.signal })
        if (!check.ok) throw new Error('HTTP ' + check.status)
      } catch {
        throw new Error('PC内の最適化サーバーに接続できません。ローカルサーバーを起動し、CORS_ORIGINSにこのサイトのURLを設定してください。')
      }
    }
    const releasedIds = new Set(targetCommanders.map(c => c.id))
    const reservedEq = usedEq.filter(a => !releasedIds.has(a.commanderBuildId))
    const reservedGem = usedGem.filter(a => !releasedIds.has(a.commanderBuildId))
    progress.value = `CP-SATで${jobs.length}体の装備配分を計算中（最大${timeLimitSeconds.value}秒/段階）。通信は短時間の状況確認に切り替えます`
    const response = await optimizeCpSat({
      jobs, equipment: equipment.value, gems: gems.value, stats: stats.value,
      reservedEquipmentIds: reservedEq.map(a => a.equipmentId),
      reservedGemIds: reservedGem.map(a => a.gemId),
      timeLimitSeconds: timeLimitSeconds.value,
      signal: controller.value.signal,
      endpoint: executionMode.value === 'local' ? localEndpoint : cpSatEndpoint,
      onProgress: (text: string) => { progress.value = text }
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
        const optimistic = Math.min(equipmentMax, capMap.get(id) ?? Infinity) + gemMax
        return { preset: p.name, stat: statName(t.statId), required: t.minValue, optimistic, impossible: optimistic + 1e-8 < t.minValue }
      }))
    }
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
    if (allocationMode.value !== 'new') {
      if (cpSatPreview.value.length !== (allocationMode.value === 'all' ? eligibleCommanders.value.length : eligibleCommanders.value.filter(c => selectedCommanderIds.value.includes(c.id)).length))
        throw Error('すべての対象司令官が目標を達成していません。部分的な再配分は保存できません。')
      await replaceCommanderAssignments(db, cpSatPreview.value.map(entry => ({
        commanderId: entry.job.commanderId!,
        equipmentIds: entry.result.equipmentIds,
        gemAssignments: entry.result.gemAssignments,
        calculatedStats: { ...entry.result.totals, _approximate: entry.result.approximate },
        expectedEquipmentIds: existingCommanders.value.find(c => c.id === entry.job.commanderId)!.equipmentIds,
        expectedGemAssignments: existingCommanders.value.find(c => c.id === entry.job.commanderId)!.gemAssignments
      })))
      saved.value = `${cpSatPreview.value.length}体を一括更新しました（変更した装備・ジェムの割当：${movedItems.value}箇所）`
      cpSatPreview.value = []
      existingCommanders.value = await db.repo('commanders').getAll()
      await app.refreshCounts()
      return
    }
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
  <v-alert v-if="activePlans.length" type="info" variant="tonal" class="mb-3">有効な計画の不足分（最大100体）をCP-SATで同時に最適化します。計算結果を確認してから保存できます。OPTIMALは最適性証明済み、FEASIBLEは暫定解です。通常モードでは既存の司令官は変更しません。</v-alert>
  <v-select v-if="activePlans.length" v-model="allocationMode"
    :items="[{title:'新規作成（既存装備を保護）',value:'new'},{title:'指定司令官を再最適化',value:'selected'},{title:'司令官全体を再最適化（ロック中は除外）',value:'all'}]"
    label="最適化モード" class="mb-3" />
  <v-select v-if="activePlans.length && allocationMode === 'selected'" v-model="selectedCommanderIds" :items="commanderChoices"
    label="再最適化する司令官（複数選択）" multiple chips closable-chips class="mb-3" />
  <v-alert v-if="activePlans.length && allocationMode !== 'new'" type="warning" variant="tonal" class="mb-3">
    既存司令官の武具・ジェムを含めて再配分します。ロック中の司令官は変更しません。
    全員が目標達成した場合のみ一括保存できます。途中の結果は既存データを変更しません。
  </v-alert>
  <v-select v-model="selected" :disabled="activePlans.length > 0" :items="presets.map(p => ({ title: p.name, value: p.id }))" label="ビルドプリセット" />
  <v-alert v-if="!presets.length" type="warning" class="mb-3">プリセットが登録されていません。先にプリセットを登録してください。</v-alert>
  <v-alert v-if="activePlans.length && executionMode === 'render' && !cpSatEndpoint" type="warning" variant="tonal" class="mb-3">CP-SATサーバーが未設定です。VITE_OPTIMIZER_API_URLをCloudflareのビルド環境に設定してください。</v-alert>
  <v-select v-if="!activePlans.length" v-model="mode" :items="modeOptions" label="最適化方法" hint="高速は暫定解。高精度も探索上限到達時は暫定解です。" persistent-hint class="mb-3" />
  <v-select v-if="activePlans.length" v-model="executionMode" :items="[{ title: 'Render（クラウド）', value: 'render' }, { title: 'このPC（ローカルCP-SAT）', value: 'local' }]" label="最適化の実行先" class="mb-3" />
  <v-alert v-if="activePlans.length && executionMode === 'local'" type="info" variant="tonal" class="mb-3">PCにPython版の最適化サーバーを起動してください（127.0.0.1:8765）。計算はこのPCで実行し、装備データはRenderに送信しません。セットアップ手順は optimizer-service/LOCAL_WINDOWS.md を参照してください。</v-alert>
  <v-select v-if="activePlans.length" v-model="timeLimitSeconds" :items="executionMode === 'local' ? [{ title: '1分', value: 60 }, { title: '5分', value: 300 }, { title: '10分', value: 600 }, { title: '30分', value: 1800 }] : [{ title: '30秒', value: 30 }, { title: '1分', value: 60 }, { title: '5分', value: 300 }]" label="CP-SAT計算時間（各段階）" class="mb-3" />
  <div class="d-flex align-center ga-2 flex-wrap">
    <v-btn color="primary" :disabled="(!preset && !activePlans.length) || (activePlans.length > 0 && executionMode === 'render' && !cpSatEndpoint) || running" :loading="running" @click="run">{{ activePlans.length ? (allocationMode === 'new' ? 'CP-SATで新規作成' : 'CP-SATで再最適化') : '最適化を実行' }}</v-btn>
    <v-btn v-if="running && activePlans.length" color="warning" variant="outlined" @click="controller?.abort()">待機を中断</v-btn>
  </div>
  <v-alert v-if="progress" type="info" class="mt-3">{{ progress }}</v-alert>
  <v-card v-if="cpSatPreview.length" class="pa-4 mt-3">
    <h3 class="text-subtitle-1 mb-2">CP-SAT最適化結果（{{ cpSatPreview.length }}体）</h3>
    <v-chip :color="cpSatOptimal ? 'success' : 'warning'" class="mb-3">{{ cpSatOptimal ? 'OPTIMAL：最適性証明済み' : cpSatStatus + '：暫定解' }}</v-chip>
    <div v-if="cpSatUpperBound !== null" class="mb-3">達成 {{ cpSatPreview.length }}体 ／ 理論上の上限 {{ cpSatUpperBound }}体 <span class="text-medium-emphasis">（差 {{ Math.max(0, cpSatUpperBound - cpSatPreview.length) }}体）</span></div>
    <v-alert v-if="allocationMode !== 'new'" type="info" variant="tonal" class="mb-3">
      現在の構成から変更する装備・ジェム：{{ movedItems }}箇所。
      {{ cpSatPreview.length }}体の結果を確認してから一括更新します。
    </v-alert>
    <div><v-btn color="primary" :loading="committing" :disabled="running || (allocationMode !== 'new' && cpSatPreview.length !== (allocationMode === 'all' ? eligibleCommanders.length : eligibleCommanders.filter(c=>selectedCommanderIds.includes(c.id)).length))" @click="saveCpSat">
      {{ allocationMode === 'new' ? 'この' + cpSatPreview.length + '体を保存' : '全' + cpSatPreview.length + '体を安全に一括更新' }}
    </v-btn></div>
    <v-expansion-panels variant="accordion" class="mt-3">
      <v-expansion-panel v-for="(entry, index) in cpSatPreview" :key="index" :title="entry.job.commanderId ? '司令官 ' + (commanderNumber(existingCommanders.find(c=>c.id===entry.job.commanderId)!, existingCommanders) ?? '未設定') + '：' + entry.job.preset.name : entry.job.preset.name + ' ' + entry.job.ordinal">
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
