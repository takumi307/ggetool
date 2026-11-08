<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useDb, useAppStore } from '@/stores/app'
import { canonicalStatId } from '@/domain/statAliases'
import { castellanScoringStats } from '@/domain/effects'
import { defaultPresetObjective, objectiveTargetIds, validatePresetObjective } from '@/domain/presetObjective'
import type { BuildPreset, ObjectiveStage, StatDefinition, Equipment } from '@/domain'

const db = useDb()
const app = useAppStore()
const { workspace, roleLabel } = app
const presets = ref<BuildPreset[]>([]), stats = ref<StatDefinition[]>([]), equipment = ref<Equipment[]>([]), editing = ref<BuildPreset | null>(null), error = ref('')
const stageLabels: Record<ObjectiveStage, string> = {
  planPriority: '作成計画の優先度',
  weighted: '目標外の加点',
  overshoot: '目標超過分',
  stability: '付け替えの少なさ',
}
const weightedOptions = computed(() => {
  const preset = editing.value
  if (!preset) return []
  const targetIds = objectiveTargetIds(preset)
  return stats.value.filter(stat => !targetIds.has(canonicalStatId(stat.id)))
    .map(stat => ({ title: stat.name, value: stat.id }))
})
function setDetailedObjective(enabled: boolean | null) {
  const preset = editing.value
  if (!preset) return
  if (!enabled) {
    delete preset.objective
    return
  }
  preset.objective = defaultPresetObjective(preset)
  if (workspace === 'castellan' && !preset.objective.weights.length) applyDefenseWeights(preset.castellanObjective ?? 'general')
}
function applyDefenseWeights(defense: NonNullable<BuildPreset['castellanObjective']>) {
  const preset = editing.value
  if (!preset?.objective) return
  const ids = new Set(stats.value.map(stat => stat.id))
  const scales = new Map(stats.value.map(stat => [canonicalStatId(stat.id), 1]))
  const targets = objectiveTargetIds(preset)
  preset.objective.weights = castellanScoringStats({ ...preset, castellanObjective: defense }, scales)
    .filter(stat => ids.has(stat.id) && !targets.has(stat.id))
    .map(({ id, weight }) => ({ statId: id, weight }))
  preset.castellanObjective = defense
}
function moveStage(index: number, offset: number) {
  const order = editing.value?.objective?.order
  if (!order || index + offset < 0 || index + offset >= order.length) return
  const [stage] = order.splice(index, 1)
  order.splice(index + offset, 0, stage)
}

