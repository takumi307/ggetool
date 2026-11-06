<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useDb, useAppStore } from '@/stores/app'
import type { BuildPreset, StatDefinition, Equipment } from '@/domain'
const app = useAppStore()
const presets = ref<BuildPreset[]>([]), stats = ref<StatDefinition[]>([]), equipment = ref<Equipment[]>([]), editing = ref<BuildPreset | null>(null), error = ref('')
const defaults = [
  { name: 'バランス型', targets: [['S002', 120], ['S001', 120], ['S003', 50]], defaultCount: 30, description: '暫定の最低条件。合計150%への接近とNPC補正を含む80%の最適化は未対応。' },
  { name: '略奪特化型', targets: [['S008', 50]], defaultCount: 3, description: '略奪量50%のみを最低条件とする' },
  { name: '援軍特化型', targets: [['S002', 120], ['S003', 50], ['S007', 90]], defaultCount: 1, description: '遠隔兵120%、中庭50%、移動速度90%' }
] as const
async function reload() { presets.value = await useDb().repo('presets').getAll(); stats.value = await useDb().repo('stats').getAll(); equipment.value = await useDb().repo('equipment').getAll() }
onMounted(reload)
function fresh(): BuildPreset {
  return { id: crypto.randomUUID(), name: '', targets: [], priorityStats: [], maximizeStats: [], defaultCount: 1, priority: 1, description: '' }
}
function start(p?: BuildPreset) { editing.value = p ? JSON.parse(JSON.stringify(p)) as BuildPreset : fresh(); if (editing.value.name.includes('援軍特化') && !editing.value.requiredEquipmentKeyword) editing.value.requiredEquipmentKeyword = '援軍'; error.value = '' }
async function seed() {
  if (presets.value.length && !confirm('既存プリセットを残して、未登録の標準プリセットを追加しますか？')) return
  for (const d of defaults) {
    if (presets.value.some(p => p.name === d.name)) continue
    await useDb().repo('presets').put({
      ...fresh(), name: d.name, targets: d.targets.map(([statId, minValue]) => ({ statId, minValue })),
      defaultCount: d.defaultCount, description: d.description
    })
  }
  await reload(); await app.refreshCounts()
}
async function save() {
  if (!editing.value) return
  error.value = ''
  const p = editing.value
  if (!p.name.trim() || !Number.isInteger(p.defaultCount) || p.defaultCount < 1) { error.value = '名前と作成個数（1以上の整数）を確認してください'; return }
  if (p.targets.some(t => !stats.value.some(s => s.id === t.statId) || !Number.isFinite(t.minValue) || t.minValue < 0) ||
      new Set(p.targets.map(t => t.statId)).size !== p.targets.length) { error.value = '目標の効果・数値・重複を確認してください'; return }
  if (p.requiredEquipmentKeyword?.trim() && !equipment.value.some(e => e.name.includes(p.requiredEquipmentKeyword!.trim()))) { error.value = '必須装備の名前条件に一致する装備がありません。装備管理の名称を確認してください'; return }
  p.requiredEquipmentKeyword = p.requiredEquipmentKeyword?.trim() ?? ''
  // Keep the legacy field for backup compatibility, but disable its behavior.
  p.maximizeStats = []
  p.priorityStats = []
  try { await useDb().repo('presets').put(JSON.parse(JSON.stringify(p)) as BuildPreset); editing.value = null; await reload(); await app.refreshCounts() }
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
    <strong>{{ p.name }}</strong><span v-if="p.requiredEquipmentKeyword" class="text-caption ml-2">必須装備：{{ p.requiredEquipmentKeyword }}</span>
    <p class="text-body-2">{{ p.targets.map(t => (stats.find(s => s.id === t.statId)?.name ?? t.statId) + ' ≥ ' + t.minValue).join(' / ') || '目標なし' }}</p>
    <v-btn size="small" variant="text" @click="start(p)">編集</v-btn>
    <v-btn size="small" variant="text" color="error" @click="remove(p)">削除</v-btn>
  </v-card>
  <v-dialog :model-value="!!editing" max-width="700" scrollable @update:model-value="v => { if (!v) editing = null }">
    <v-card v-if="editing" class="pa-4" variant="elevated" color="surface" elevation="16">
      <h3 class="text-h6 mb-3">プリセット編集</h3>
      <v-text-field v-model="editing.name" label="名前" />
      <v-text-field v-model.number="editing.defaultCount" type="number" min="1" label="標準作成数" />
      <v-textarea v-model="editing.description" rows="2" label="説明" />
      <v-text-field v-model="editing.requiredEquipmentKeyword" label="必須装備名（部分一致・空欄なら指定なし）" hint="例：援軍。各司令官に、この文字を名前に含む装備を最低1個必須にします。装備は司令官間で重複使用しません。" persistent-hint class="mb-3" />
      <v-alert v-if="editing.requiredEquipmentKeyword" type="info" variant="tonal" class="mb-3">一致する登録装備：{{ equipment.filter(e => e.name.includes(editing!.requiredEquipmentKeyword!.trim())).length }}件。6体作る場合は最低6個の未使用装備が必要です。</v-alert>
      <h4 class="mb-2">最低目標</h4>
      <v-row v-for="(t, i) in editing.targets" :key="i" dense>
        <v-col cols="7"><v-select v-model="t.statId" :items="stats.map(s => ({ title: s.name, value: s.id }))" label="効果" /></v-col>
        <v-col cols="4"><v-text-field v-model.number="t.minValue" type="number" label="目標値" /></v-col>
        <v-col cols="1"><v-btn icon="mdi-close" size="small" variant="text" @click="editing.targets.splice(i, 1)" /></v-col>
      </v-row>
      <v-btn variant="outlined" class="mb-3" @click="editing.targets.push({ statId: '', minValue: 0 })">目標を追加</v-btn>
      <v-alert v-if="error" type="error" class="my-2">{{ error }}</v-alert>
      <div class="d-flex ga-2 mt-3">
        <v-btn color="primary" @click="save">保存</v-btn>
        <v-btn @click="editing = null">キャンセル</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>
