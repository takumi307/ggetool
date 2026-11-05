<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useDb, useAppStore } from '@/stores/app'
import { saveCommander } from '@/domain/commanderService'
import { SLOT_TYPES, SLOT_LABELS, type BuildPreset, type Equipment, type Gem, type StatDefinition } from '@/domain'
import { optimizeSingle, type OptimizationResult, type OptimizerMode } from '@/domain/optimizer'
const app = useAppStore()
const commanderName = ref(''), saved = ref(''), saving = ref(false)
const mode = ref<OptimizerMode>('auto')
const modeOptions = [{ title: '自動（推奨）', value: 'auto' }, { title: '高精度', value: 'precise' }, { title: '高速', value: 'fast' }]
const presets = ref<BuildPreset[]>([]), equipment = ref<Equipment[]>([]), gems = ref<Gem[]>([]), stats = ref<StatDefinition[]>([])
const selected = ref(''), result = ref<OptimizationResult | null>(null), message = ref(''), running = ref(false)
const preset = computed(() => presets.value.find(p => p.id === selected.value))
const statName = (id: string) => stats.value.find(s => s.id === id)?.name ?? id
const eqName = (id?: string) => equipment.value.find(e => e.id === id)?.name ?? '未選択'
const gemName = (id?: string) => gems.value.find(g => g.id === id)?.name ?? 'なし'
onMounted(async () => {
  const db = useDb()
  ;[presets.value, equipment.value, gems.value, stats.value] = await Promise.all([
    db.repo('presets').getAll(), db.repo('equipment').getAll(), db.repo('gems').getAll(), db.repo('stats').getAll()
  ])
  selected.value = presets.value[0]?.id ?? ''
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
</script>
<template>
  <h2 class="text-h6 mb-3">司令官1体の最適化（Phase 3）</h2>
  <v-alert type="info" variant="tonal" class="mb-4">4部位の装備と、各部位に最大1個のジェムを組み合わせます。装備・ジェムは重複使用しません。目標達成を優先し、その後に指定した効果を優先順位順で比較します。</v-alert>
  <v-select v-model="selected" :items="presets.map(p => ({ title: p.name, value: p.id }))" label="ビルドプリセット" />
  <v-alert v-if="!presets.length" type="warning" class="mb-3">プリセットが登録されていません。先にプリセットを登録してください。</v-alert>
  <v-select v-model="mode" :items="modeOptions" label="最適化方法" hint="高速は暫定解。高精度も探索上限到達時は暫定解です。" persistent-hint class="mb-3" />
  <v-btn color="primary" :disabled="!preset || running" :loading="running" @click="run">最適化を実行</v-btn>
  <v-alert v-if="message" type="warning" class="mt-4">{{ message }}</v-alert>
  <v-alert v-if="saved" type="success" class="mt-4">{{ saved }} <router-link to="/commanders">保存済み司令官を確認</router-link></v-alert>
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
        <div class="text-caption">ジェム：{{ gemName(result.gemAssignments.find(a => a.slotType === slot)?.gemId) }}</div>
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
