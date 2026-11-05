<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDb, useAppStore } from '@/stores/app'
import { SLOT_LABELS, type Equipment, type Gem, type StatDefinition } from '@/domain'
const props = defineProps<{ kind: 'equipment' | 'gems' }>()
const router = useRouter(), app = useAppStore()
const items = ref<(Equipment | Gem)[]>([]), stats = ref<StatDefinition[]>([]), assigned = ref<string[]>([]), error = ref('')
const title = computed(() => props.kind === 'equipment' ? '装備管理' : 'ジェム管理')
async function reload() {
  items.value = await useDb().repo(props.kind).getAll()
  stats.value = await useDb().repo('stats').getAll()
  assigned.value = props.kind === 'equipment'
    ? (await useDb().repo('equipmentAllocations').getAll()).map(x => x.equipmentId)
    : (await useDb().repo('gemAllocations').getAll()).map(x => x.gemId)
}
onMounted(reload)
watch(() => props.kind, reload)
function details(item: Equipment | Gem) {
  return item.effects.map(e => (stats.value.find(s => s.id === e.statId)?.name ?? e.statId) + ' ' + e.value + '%').join(' / ')
}
async function remove(item: Equipment | Gem) {
  error.value = ''
  if (assigned.value.includes(item.id)) { error.value = '使用中の装備・ジェムは削除できません'; return }
  if (!confirm('「' + item.name + '」を削除しますか？')) return
  try { await useDb().repo(props.kind).delete(item.id); await app.refreshCounts(); await reload() }
  catch (e) { error.value = String(e) }
}
</script>
<template>
  <div class="d-flex justify-space-between align-center mb-4">
    <h2 class="text-h6">{{ title }}</h2>
    <v-btn color="primary" @click="router.push('/' + kind + '/edit')">新規登録</v-btn>
  </div>
  <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
  <v-alert v-if="!items.length" type="info" variant="tonal">まだ登録されていません。「新規登録」から追加してください。</v-alert>
  <v-card v-for="item in items" :key="item.id" class="pa-3 mb-3">
    <div class="d-flex ga-2 flex-wrap align-center">
      <strong>{{ item.name }}</strong>
      <v-chip v-if="'slotType' in item" size="small">{{ SLOT_LABELS[item.slotType] }}</v-chip>
      <v-chip v-if="assigned.includes(item.id)" color="warning" size="small">使用中</v-chip>
    </div>
    <p class="text-body-2 mt-2">{{ details(item) }}</p>
    <p v-if="item.memo" class="text-caption mt-1">{{ item.memo }}</p>
    <div class="d-flex ga-2 mt-2">
      <v-btn size="small" variant="outlined" @click="router.push('/' + kind + '/edit/' + item.id)">編集</v-btn>
      <v-btn size="small" color="error" variant="text" @click="remove(item)">削除</v-btn>
    </div>
  </v-card>
</template>
