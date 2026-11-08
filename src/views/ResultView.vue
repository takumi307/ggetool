<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDb, useAppStore } from '@/stores/app'
import CommanderEquipmentPanel from '@/components/CommanderEquipmentPanel.vue'
import { buildBreakdown, effectiveValue, knownCaps, snapshotDrift, targetActual } from '@/domain/effects'
import { type CommanderBuild, type Equipment, type Gem, type BuildPreset, type StatDefinition } from '@/domain'

const db = useDb()
const { roleLabel } = useAppStore()

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
const caps = computed(() => knownCaps(stats.value))
const statMeta = (id: string) => stats.value.find(s => s.id === id)
interface StatLine { id: string; raw: number; equipment: number; gem: number; effective: number; cap: number | null; unit: string }
/** 装備に上限を適用してからジェムを加算（最適化・装備パネルと同じ定義）。参照先が欠けた構成は保存値で代替。 */
function statLines(build: CommanderBuild): { lines: StatLine[]; recalculated: boolean; drift: number } {
  const parts = buildBreakdown(build, equipment.value, gems.value)
  if (parts.missingItems === 0) {
    const ids = new Set([...Object.keys(parts.equipment), ...Object.keys(parts.gem)])
    return {
      recalculated: true, drift: snapshotDrift(build.calculatedStats, parts),
      lines: [...ids].map(id => ({
        id, equipment: parts.equipment[id] ?? 0, gem: parts.gem[id] ?? 0,
        raw: (parts.equipment[id] ?? 0) + (parts.gem[id] ?? 0),
        effective: effectiveValue(parts.equipment, parts.gem, caps.value, id),
        cap: caps.value.get(id) ?? null, unit: statMeta(id)?.unit ?? '%'
      }))
    }
  }
  return {
    recalculated: false, drift: 0,
    lines: Object.entries(build.calculatedStats).filter(([key, value]) => !key.startsWith('_') && typeof value === 'number')
      .map(([id, value]) => ({
        id, raw: value as number, equipment: 0, gem: 0, effective: value as number, cap: null, unit: statMeta(id)?.unit ?? '%',
      }))
  }
}
const selectedLines = computed(() => selected.value ? statLines(selected.value) : { lines: [], recalculated: true, drift: 0 })
const numericStats = computed(() => selectedLines.value.lines.filter(l => l.effective !== 0 || l.raw !== 0))
const comparisonLines = computed(() => comparison.value ? statLines(comparison.value) : null)
const canCompare = computed(() => selectedLines.value.recalculated && comparisonLines.value?.recalculated)
const compareRows = computed(() => {
  if (!canCompare.value || !comparisonLines.value) return []
  const left = new Map(selectedLines.value.lines.map(l => [l.id, l.effective]))
  const right = new Map(comparisonLines.value.lines.map(l => [l.id, l.effective]))
  return [...new Set([...left.keys(), ...right.keys()])].map(id => {
    const a = left.get(id) ?? 0, b = right.get(id) ?? 0
    return { id, a: round(a), b: round(b), delta: round(a - b), unit: statMeta(id)?.unit ?? '%' }
  }).filter(row => row.a !== 0 || row.b !== 0).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
})
const round = (n: number) => Number(n.toFixed(3))
const targetRows = computed(() => {
  if (!selected.value || !preset.value) return []
  const parts = buildBreakdown(selected.value, equipment.value, gems.value)
  if (parts.missingItems > 0) return []
  return preset.value.targets.map(t => {
    const actual = targetActual(preset.value!, t.statId, parts.equipment, parts.gem, caps.value)
    return { id: t.statId, actual: round(actual), required: t.minValue, missing: round(Math.max(0, t.minValue - actual)) }
  })
})
onMounted(async () => {
  try {
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
    保存済みの結果はありません。最適化を実行し、{{ roleLabel }}名を付けて保存するとここに表示されます。
  </v-alert>
  <v-btn v-if="!builds.length" color="primary" to="/optimize">最適化を実行する</v-btn>
  <template v-if="builds.length">
    <v-select v-model="selectedId" :items="builds.map(b => ({ title: b.name, value: b.id }))" :label="'表示する' + roleLabel" />
    <template v-if="selected">
      <v-card class="pa-4 mb-3">
        <h3 class="text-subtitle-1 font-weight-bold mb-2">{{ roleLabel }}の比較</h3>
        <v-select v-model="compareId"
          :items="[{ title: '比較しない', value: '' }, ...builds.filter(b => b.id !== selectedId).map(b => ({ title: b.name, value: b.id }))]"
          :label="'比較する' + roleLabel" density="comfortable" hide-details />
        <v-alert v-if="comparison && !canCompare" type="warning" variant="tonal" class="mt-3">
          参照先の装備・ジェムが見つからないため、比較できません。
        </v-alert>
        <template v-else-if="comparison">
          <p class="text-caption mt-3 mb-2">差分は「表示中の{{ roleLabel }} − 比較対象」です。効果ごとの上限を適用した値で比較します。</p>
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
        <v-alert v-if="!selectedLines.recalculated" type="warning" variant="tonal" density="compact" class="mt-3">使用した装備またはジェムが現在の登録に見つからないため、保存時の合計値を表示しています。</v-alert>
        <v-alert v-else-if="selectedLines.drift > 0" type="warning" variant="tonal" density="compact" class="mt-3">保存後に装備・ジェムの内容が変わったため、{{ selectedLines.drift }}件の効果が保存時の合計と異なります。表示値は現在の登録内容で計算しています。</v-alert>
        <v-alert v-else type="info" variant="tonal" density="compact" class="mt-3">表示値には最適化と同じ効果別の上限を適用しています。</v-alert>
      </v-card>
      <CommanderEquipmentPanel :build="selected" :equipment="equipment" :gems="gems" :stats="stats" />
      <v-card class="pa-4 mb-3">
        <h3 class="text-subtitle-1 font-weight-bold mb-3">目標達成状況</h3>
        <v-alert v-if="!preset" type="warning" variant="tonal">保存時のプリセットが見つかりません。</v-alert>
        <v-alert v-else-if="!selectedLines.recalculated" type="warning" variant="tonal">装備・ジェムの内訳が不足しているため、目標達成を判定できません。</v-alert>
        <p v-else-if="!targetRows.length" class="text-body-2">最低目標は設定されていません。</p>
        <div v-for="row in targetRows" :key="row.id" class="d-flex justify-space-between align-center py-2 ga-2">
          <span>{{ statName(row.id) }}：{{ row.actual }} / {{ row.required }}</span>
          <v-chip size="small" :color="row.missing > 0 ? 'warning' : 'success'">{{ row.missing > 0 ? '不足 ' + row.missing : '達成' }}</v-chip>
        </div>
      </v-card>
      <v-card class="pa-4 mb-3">
        <h3 class="text-subtitle-1 font-weight-bold mb-3">{{ selectedLines.recalculated ? '現在のステータス詳細' : '保存時の効果合計' }}</h3>
        <p v-if="!numericStats.length" class="text-body-2">保存済みステータスがありません。</p>
        <div v-for="s in numericStats" :key="s.id" class="py-2">
          <div class="d-flex justify-space-between ga-2"><span>{{ statName(s.id) }}</span><strong>{{ round(s.effective) }}{{ s.unit }}</strong></div>
          <p v-if="selectedLines.recalculated" class="text-caption">装備 {{ round(s.equipment) }}{{ s.unit }}<template v-if="s.cap !== null">（上限 {{ s.cap }}{{ s.unit }}{{ (s.id === 'S003' || s.id === 'C003') ? '・武具とジェムの合計' : s.id.startsWith('CNG') || s.id.startsWith('CPG') ? '・ジェム' : '' }}<span v-if="s.equipment > s.cap && s.id !== 'S003' && s.id !== 'C003'">、超過 {{ round(s.equipment - s.cap) }}{{ s.unit }}</span>）</template> ＋ ジェム {{ round(s.gem) }}{{ s.unit }}</p>
          <v-divider class="mt-2" />
        </div>
      </v-card>
      <div class="d-flex ga-2 flex-wrap">
        <v-btn color="primary" to="/optimize">もう一度最適化</v-btn>
        <v-btn variant="outlined" @click="showCommanderList">{{ roleLabel }}一覧へ</v-btn>
      </div>
    </template>
  </template>
</template>
