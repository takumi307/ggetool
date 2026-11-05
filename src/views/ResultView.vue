<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDb } from '@/stores/app'
import CommanderEquipmentPanel from '@/components/CommanderEquipmentPanel.vue'
import { type CommanderBuild, type Equipment, type Gem, type BuildPreset, type StatDefinition } from '@/domain'

const route = useRoute(), router = useRouter()
const builds = ref<CommanderBuild[]>([])
const equipment = ref<Equipment[]>([]), gems = ref<Gem[]>([]), presets = ref<BuildPreset[]>([]), stats = ref<StatDefinition[]>([])
const selectedId = ref(''), error = ref('')
const compareId = ref('')
const comparison = computed(() => builds.value.find(b => b.id === compareId.value))
const selected = computed(() => builds.value.find(b => b.id === selectedId.value))
const preset = computed(() => presets.value.find(p => p.id === selected.value?.presetId))
const statName = (id: string) => stats.value.find(s => s.id === id)?.name ?? id
const eqName = (id?: string) => equipment.value.find(e => e.id === id)?.name ?? '未登録'
const gemName = (id?: string) => id ? (gems.value.find(g => g.id === id)?.name ?? '未登録') : 'なし'
const numericStats = computed(() => Object.entries(selected.value?.calculatedStats ?? {})
  .filter(([key, value]) => !key.startsWith('_') && typeof value === 'number')
  .map(([id, value]) => {
    const cap = stats.value.find(s => s.id === id)
    const knownCap = cap?.capStatus === 'known' && cap.cap !== null ? cap.cap : null
    return { id, raw: value as number, effective: knownCap === null ? value as number : Math.min(value as number, knownCap), cap: knownCap, unit: cap?.unit ?? '%' }
  }))