const castellanObjectives = [
  { title: '通常防衛', value: 'general' },
  { title: 'NPC防衛・最大化', value: 'npc' },
  { title: '対城主防衛・バランス', value: 'lord' },
]
const defaults: { name: string; targets: readonly (readonly [string, number])[]; defaultCount: number; description: string; castellanObjective?: BuildPreset['castellanObjective'] }[] = workspace === 'castellan' ? [
  { name: 'NPC防衛・最大化', targets: [], defaultCount: 1, castellanObjective: 'npc', description: '城壁人数・乱闘／遠隔兵の戦闘力・中庭戦闘力を重視し、略奪で失われる資源は加点しません。' },
  { name: '対城主防衛・バランス', targets: [], defaultCount: 1, castellanObjective: 'lord', description: 'NPC向けの割当後、通常防衛と対城主効果を残りの装備で均等に高めます。作成計画で必要数を指定できます。' },
  { name: '防御バランス（例）', targets: [['C001', 100], ['C002', 100], ['C003', 50]], defaultCount: 1, description: '編集できる目標の例です。ゲームの上限値ではありません。' }
] : [
  { name: 'バランス型', targets: [['S002', 120], ['S001', 120], ['S003', 50]], defaultCount: 30, description: '暫定の最低条件。合計150%への接近とNPC補正を含む80%の最適化は未対応。' },
  { name: '略奪特化型', targets: [['S008', 50]], defaultCount: 3, description: '略奪量50%のみを最低条件とする' },
  { name: '援軍特化型', targets: [['S002', 120], ['S003', 50], ['S007', 90]], defaultCount: 1, description: '遠隔兵120%、中庭50%、移動速度90%' }
]
async function reload() { presets.value = await db.repo('presets').getAll(); stats.value = await db.repo('stats').getAll(); equipment.value = await db.repo('equipment').getAll() }
onMounted(reload)
function fresh(): BuildPreset {
  return { id: crypto.randomUUID(), name: '', targets: [], priorityStats: [], maximizeStats: [], defaultCount: 1, priority: 1, description: '' }
}
function start(p?: BuildPreset) {
  editing.value = p ? JSON.parse(JSON.stringify(p)) as BuildPreset : fresh()
  if (workspace === 'castellan') editing.value.castellanObjective ??= 'general'
  if (workspace === 'commander' && editing.value.name.includes('援軍特化')) {
    const supportStat = stats.value.find(s => s.name.includes('中庭攻撃時に受ける') && s.name.includes('乙女の援軍'))
    if (supportStat && !editing.value.requiredEquipmentStatId) {
      editing.value.requiredEquipmentStatId = supportStat.id
      editing.value.requiredEquipmentKeyword = ''
    }
  }
  error.value = ''
}
async function seed() {
  if (presets.value.length && !confirm('既存プリセットを残して、未登録の標準プリセットを追加しますか？')) return
  for (const d of defaults) {
    if (presets.value.some(p => p.name === d.name) || d.targets.some(([id]) => !stats.value.some(s => s.id === id))) continue
    await db.repo('presets').put({
      ...fresh(), name: d.name, targets: d.targets.map(([statId, minValue]) => ({ statId, minValue })),
      defaultCount: d.defaultCount, description: d.description, castellanObjective: d.castellanObjective
    })
  }
  await reload(); await app.refreshCounts(db)
}
async function save() {
  if (!editing.value) return
  error.value = ''
  const p = editing.value
  if (!p.name.trim() || !Number.isInteger(p.defaultCount) || p.defaultCount < 1) { error.value = '名前と作成個数（1以上の整数）を確認してください'; return }
  if (p.targets.some(t => !stats.value.some(s => s.id === t.statId) || !Number.isFinite(t.minValue) || t.minValue < 0) ||
      new Set(p.targets.map(t => t.statId)).size !== p.targets.length) { error.value = '目標の効果・数値・重複を確認してください'; return }
  if (p.requiredEquipmentStatId && !stats.value.some(s => s.id === p.requiredEquipmentStatId)) { error.value = '必須装備効果を選択してください'; return }
  if (!p.requiredEquipmentStatId && p.requiredEquipmentKeyword?.trim() && !equipment.value.some(e => e.name.includes(p.requiredEquipmentKeyword!.trim()))) { error.value = '必須装備の名前条件に一致する装備がありません。装備管理の名称を確認してください'; return }
  p.requiredEquipmentKeyword = p.requiredEquipmentStatId ? '' : (p.requiredEquipmentKeyword?.trim() ?? '')
  const objectiveIssue = validatePresetObjective(p.objective, new Set(stats.value.map(stat => stat.id)), objectiveTargetIds(p))
  if (objectiveIssue) { error.value = objectiveIssue; return }
  p.priorityStats = []
  try { await db.repo('presets').put(JSON.parse(JSON.stringify(p)) as BuildPreset); editing.value = null; await reload(); await app.refreshCounts(db) }
  catch (e) { error.value = String(e) }
}
async function remove(p: BuildPreset) {
  const [plans, commanders] = await Promise.all([db.repo('plans').getAll(), db.repo('commanders').getAll()])
  if (plans.some(x => x.presetId === p.id) || commanders.some(x => x.presetId === p.id)) { error.value = '使用中のプリセットは削除できません'; return }
  if (!confirm(p.name + 'を削除しますか？')) return
  await db.repo('presets').delete(p.id); await reload(); await app.refreshCounts(db)
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
    <strong>{{ p.name }}</strong><span v-if="p.requiredEquipmentStatId" class="text-caption ml-2">必須装備効果：{{ stats.find(s => s.id === p.requiredEquipmentStatId)?.name ?? p.requiredEquipmentStatId }}</span><span v-if="p.requiredEquipmentKeyword" class="text-caption ml-2">必須装備：{{ p.requiredEquipmentKeyword }}</span>
    <p class="text-body-2">{{ p.targets.map(t => (stats.find(s => s.id === t.statId)?.name ?? t.statId) + ' ≥ ' + t.minValue).join(' / ') || '最低目標なし' }}</p>
    <p v-if="workspace === 'castellan'" class="text-caption">{{ castellanObjectives.find(option => option.value === (p.castellanObjective ?? 'general'))?.title }} ／ 目標外の防衛効果も評価</p>
    <v-btn size="small" variant="text" @click="start(p)">編集</v-btn>
    <v-btn size="small" variant="text" color="error" @click="remove(p)">削除</v-btn>
  </v-card>
  <v-dialog :model-value="!!editing" max-width="700" scrollable @update:model-value="v => { if (!v) editing = null }">
    <v-card v-if="editing" class="pa-4 overflow-y-auto" variant="elevated" color="surface" elevation="16">
      <h3 class="text-h6 mb-3">プリセット編集</h3>
      <v-text-field v-model="editing.name" label="名前" />
      <v-text-field v-model.number="editing.defaultCount" type="number" min="1" label="標準作成数" />
      <v-select v-if="workspace === 'castellan'" v-model="editing.castellanObjective" :items="castellanObjectives" label="防衛方針" />
      <v-textarea v-model="editing.description" rows="2" label="説明" />
      <v-select v-model="editing.requiredEquipmentStatId" :items="stats.filter(s => s.category === 'equipment').map(s => ({ title: s.name, value: s.id }))" label="必須装備効果（効果を持つ武具を最低1つ使用）" clearable :hint="workspace === 'commander' ? '援軍特化型は「中庭攻撃時に受けるレベル10乙女の援軍」を選択。装備名ではなく効果で判定します。' : '選択した効果が付く武具を各城代に最低1個使います。'" persistent-hint class="mb-3" />
      <v-alert v-if="editing.requiredEquipmentStatId" type="info" variant="tonal" class="mb-3">該当効果を持つ登録装備：{{ equipment.filter(e => e.effects.some(x => x.statId === editing!.requiredEquipmentStatId && x.value > 0)).length }}件</v-alert>
      <v-text-field v-if="!editing.requiredEquipmentStatId" v-model="editing.requiredEquipmentKeyword" label="必須装備名（部分一致・空欄なら指定なし）" :hint="'各' + roleLabel + 'に、この文字を名前に含む装備を最低1個必須にします。装備の重複使用はできません。'" persistent-hint class="mb-3" />
      <v-alert v-if="editing.requiredEquipmentKeyword" type="info" variant="tonal" class="mb-3">一致する登録装備：{{ equipment.filter(e => e.name.includes(editing!.requiredEquipmentKeyword!.trim())).length }}件。6体作る場合は最低6個の未使用装備が必要です。</v-alert>
      <h4 class="mb-2">最低目標</h4>
      <p v-if="workspace === 'castellan'" class="text-body-2 mb-2">最低目標を優先し、目標に含まれない効果は防衛方針に合わせてできるだけ高めます。</p>
      <p v-if="editing.castellanObjective === 'npc' && !editing.objective" class="text-body-2 mb-2">城壁人数・乱闘／遠隔兵の戦闘力・中庭戦闘力を重視します。略奪で失われる資源は加点しません。</p>
      <v-row v-for="(t, i) in editing.targets" :key="i" dense>
        <v-col cols="7"><v-select v-model="t.statId" :items="stats.filter(s => workspace === 'commander' || canonicalStatId(s.id) === s.id).map(s => ({ title: s.name, value: s.id }))" label="効果" /></v-col>
        <v-col cols="4"><v-text-field v-model.number="t.minValue" type="number" label="目標値" /></v-col>
        <v-col cols="1"><v-btn icon="mdi-close" size="small" variant="text" @click="editing.targets.splice(i, 1)" /></v-col>
      </v-row>
      <v-btn variant="outlined" class="mb-3" @click="editing.targets.push({ statId: '', minValue: 0 })">目標を追加</v-btn>
      <details class="mb-3">
        <summary class="text-subtitle-1">詳細設定</summary>
        <v-checkbox :model-value="Boolean(editing.objective)" label="このプリセットの採点をカスタマイズする"
          hide-details @update:model-value="setDetailedObjective" />
        <template v-if="editing.objective">
          <p class="text-body-2 mb-2">目標達成人数を最初に最大化します。その後の優先順は下のボタンで変更できます。同時に計算する詳細設定付きプリセットでは、順番をそろえてください。</p>
          <ol class="pl-5 mb-3">
            <li v-for="(stage, i) in editing.objective.order" :key="stage">
              {{ stageLabels[stage] }}
              <v-btn size="small" variant="text" :aria-label="stageLabels[stage] + 'を上へ'" :disabled="i === 0" @click="moveStage(i, -1)">↑</v-btn>
              <v-btn size="small" variant="text" :aria-label="stageLabels[stage] + 'を下へ'" :disabled="i === editing.objective.order.length - 1" @click="moveStage(i, 1)">↓</v-btn>
            </li>
          </ol>
          <div v-if="workspace === 'castellan'" class="d-flex flex-wrap ga-2 mb-3">
            <v-btn variant="outlined" size="small" @click="applyDefenseWeights('npc')">NPC防衛の重みを適用</v-btn>
            <v-btn variant="outlined" size="small" @click="applyDefenseWeights('lord')">対城主防衛の重みを適用</v-btn>
          </div>
          <v-row v-for="(entry, i) in editing.objective.weights" :key="i" dense>
            <v-col cols="7"><v-autocomplete v-model="entry.statId" :items="weightedOptions" label="加点する効果" /></v-col>
            <v-col cols="4"><v-text-field v-model.number="entry.weight" type="number" min="1" max="100" step="1" label="重み" /></v-col>
            <v-col cols="1"><v-btn icon="mdi-close" aria-label="加点効果を削除" size="small" variant="text" @click="editing.objective.weights.splice(i, 1)" /></v-col>
          </v-row>
          <v-btn variant="outlined" class="mb-3" @click="editing.objective.weights.push({ statId: '', weight: 1 })">加点する効果を追加</v-btn>
          <v-select v-model="editing.objective.overshoot" label="目標を超えた分"
            :items="[{ title: '評価しない', value: 'ignore' }, { title: '超過の割合を小さくする', value: 'minimize' }, { title: '超過の割合を加点する', value: 'reward' }]" />
          <v-checkbox v-model="editing.objective.reopt.minimizeSwaps" label="再最適化で現在の装備をできるだけ維持" hide-details />
          <v-checkbox v-model="editing.objective.reopt.keepGems" label="再最適化で現在のジェム配置をできるだけ維持" hide-details />
          <p class="text-caption my-2">設定は次回の計算に適用されます。保存済み構成を更新するには、再最適化して保存してください。</p>
        </template>
      </details>
      <v-alert v-if="error" type="error" class="my-2">{{ error }}</v-alert>
      <div class="d-flex ga-2 mt-3">
        <v-btn color="primary" @click="save">保存</v-btn>
        <v-btn @click="editing = null">キャンセル</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>
