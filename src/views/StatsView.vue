<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useDb, useAppStore } from '@/stores/app'
import type { StatDefinition, StatCategory, CapStatus } from '@/domain'
import { validateStat } from '@/domain/validation'
const app = useAppStore()
const items = ref<StatDefinition[]>([]), error = ref(''), editing = ref<StatDefinition | null>(null)
const categories: { title: string, value: StatCategory }[] = [
  { title: '装備', value: 'equipment' }, { title: 'ジェム', value: 'gem' }
]
const statuses: { title: string, value: CapStatus }[] = [
  { title: '確認済み', value: 'known' }, { title: '未確認', value: 'unknown' }, { title: '無効', value: 'disabled' }
]
async function reload() { items.value = await useDb().repo('stats').getAll() }
onMounted(reload)
function start(s?: StatDefinition) {
  editing.value = s ? { ...s } : {
    id: crypto.randomUUID(), name: '', category: 'equipment', cap: null,
    unit: '%', capStatus: 'unknown', description: ''
  }
  error.value = ''
}
async function save() {
  if (!editing.value) return
  error.value = ''
  const source = editing.value
  const value = source.capStatus === 'known'
    ? (source.cap === null || String(source.cap).trim() === '' ? Number.NaN : Number(source.cap))
    : null
  const stat: StatDefinition = { ...source, cap: value }
  const issue = validateStat(stat)
  if (issue) { error.value = issue; return }
  try {
    await useDb().repo('stats').put(stat)
    editing.value = null
    await reload()
    await app.refreshCounts()
  } catch (e) { error.value = String(e) }
}
async function remove(s: StatDefinition) {
  error.value = ''
  const [eq, gems, presets] = await Promise.all([
    useDb().repo('equipment').getAll(), useDb().repo('gems').getAll(), useDb().repo('presets').getAll()
  ])
  if (eq.some(x => x.effects.some(e => e.statId === s.id)) ||
      gems.some(x => x.effects.some(e => e.statId === s.id)) ||
      presets.some(x => x.targets.some(t => t.statId === s.id) || x.priorityStats.includes(s.id) || x.maximizeStats.includes(s.id))) {
    error.value = '使用中の効果は削除できません'
    return
  }
  if (!confirm('「' + s.name + '」を削除しますか？')) return
  try { await useDb().repo('stats').delete(s.id); await reload(); await app.refreshCounts() }
  catch (e) { error.value = String(e) }
}
</script>
<template>
  <div class="d-flex justify-space-between align-center mb-3">
    <h2 class="text-h6">ステータス・上限管理</h2>
    <v-btn color="primary" @click="start()">効果を追加</v-btn>
  </div>
  <v-alert v-if="error && !editing" type="error" class="mb-3">{{ error }}</v-alert>
  <v-card v-for="s in items" :key="s.id" class="mb-2 pa-3">
    <div class="d-flex justify-space-between align-center ga-2">
      <div>
        <strong>{{ s.name }}</strong>
        <div class="text-caption">
          {{ s.category === 'equipment' ? '装備' : 'ジェム' }} /
          上限：{{ s.capStatus === 'known' ? String(s.cap) + s.unit : s.capStatus === 'unknown' ? '未確認' : '無効' }}
        </div>
      </div>
      <div>
        <v-btn size="small" variant="text" @click="start(s)">編集</v-btn>
        <v-btn size="small" variant="text" color="error" @click="remove(s)">削除</v-btn>
      </div>
    </div>
  </v-card>
  <v-dialog :model-value="!!editing" max-width="580" scrollable @update:model-value="v => { if (!v) editing = null }">
    <v-card v-if="editing" class="pa-4" variant="elevated" color="surface" elevation="16">
      <h3 class="text-h6 mb-3">効果の編集</h3>
      <v-text-field v-model="editing.name" label="効果名" />
      <v-select v-model="editing.category" :items="categories" label="区分" />
      <v-select v-model="editing.capStatus" :items="statuses" label="上限の状態" />
      <v-text-field v-if="editing.capStatus === 'known'" v-model.number="editing.cap" type="number" min="0" label="上限値" />
      <v-text-field v-model="editing.unit" label="単位" />
      <v-textarea v-model="editing.description" label="説明" rows="2" />
      <v-alert v-if="error" type="error" class="mb-2">{{ error }}</v-alert>
      <div class="d-flex ga-2">
        <v-btn color="primary" @click="save">保存</v-btn>
        <v-btn @click="editing = null">キャンセル</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>