const compareRows = computed(() => {
  if (!selected.value || !comparison.value) return []
  const keys = new Set([...Object.keys(selected.value.calculatedStats), ...Object.keys(comparison.value.calculatedStats)])
  return [...keys].filter(id => !id.startsWith('_')).map(id => {
    const left = selected.value?.calculatedStats[id]
    const right = comparison.value?.calculatedStats[id]
    const cap = stats.value.find(s => s.id === id)
    const limit = cap?.capStatus === 'known' && cap.cap !== null ? cap.cap : Infinity
    const a = typeof left === 'number' ? Math.min(left, limit) : 0
    const b = typeof right === 'number' ? Math.min(right, limit) : 0
    return { id, a, b, delta: a - b, unit: cap?.unit ?? '%' }
  }).filter(row => row.a !== 0 || row.b !== 0).sort((a,b) => Math.abs(b.delta) - Math.abs(a.delta))
})
const targetRows = computed(() => (preset.value?.targets ?? []).map(t => {
  const stat = numericStats.value.find(s => s.id === t.statId)
  const actual = stat?.effective ?? 0
  return { id: t.statId, actual, required: t.minValue, missing: Math.max(0, t.minValue - actual) }
}))
onMounted(async () => {
  try {
    const db = useDb()
    ;[builds.value, equipment.value, gems.value, presets.value, stats.value] = await Promise.all([
      db.repo('commanders').getAll(), db.repo('equipment').getAll(), db.repo('gems').getAll(),
      db.repo('presets').getAll(), db.repo('stats').getAll()
    ])
    builds.value.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const id = typeof route.query.id === 'string' ? route.query.id : ''
    selectedId.value = builds.value.some(b => b.id === id) ? id : builds.value[0]?.id ?? ''
  } catch (e) { error.value = String(e) }
})
function showCommanderList() { router.push('/commanders') }
</script>
<template>
  <h2 class="text-h6 mb-3">最適化結果</h2>
  <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
  <v-alert v-if="!builds.length" type="info" variant="tonal" class="mb-4">
    保存済みの結果はありません。最適化を実行し、司令官名を付けて保存するとここに表示されます。
  </v-alert>
  <v-btn v-if="!builds.length" color="primary" to="/optimize">最適化を実行する</v-btn>
  <template v-if="builds.length">
    <v-select v-model="selectedId" :items="builds.map(b => ({ title: b.name, value: b.id }))" label="表示する司令官" />
    <template v-if="selected">
      <v-card class="pa-4 mb-3">
        <h3 class="text-subtitle-1 font-weight-bold mb-2">司令官の比較</h3>
        <v-select v-model="compareId"
          :items="[{ title: '比較しない', value: '' }, ...builds.filter(b => b.id !== selectedId).map(b => ({ title: b.name, value: b.id }))]"
          label="比較する司令官" density="comfortable" hide-details />
        <template v-if="comparison">
          <p class="text-caption mt-3 mb-2">差分は「表示中の司令官 − 比較対象」です。既知の上限を適用した数値で比較します。</p>
          <div class="d-flex justify-space-between text-caption font-weight-bold py-2">
            <span>効果</span><span>現在 / 比較対象 / 差分</span>
          </div>
          <div v-for="row in compareRows" :key="row.id" class="d-flex justify-space-between align-center ga-3 py-2 border-b">
            <span class="text-body-2">{{ statName(row.id) }}</span>
            <span class="text-body-2 text-no-wrap">{{ row.a }} / {{ row.b }}{{ row.unit }}
              <strong :class="row.delta > 0 ? 'text-success' : row.delta < 0 ? 'text-error' : ''">
                ({{ row.delta > 0 ? '+' : '' }}{{ row.delta }}{{ row.unit }})
              </strong>
            </span>
          </div>
        </template>
      </v-card>
      <v-card class="pa-4 mb-3">
        <h3 class="text-h6">{{ selected.name }}</h3>
        <p class="text-body-2">プリセット：{{ preset?.name ?? '不明' }}</p>
        <p class="text-caption">保存日時：{{ new Date(selected.createdAt).toLocaleString('ja-JP') }}</p>
        <v-chip v-if="selected.calculatedStats._approximate" color="warning" size="small" class="mt-2">暫定解・最適性未保証</v-chip>
        <v-alert type="info" variant="tonal" density="compact" class="mt-3">表示値は保存時点のスナップショットです。装備やプリセットを後から編集しても自動再計算されません。</v-alert>
      </v-card>
      <CommanderEquipmentPanel :build="selected" :equipment="equipment" :gems="gems" :stats="stats" />
      <v-card class="pa-4 mb-3">
        <h3 class="text-subtitle-1 font-weight-bold mb-3">目標達成状況</h3>
        <v-alert v-if="!preset" type="warning" variant="tonal">保存時のプリセットが見つかりません。</v-alert>
        <p v-else-if="!targetRows.length" class="text-body-2">最低目標は設定されていません。</p>
        <div v-for="row in targetRows" :key="row.id" class="d-flex justify-space-between align-center py-2 ga-2">
          <span>{{ statName(row.id) }}：{{ row.actual }} / {{ row.required }}</span>
          <v-chip size="small" :color="row.missing > 0 ? 'warning' : 'success'">{{ row.missing > 0 ? '不足 ' + row.missing : '達成' }}</v-chip>
        </div>
      </v-card>
      <v-card class="pa-4 mb-3">
        <h3 class="text-subtitle-1 font-weight-bold mb-3">ステータス詳細</h3>
        <p v-if="!numericStats.length" class="text-body-2">保存済みステータスがありません。</p>
        <div v-for="s in numericStats" :key="s.id" class="py-2">
          <div class="d-flex justify-space-between ga-2"><span>{{ statName(s.id) }}</span><strong>{{ s.effective }}{{ s.unit }}</strong></div>
          <p v-if="s.cap !== null" class="text-caption">元の合計：{{ s.raw }}{{ s.unit }} / 上限：{{ s.cap }}{{ s.unit }} <span v-if="s.raw > s.cap">（超過 {{ s.raw - s.cap }}{{ s.unit }}）</span></p>
          <v-divider class="mt-2" />
        </div>
      </v-card>
      <div class="d-flex ga-2 flex-wrap">
        <v-btn color="primary" to="/optimize">もう一度最適化</v-btn>
        <v-btn variant="outlined" @click="showCommanderList">司令官一覧へ</v-btn>
      </div>
    </template>
  </template>
</template>
