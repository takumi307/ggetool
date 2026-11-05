<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useDb, useAppStore } from '@/stores/app'
import type { BuildPreset, StatDefinition } from '@/domain'
const app = useAppStore()
const presets = ref<BuildPreset[]>([]), stats = ref<StatDefinition[]>([]), editing = ref<BuildPreset | null>(null), error = ref('')
const defaults = [
  { name: 'バランス型', targets: [['S002', 120], ['S001', 120], ['S003', 50]], maximizeStats: ['S009', 'S007'], defaultCount: 30 },
  { name: '略奪特化型', targets: [['S008', 50], ['S002', 120]], maximizeStats: ['S001'], defaultCount: 3 },
  { name: '援軍特化型', targets: [['S002', 120], ['S003', 50]], maximizeStats: ['S009', 'S007'], defaultCount: 1 }
] as const
async function reload() { presets.value = await useDb().repo('presets').getAll(); stats.value = await useDb().repo('stats').getAll() }
onMounted(reload)
function fresh(): BuildPreset {
  return { id: crypto.randomUUID(), name: '', targets: [], priorityStats: [], maximizeStats: [], defaultCount: 1, priority: 1, description: '' }
}
function start(p?: BuildPreset) { editing.value = p ? JSON.parse(JSON.stringify(p)) as BuildPreset : fresh(); error.value = '' }
async function seed() {
  if (presets.value.length && !confirm('既存プリセットを残して、未登録の標準プリセットを追加しますか？')) return
  for (const d of defaults) {
    if (presets.value.some(p => p.name === d.name)) continue
    await useDb().repo('presets').put({
      ...fresh(), name: d.name, targets: d.targets.map(([statId, minValue]) => ({ statId, minValue })),
      maximizeStats: [...d.maximizeStats], defaultCount: d.defaultCount
    })
  }
  await reload(); await app.refreshCounts()
}
function move(list: string[], i: number, delta: number) {
  const j = i + delta
  if (j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
}
async function save() {
  if (!editing.value) return
  error.value = ''
  const p = editing.value
  if (!p.name.trim() || !Number.isInteger(p.defaultCount) || p.defaultCount < 1) { error.value = '名前と作成個数（1以上の整数）を確認してください'; return }
  if (p.targets.some(t => !stats.value.some(s => s.id === t.statId) || !Number.isFinite(t.minValue) || t.minValue < 0) ||
      new Set(p.targets.map(t => t.statId)).size !== p.targets.length) { error.value = '目標の効果・数値・重複を確認してください'; return }
  if ([...p.priorityStats, ...p.maximizeStats].some(id => !stats.value.some(s => s.id === id)) ||
      new Set(p.maximizeStats).size !== p.maximizeStats.length) { error.value = '最大化効果の指定を確認してください'; return }
  try { await useDb().repo('presets').put(p); editing.value = null; await reload(); await app.refreshCounts() }
  catch (e) { error.value = String(e) }
}
async function remove(p: BuildPreset) {
  const [plans, commanders] = await Promise.all([useDb().repo('plans').getAll(), useDb().repo('commanders').getAll()])
  if (plans.some(x => x.presetId === p.id) || commanders.some(x => x.presetId === p.id)) { error.value = '使用中のプリセットは削除できません'; return }
  if (!confirm(p.name + 'を削除しますか？')) return
  await useDb().repo('presets').delete(p.id); await reload(); await app.refreshCounts()
}
</script>
<template>
  <div class="d-flex align-center ga-2 flex-wrap mb-3">
    <h2 class="text-h6">ビルドプリセット</h2>
    <v-spacer />
    <v-btn variant="outlined" @click="seed">標準プリセットを追加</v-btn>
    <v-btn color="primary" @click="start()">新規作成</v-btn>
  </div>
  <v-alert v-if="error && !editing" type="error" class="mb-3">{{ error }}</v-alert>
  <v-card v-for="p in presets" :key="p.id" class="pa-3 mb-2">
    <strong>{{ p.name }}</strong>
    <p class="text-body-2">{{ p.targets.map(t => (stats.find(s => s.id === t.statId)?.name ?? t.statId) + ' ≥ ' + t.minValue).join(' / ') || '目標なし' }}</p>
    <p class="text-caption">最大化：{{ p.maximizeStats.map(id => stats.find(s => s.id === id)?.name ?? id).join(' → ') || '未指定' }}</p>
    <v-btn size="small" variant="text" @click="start(p)">編集</v-btn>
    <v-btn size="small" variant="text" color="error" @click="remove(p)">削除</v-btn>
  </v-card>
  <v-dialog :model-value="!!editing" max-width="700" scrollable @update:model-value="v => { if (!v) editing = null }">
    <v-card v-if="editing" class="pa-4" color="surface" elevation="16">
      <h3 class="text-h6 mb-3">プリセット編集</h3>
      <v-text-field v-model="editing.name" label="名前" />
      <v-text-field v-model.number="editing.defaultCount" type="number" min="1" label="標準作成数" />
      <v-textarea v-model="editing.description" rows="2" label="説明" />
      <h4 class="mb-2">最低目標</h4>
      <v-row v-for="(t, i) in editing.targets" :key="i" dense>
        <v-col cols="7"><v-select v-model="t.statId" :items="stats.map(s => ({ title: s.name, value: s.id }))" label="効果" /></v-col>
        <v-col cols="4"><v-text-field v-model.number="t.minValue" type="number" label="目標値" /></v-col>
        <v-col cols="1"><v-btn icon="mdi-close" size="small" variant="text" @click="editing.targets.splice(i, 1)" /></v-col>
      </v-row>
      <v-btn variant="outlined" class="mb-3" @click="editing.targets.push({ statId: '', minValue: 0 })">目標を追加</v-btn>
      <h4 class="mb-2">最大化ステータス（上から優先）</h4>
      <v-select v-model="editing.maximizeStats" multiple chips :items="stats.map(s => ({ title: s.name, value: s.id }))" label="最大化対象" />
      <div v-for="(id, i) in editing.maximizeStats" :key="id" class="d-flex align-center ga-2 mb-1">
        <span>{{ i + 1 }}. {{ stats.find(s => s.id === id)?.name ?? id }}</span>
        <v-spacer />
        <v-btn size="x-small" variant="outlined" :disabled="i === 0" @click="move(editing.maximizeStats, i, -1)">↑</v-btn>
        <v-btn size="x-small" variant="outlined" :disabled="i === editing.maximizeStats.length - 1" @click="move(editing.maximizeStats, i, 1)">↓</v-btn>
      </div>
      <v-alert v-if="error" type="error" class="my-2">{{ error }}</v-alert>
      <div class="d-flex ga-2 mt-3">
        <v-btn color="primary" @click="save">保存</v-btn>
        <v-btn @click="editing = null">キャンセル</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>
