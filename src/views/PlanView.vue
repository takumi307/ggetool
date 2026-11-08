<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDb, useAppStore } from '@/stores/app'
import type { BuildPlan, BuildPreset, CommanderBuild } from '@/domain'

const db = useDb()

const router = useRouter()
const app = useAppStore()
const { roleLabel } = app
const plans = ref<BuildPlan[]>([])
const presets = ref<BuildPreset[]>([])
const commanders = ref<CommanderBuild[]>([])
const error = ref('')
const notice = ref('')
const busy = ref(false)
const selectedPresetId = ref('')
const count = ref(1)
const priority = ref(1)

async function reload() {
  ;[plans.value, presets.value, commanders.value] = await Promise.all([
    db.repo('plans').getAll(), db.repo('presets').getAll(), db.repo('commanders').getAll()
  ])
}
onMounted(reload)
const presetOptions = computed(() => presets.value.map(p => ({ title: p.name, value: p.id })))
const orderedPlans = computed(() => [...plans.value].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)))
const presetName = (id: string) => presets.value.find(p => p.id === id)?.name ?? '削除されたプリセット'
const completed = (id: string) => commanders.value.filter(c => c.presetId === id).length
const remaining = (p: BuildPlan) => Math.max(0, p.count - completed(p.presetId))
const totalCount = computed(() => plans.value.filter(p => p.enabled).reduce((sum, p) => sum + p.count, 0))
const totalDone = computed(() => plans.value.filter(p => p.enabled).reduce((sum, p) => sum + Math.min(p.count, completed(p.presetId)), 0))
const valid = (n: number) => Number.isSafeInteger(n) && n >= 1 && n <= 10000

async function add() {
  error.value = ''; notice.value = ''
  if (!selectedPresetId.value || !presets.value.some(p => p.id === selectedPresetId.value)) {
    error.value = 'プリセットを選択してください'; return
  }
  if (plans.value.some(p => p.presetId === selectedPresetId.value)) {
    error.value = '同じプリセットの計画は既にあります'; return
  }
  if (!valid(count.value) || !valid(priority.value)) {
    error.value = '作成数と優先順位は1〜10000の整数で入力してください'; return
  }
  busy.value = true
  try {
    await db.repo('plans').put({
      id: crypto.randomUUID(), presetId: selectedPresetId.value, count: count.value,
      priority: priority.value, enabled: true
    })
    await reload(); await app.refreshCounts(db)
    notice.value = '計画を追加しました'
  } catch (e) { error.value = String(e) } finally { busy.value = false }
}
async function update(p: BuildPlan) {
  error.value = ''; notice.value = ''
  if (!valid(p.count) || !valid(p.priority)) {
    error.value = '作成数と優先順位は1〜10000の整数で入力してください'; return
  }
  busy.value = true
  try {
    await db.repo('plans').put({ ...p })
    await reload(); notice.value = '計画を保存しました'
  } catch (e) { error.value = String(e) } finally { busy.value = false }
}
async function remove(p: BuildPlan) {
  if (!confirm('「' + presetName(p.presetId) + '」の計画を削除しますか？保存済み' + roleLabel + 'は削除されません。')) return
  error.value = ''; notice.value = ''; busy.value = true
  try {
    await db.repo('plans').delete(p.id)
    await reload(); await app.refreshCounts(db)
    notice.value = '計画を削除しました'
  } catch (e) { error.value = String(e) } finally { busy.value = false }
}
function selectPreset(id: string) {
  selectedPresetId.value = id
  const p = presets.value.find(p => p.id === id)
  if (p) { count.value = p.defaultCount; priority.value = p.priority }
}
function optimize(p: BuildPlan) {
  router.push({ path: '/optimize', query: { presetId: p.presetId } })
}
</script>

<template>
  <h2 class="text-h6 mb-3">ビルド作成計画</h2>
  <v-alert type="info" variant="tonal" class="mb-4">
    プリセットごとに必要な{{ roleLabel }}数と優先順位を管理します。進捗は保存済み{{ roleLabel }}の数から自動集計されます。
    計画を追加しても一括最適化は開始されません。
  </v-alert>
  <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
  <v-alert v-if="notice" type="success" class="mb-3">{{ notice }}</v-alert>
  <v-card class="pa-4 mb-4">
    <h3 class="text-subtitle-1 mb-2">全体の進捗</h3>
    <div class="text-h6">{{ totalDone }} / {{ totalCount }} 体</div>
    <v-btn class="my-3" color="primary" :disabled="totalDone >= totalCount" :to="{ path: '/optimize', query: { mode: 'new' } }">不足分をまとめて最適化</v-btn>
    <v-progress-linear :model-value="totalCount ? totalDone / totalCount * 100 : 0" color="primary" height="8" rounded />
  </v-card>
  <v-card class="pa-4 mb-4">
    <h3 class="text-subtitle-1 mb-3">計画を追加</h3>
    <v-alert v-if="!presets.length" type="warning" variant="tonal" class="mb-3">
      先にビルドプリセットを登録してください。
      <router-link to="/presets">プリセット管理へ</router-link>
    </v-alert>
    <v-select :model-value="selectedPresetId" :items="presetOptions" label="ビルドプリセット"
      @update:model-value="selectPreset" />
    <v-row dense>
      <v-col cols="6"><v-text-field v-model.number="count" type="number" min="1" max="10000" label="作成数" /></v-col>
      <v-col cols="6"><v-text-field v-model.number="priority" type="number" min="1" max="10000" label="優先順位（小さいほど優先）" /></v-col>
    </v-row>
    <v-btn color="primary" :loading="busy" :disabled="!presets.length" @click="add">計画を追加</v-btn>
  </v-card>
  <v-alert v-if="!plans.length" type="info" variant="tonal">計画はまだありません。</v-alert>
  <v-card v-for="p in orderedPlans" :key="p.id" class="pa-4 mb-3">
    <div class="d-flex align-center justify-space-between ga-2 mb-2">
      <strong>{{ presetName(p.presetId) }}</strong>
      <v-switch v-model="p.enabled" color="primary" label="有効" hide-details density="compact" @update:model-value="update(p)" />
    </div>
    <p class="text-body-2 mb-2">保存済み {{ completed(p.presetId) }} 体 / 目標 {{ p.count }} 体
      （残り {{ remaining(p) }} 体）</p>
    <v-progress-linear :model-value="Math.min(100, completed(p.presetId) / Math.max(1, p.count) * 100)"
      color="primary" height="6" rounded class="mb-3" />
    <v-row dense>
      <v-col cols="6"><v-text-field v-model.number="p.count" type="number" min="1" max="10000" label="作成数" /></v-col>
      <v-col cols="6"><v-text-field v-model.number="p.priority" type="number" min="1" max="10000" label="優先順位" /></v-col>
    </v-row>
    <div class="d-flex flex-wrap ga-2">
      <v-btn color="primary" variant="outlined" :disabled="busy" @click="update(p)">変更を保存</v-btn>
      <v-btn color="primary" :disabled="busy || !p.enabled || !remaining(p)" @click="optimize(p)">このプリセットで最適化</v-btn>
      <v-btn color="error" variant="text" :disabled="busy" @click="remove(p)">削除</v-btn>
    </div>
  </v-card>
</template>
