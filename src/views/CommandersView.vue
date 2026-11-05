<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useDb, useAppStore } from '@/stores/app'
import { SLOT_TYPES, SLOT_LABELS, type CommanderBuild, type Equipment, type Gem, type BuildPreset, type StatDefinition } from '@/domain'
import { deleteCommander } from '@/domain/commanderService'
const app = useAppStore()
const builds = ref<CommanderBuild[]>([]), equipment = ref<Equipment[]>([]), gems = ref<Gem[]>([]), presets = ref<BuildPreset[]>([]), stats = ref<StatDefinition[]>([])
const error = ref('')
async function reload() {
  const db = useDb()
  ;[builds.value, equipment.value, gems.value, presets.value, stats.value] = await Promise.all([
    db.repo('commanders').getAll(), db.repo('equipment').getAll(), db.repo('gems').getAll(),
    db.repo('presets').getAll(), db.repo('stats').getAll()
  ])
  builds.value.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
onMounted(reload)
const eqName = (id?: string) => equipment.value.find(e => e.id === id)?.name ?? '削除済み'
const gemName = (id?: string) => id ? gems.value.find(g => g.id === id)?.name ?? '削除済み' : 'なし'
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
  <v-card v-for="b in builds" :key="b.id" class="pa-3 mb-3">
    <div class="d-flex align-center ga-2 flex-wrap">
      <strong>{{ b.name }}</strong>
      <v-chip size="small">{{ presetName(b.presetId) }}</v-chip>
      <v-chip v-if="b.calculatedStats._approximate" color="warning" size="small">暫定解</v-chip>
    </div>
    <p class="text-caption">{{ new Date(b.createdAt).toLocaleString('ja-JP') }}</p>
    <div v-for="slot in SLOT_TYPES" :key="slot" class="text-body-2 py-1">
      {{ SLOT_LABELS[slot] }}：{{ eqName(b.equipmentIds[slot]) }}
      <span class="text-medium-emphasis"> / ジェム：{{ gemName(b.gemAssignments.find(a => a.slotType === slot)?.gemId) }}</span>
    </div>
    <v-expansion-panels class="mt-2">
      <v-expansion-panel title="保存時のステータス">
        <v-expansion-panel-text>
          <div v-for="(value, id) in b.calculatedStats" :key="id">
            <template v-if="!String(id).startsWith('_')">{{ statName(String(id)) }}：{{ value }}</template>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
    <v-btn color="error" variant="outlined" size="small" class="mt-3" @click="remove(b)">削除して装備を解放</v-btn>
  </v-card>
</template>
