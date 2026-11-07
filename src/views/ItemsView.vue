<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDb, useAppStore } from '@/stores/app'
import { commanderNumber } from '@/domain/commanderService'
import { SLOT_LABELS, SLOT_TYPES, type Equipment, type Gem, type StatDefinition, type CommanderBuild } from '@/domain'

const db = useDb()
const props = defineProps<{ kind: 'equipment' | 'gems' }>()
const router = useRouter(), app = useAppStore()
const { roleLabel } = app
const items = ref<(Equipment | Gem)[]>([]), stats = ref<StatDefinition[]>([]), assigned = ref<string[]>([]), error = ref('')
const owners = ref<Record<string,string>>({})
const orderedItems = computed(() => [...items.value].sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)))
const registrationNo = (id: string) => orderedItems.value.findIndex(x => x.id === id) + 1
const title = computed(() => props.kind === 'equipment' ? '装備管理' : 'ジェム管理')
const keyword = ref(''), slotFilter = ref('all'), showAssigned = ref('all')
const visible = computed(() => orderedItems.value.filter(item => {
  if (props.kind === 'equipment' && slotFilter.value !== 'all' && 'slotType' in item && item.slotType !== slotFilter.value) return false
  if (showAssigned.value === 'unused' && assigned.value.includes(item.id)) return false
  if (showAssigned.value === 'assigned' && !assigned.value.includes(item.id)) return false
  const query = keyword.value.trim().toLocaleLowerCase()
  return !query || (item.name + ' ' + details(item) + ' ' + item.memo).toLocaleLowerCase().includes(query)
}))
const slotOptions = [{ title: '全部位', value: 'all' }, ...SLOT_TYPES.map(s => ({ title: SLOT_LABELS[s], value: s }))]
const assignedOptions = [{ title: 'すべて', value: 'all' }, { title: '未使用', value: 'unused' }, { title: '使用中', value: 'assigned' }]
const unit = (id: string) => stats.value.find(s => s.id === id)?.unit ?? '%'
async function reload() {
  items.value = await db.repo(props.kind).getAll()
  stats.value = await db.repo('stats').getAll()
  const commanders: CommanderBuild[] = await db.repo('commanders').getAll()
  const allocations = props.kind === 'equipment'
    ? (await db.repo('equipmentAllocations').getAll()).map(a => ({ id:a.equipmentId, commanderId:a.commanderBuildId }))
    : (await db.repo('gemAllocations').getAll()).map(a => ({ id:a.gemId, commanderId:a.commanderBuildId }))
  assigned.value = allocations.map(a => a.id)
  owners.value = Object.fromEntries(allocations.map(a => {
    const c = commanders.find(c => c.id === a.commanderId)
    return [a.id, c ? roleLabel + ' ' + (commanderNumber(c, commanders) ?? '未設定') + '：' + c.name : '不明な' + roleLabel]
  }))
}
onMounted(reload)
watch(() => props.kind, reload)
function details(item: Equipment | Gem) {
  return item.effects.map(e => (stats.value.find(s => s.id === e.statId)?.name ?? e.statId) + ' ' + e.value + unit(e.statId)).join(' / ')
}
async function remove(item: Equipment | Gem) {
  error.value = ''
  if (assigned.value.includes(item.id)) { error.value = '使用中の装備・ジェムは削除できません'; return }
  if (!confirm('「' + item.name + '」を削除しますか？')) return
  try { await db.repo(props.kind).delete(item.id); await app.refreshCounts(db); await reload() }
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
  <v-row dense class="mb-2">
    <v-col cols="12" sm="5"><v-text-field v-model="keyword" label="装備名・効果で検索" prepend-inner-icon="mdi-magnify" density="compact" clearable hide-details /></v-col>
    <v-col v-if="kind === 'equipment'" cols="6" sm="4"><v-select v-model="slotFilter" :items="slotOptions" label="部位" density="compact" hide-details /></v-col>
    <v-col cols="6" sm="3"><v-select v-model="showAssigned" :items="assignedOptions" label="使用状況" density="compact" hide-details /></v-col>
  </v-row>
  <p class="text-caption mb-2">{{ visible.length }} / {{ items.length }} 件（番号は登録日時順・削除後は振り直し）</p>
  <v-alert v-if="items.length && !visible.length" type="info" variant="tonal">検索条件に一致するデータがありません。</v-alert>
  <v-row dense>
    <v-col v-for="item in visible" :key="item.id" cols="12" lg="6">
      <v-card class="pa-3 mb-2" height="100%" variant="outlined">
        <div class="d-flex ga-2 flex-wrap align-center mb-3">
          <v-chip size="small" color="primary" variant="tonal">#{{ registrationNo(item.id) }}</v-chip><strong class="text-subtitle-1">{{ item.name }}</strong>
          <v-chip v-if="'slotType' in item" size="small">{{ SLOT_LABELS[item.slotType] }}</v-chip>
          <v-chip v-if="assigned.includes(item.id)" color="warning" size="small">{{ owners[item.id] ?? '使用中' }}</v-chip>
          <v-chip v-else color="success" size="small" variant="tonal">未使用</v-chip>
        </div>
        <div v-for="(effect, i) in item.effects" :key="i" class="d-flex justify-space-between ga-3 py-1 border-b">
          <span class="text-body-2">{{ stats.find(s => s.id === effect.statId)?.name ?? effect.statId }}</span>
          <strong class="text-body-2 text-no-wrap">{{ effect.value }}{{ unit(effect.statId) }}</strong>
        </div>
        <p v-if="item.memo" class="text-caption mt-2">{{ item.memo }}</p>
        <div class="d-flex ga-2 mt-3">
          <v-btn size="small" variant="outlined" @click="router.push('/' + kind + '/edit/' + item.id)">編集</v-btn>
          <v-btn size="small" color="error" variant="text" :disabled="assigned.includes(item.id)" @click="remove(item)">削除</v-btn>
        </div>
      </v-card>
    </v-col>
  </v-row>
</template>
