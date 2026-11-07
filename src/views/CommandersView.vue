<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useDb, useAppStore } from '@/stores/app'
import { type CommanderBuild, type Equipment, type Gem, type BuildPreset, type StatDefinition } from '@/domain'
import { deleteCommander, commanderNumber, setCommanderPosition, setCommanderLocked } from '@/domain/commanderService'
import CommanderEquipmentPanel from '@/components/CommanderEquipmentPanel.vue'
const app = useAppStore()
const builds = ref<CommanderBuild[]>([]), equipment = ref<Equipment[]>([]), gems = ref<Gem[]>([]), presets = ref<BuildPreset[]>([]), stats = ref<StatDefinition[]>([])
const error = ref('')
const search = ref('')
const presetFilter = ref('all')
const filteredBuilds = computed(() => builds.value.filter(b =>
  (presetFilter.value === 'all' || b.presetId === presetFilter.value) &&
  (b.name + ' ' + presetName(b.presetId)).toLocaleLowerCase().includes(search.value.toLocaleLowerCase().trim())
))
const presetOptions = computed(() => [{ title: 'すべてのプリセット', value: 'all' }, ...presets.value.map(p => ({ title: p.name, value: p.id }))])
const expandedId = ref('')
const rosterNumber = (b: CommanderBuild) => commanderNumber(b, builds.value)
async function updatePosition(b: CommanderBuild, value: number | string) {
  error.value = ''
  try { await setCommanderPosition(useDb(), b.id, Number(value)); await reload() }
  catch (e) { error.value = String(e) }
}
async function toggleLock(b: CommanderBuild) {
  error.value = ''
  try { await setCommanderLocked(useDb(), b.id, !b.locked); await reload() }
  catch (e) { error.value = String(e) }
}
const assignedEquipment = (id: string) => equipment.value.find(e => e.id === id)?.name ?? '削除済み'
const assignedGem = (id: string) => gems.value.find(g => g.id === id)?.name ?? '削除済み'
async function reload() {
  const db = useDb()
  ;[builds.value, equipment.value, gems.value, presets.value, stats.value] = await Promise.all([
    db.repo('commanders').getAll(), db.repo('equipment').getAll(), db.repo('gems').getAll(),
    db.repo('presets').getAll(), db.repo('stats').getAll()
  ])
  builds.value.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
onMounted(reload)
const presetName = (id: string) => presets.value.find(p => p.id === id)?.name ?? '削除済み'
const statName = (id: string) => stats.value.find(s => s.id === id)?.name ?? id
async function remove(b: CommanderBuild) {
  if (!confirm('「' + b.name + '」を削除して、装備・ジェムを解放しますか？')) return
  error.value = ''
  try { await deleteCommander(useDb(), b.id); await reload(); await app.refreshCounts() }
  catch (e) { error.value = String(e) }
}
</script>
<template>
  <h2 class="text-h6 mb-3">保存済み司令官</h2>
  <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
  <v-alert v-if="!builds.length" type="info" variant="tonal">まだ保存された司令官はありません。最適化画面から保存してください。</v-alert>
  <v-row v-if="builds.length" dense class="mb-3">
    <v-col cols="12" sm="7"><v-text-field v-model="search" label="司令官を検索" prepend-inner-icon="mdi-magnify" clearable density="comfortable" hide-details /></v-col>
    <v-col cols="12" sm="5"><v-select v-model="presetFilter" :items="presetOptions" label="ビルド種別" density="comfortable" hide-details /></v-col>
  </v-row>
  <p v-if="builds.length" class="text-caption mb-2">{{ filteredBuilds.length }} / {{ builds.length }} 体を表示</p>
  <v-alert v-if="builds.length && !filteredBuilds.length" type="info" variant="tonal" class="mb-3">条件に一致する司令官がありません。</v-alert>
  <v-card v-for="b in filteredBuilds" :key="b.id" class="pa-3 mb-3">
    <div class="d-flex align-center ga-2 flex-wrap">
      <v-chip color="primary" size="small">司令官 {{ rosterNumber(b) ?? '未設定' }} / 35</v-chip>
      <strong>{{ b.name }}</strong>
      <v-chip v-if="b.locked" color="warning" size="small">ロック中</v-chip>
      <v-chip size="small">{{ presetName(b.presetId) }}</v-chip>
      <v-chip v-if="b.calculatedStats._approximate" color="warning" size="small">暫定解</v-chip>
    </div>
    <p class="text-caption">{{ new Date(b.createdAt).toLocaleString('ja-JP') }}</p>
    <div class="d-flex align-center ga-2 flex-wrap my-2">
      <v-select :model-value="rosterNumber(b)" :items="Array.from({length:35},(_,i)=>({title:'司令官 '+(i+1),value:i+1}))"
        label="ゲーム内の司令官番号" density="compact" style="max-width:200px" hide-details
        @update:model-value="updatePosition(b, $event)" />
      <v-btn size="small" :color="b.locked ? 'warning' : 'default'" variant="outlined"
        @click="toggleLock(b)">{{ b.locked ? 'ロック解除' : '再最適化から保護' }}</v-btn>
    </div>
    <div class="text-caption mb-2">
      <span v-for="slot in ['helmet','weapon','armor','artifact'] as const" :key="slot" class="mr-3">
        {{ ({helmet:'兜',weapon:'武器',armor:'鎧',artifact:'工芸品'} as const)[slot] }}：{{ assignedEquipment(b.equipmentIds[slot] ?? '') }}
        / ジェム：{{ assignedGem(b.gemAssignments.find(a=>a.slotType===slot)?.gemId ?? '') }}
      </span>
    </div>
    <v-btn variant="outlined" size="small" class="my-2" @click="expandedId = expandedId === b.id ? '' : b.id">
      {{ expandedId === b.id ? '装備セットを閉じる' : '装備セットを見る' }}
    </v-btn>
    <CommanderEquipmentPanel v-if="expandedId === b.id" :build="b" :equipment="equipment" :gems="gems" :stats="stats" />
    <v-expansion-panels class="mt-2">
      <v-expansion-panel title="保存時のステータス（参考・再計算は装備セット内）">
        <v-expansion-panel-text>
          <div v-for="(value, id) in b.calculatedStats" :key="id">
            <template v-if="!String(id).startsWith('_')">{{ statName(String(id)) }}：{{ value }}</template>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
    <v-btn color="primary" variant="outlined" size="small" class="mt-3 mr-2" :to="{ path: '/result', query: { id: b.id } }">結果の詳細</v-btn>
    <v-btn color="error" variant="outlined" size="small" class="mt-3" @click="remove(b)">削除して装備を解放</v-btn>
  </v-card>
</template>
