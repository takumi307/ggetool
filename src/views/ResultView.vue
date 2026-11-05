<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDb } from '@/stores/app'
import { SLOT_TYPES, SLOT_LABELS, type CommanderBuild, type Equipment, type Gem, type BuildPreset, type StatDefinition } from '@/domain'

const route = useRoute(), router = useRouter()
const builds = ref<CommanderBuild[]>([])
const equipment = ref<Equipment[]>([]), gems = ref<Gem[]>([]), presets = ref<BuildPreset[]>([]), stats = ref<StatDefinition[]>([])
const selectedId = ref(''), error = ref('')
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
        <h3 class="text-h6">{{ selected.name }}</h3>
        <p class="text-body-2">プリセット：{{ preset?.name ?? '不明' }}</p>
        <p class="text-caption">保存日時：{{ new Date(selected.createdAt).toLocaleString('ja-JP') }}</p>
        <v-chip v-if="selected.calculatedStats._approximate" color="warning" size="small" class="mt-2">暫定解・最適性未保証</v-chip>
        <v-alert type="info" variant="tonal" density="compact" class="mt-3">表示値は保存時点のスナップショットです。装備やプリセットを後から編集しても自動再計算されません。</v-alert>
      </v-card>
      <v-card class="pa-4 mb-3">
        <h3 class="text-subtitle-1 font-weight-bold mb-3">装備・ジェム構成</h3>
        <div v-for="slot in SLOT_TYPES" :key="slot" class="py-2">
          <strong>{{ SLOT_LABELS[slot] }}</strong>：{{ eqName(selected.equipmentIds[slot]) }}
          <p class="text-body-2 text-medium-emphasis">ジェム：{{ gemName(selected.gemAssignments.find(a => a.slotType === slot)?.gemId) }}</p>
          <v-divider class="mt-2" />
        </div>
      </v-card>
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
