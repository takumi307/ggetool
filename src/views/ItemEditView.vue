<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDb, useAppStore } from '@/stores/app'
import { SLOT_TYPES, SLOT_LABELS, type SlotType, type StatDefinition, type EffectEntry, type Equipment, type Gem } from '@/domain'
import { validateEquipment, validateGem } from '@/domain/validation'

const db = useDb()
const props = defineProps<{ kind: 'equipment' | 'gems' }>()
const route = useRoute(), router = useRouter(), app = useAppStore()
const workspace = app.workspace
const requestedSlot = SLOT_TYPES.find(slot => slot === route.query.slot)
const name = ref(''), slotType = ref<SlotType>(requestedSlot ?? 'helmet'), memo = ref('')
const allowedSlots = ref<SlotType[]>([...SLOT_TYPES])
const emptyEffect = (): EffectEntry => ({ statId: '', value: 0 })
const effects = ref<EffectEntry[]>(Array.from({ length: 3 }, emptyEffect)), stats = ref<StatDefinition[]>([])
const equipmentHistory = ref<Equipment[]>([])
const gemTarget = ref<'lord' | 'npc' | 'all' | null>(null)
const gemTargets = [
  { title: '城主ターゲット', value: 'lord' },
  { title: 'NPCターゲット', value: 'npc' },
  { title: 'すべての効果', value: 'all' },
]
const fallbackEffects: Record<SlotType, string[]> = workspace === 'castellan' ? {
  weapon: ['C001', 'C002', 'C005'],
  armor: ['C005', 'C006', 'C003'],
  helmet: ['C004', 'C005', 'C006'],
  artifact: ['C011', 'C002', 'C007'],
} : {
  weapon: ['S001', 'S002', 'S006'],
  armor: ['S004', 'S006', 'S005'],
  helmet: ['S005', 'S007', 'S008'],
  artifact: ['S008', 'S001', 'S002'],
}
function prefillEffects(slot: SlotType) {
  if (props.kind !== 'equipment' || editId.value) return
  const validIds = new Set(stats.value.filter(stat => stat.category === 'equipment').map(stat => stat.id))
  const combinations = new Map<string, number>()
  for (const item of equipmentHistory.value) {
    if (item.slotType !== slot) continue
    const ids = item.effects.slice(0, 3).map(effect => effect.statId)
    if (ids.length !== 3 || !ids.every(id => validIds.has(id))) continue
    const key = JSON.stringify(ids)
    combinations.set(key, (combinations.get(key) ?? 0) + 1)
  }
  const fallback = fallbackEffects[slot].filter(id => validIds.has(id))
  let ids = fallback
  let bestCount = combinations.get(JSON.stringify(fallback)) ?? 0
  for (const [key, count] of combinations) {
    if (count <= bestCount) continue
    bestCount = count
    ids = JSON.parse(key) as string[]
  }
  effects.value = Array.from({ length: 3 }, (_, i) => ({ statId: ids[i] ?? '', value: 0 }))
}
watch(slotType, () => {
  if (effects.value.every(effect => effect.value === 0)) prefillEffects(slotType.value)
})
watch([name, slotType, memo, effects, allowedSlots], () => { duplicates.value = []; duplicateConfirmed.value = false }, { deep: true })
const duplicates = ref<(Equipment | Gem)[]>([])
const duplicateConfirmed = ref(false)
const normalize = (item: Equipment | Gem) => JSON.stringify({
  slot: 'slotType' in item ? item.slotType : [...item.allowedSlots].sort(),
  effects: [...item.effects].map(e => [e.statId, Number(e.value)]).sort((a,b) => String(a[0]).localeCompare(String(b[0])) || Number(a[1]) - Number(b[1]))
})
const error = ref(''), saving = ref(false), createdAt = ref('')
const editId = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
function targetForStat(stat: StatDefinition): 'lord' | 'npc' | null {
  if (/^CNG\d+$/.test(stat.id) || /^G00[1-79]$/.test(stat.id)) return 'npc'
  if (/^CPG\d+$/.test(stat.id)) return 'lord'
  const npc = /NPC/i.test(stat.name)
  const lord = stat.name.includes('城主')
  return npc === lord ? null : npc ? 'npc' : 'lord'
}
const choices = computed(() => {
  const category = props.kind === 'equipment' ? 'equipment' : 'gem'
  const available = stats.value.filter(stat => stat.category === category)
  if (category === 'equipment' || gemTarget.value === 'all') return available
  if (!gemTarget.value) return []
  return [
    ...available.filter(stat => targetForStat(stat) === gemTarget.value),
    ...available.filter(stat => targetForStat(stat) === null),
  ]
})
function effectChoices(id: string) {
  const selected = stats.value.find(stat => stat.id === id)
  const visible = selected && !choices.value.includes(selected) ? [...choices.value, selected] : choices.value
  return visible.map(stat => ({ title: stat.name, value: stat.id }))
}
const slots = SLOT_TYPES.map(s => ({ title: SLOT_LABELS[s], value: s }))
const effectUnit = (id: string) => stats.value.find(s => s.id === id)?.unit || '%'
onMounted(async () => {
  stats.value = await db.repo('stats').getAll()
  if (!editId.value) {
    if (props.kind === 'equipment') {
      equipmentHistory.value = await db.repo('equipment').getAll()
      prefillEffects(slotType.value)
    }
    return
  }
  const item = await db.repo(props.kind).get(editId.value)
  if (!item) { error.value = '対象が見つかりません'; return }
  name.value = item.name; memo.value = item.memo; createdAt.value = item.createdAt
  effects.value = item.effects.map(e => ({ ...e }))
  if ('slotType' in item) slotType.value = item.slotType
  else {
    allowedSlots.value = [...item.allowedSlots]
    const targets = new Set(stats.value
      .filter(stat => item.effects.some(effect => effect.statId === stat.id))
      .map(targetForStat).filter(target => target !== null))
    gemTarget.value = targets.size === 1 ? [...targets][0] : 'all'
  }
})
function addEffect() { effects.value.push({ statId: '', value: 0 }) }
async function save() {
  if (props.kind === 'gems' && !gemTarget.value) return
  error.value = ''
  const now = new Date().toISOString()
  const id = editId.value || crypto.randomUUID()
  // Equipment names are optional; use a stable generated label for unnamed entries.
  const resolvedName = name.value.trim() || (props.kind === 'equipment' ? `${SLOT_LABELS[slotType.value]}-${id.slice(0, 8)}` : `ジェム-${id.slice(0, 8)}`)
  const base = {
    id, name: resolvedName, memo: memo.value,
    effects: effects.value.map(e => ({ statId: e.statId, value: Number(e.value) })),
    createdAt: createdAt.value || now, updatedAt: now
  }
  const item: Equipment | Gem = props.kind === 'equipment'
    ? { ...base, slotType: slotType.value }
    : { ...base, allowedSlots: [...allowedSlots.value] }
  const issue = 'slotType' in item ? validateEquipment(item, stats.value) : validateGem(item, stats.value)
  if (issue) { error.value = issue; return }
  const existing = await db.repo(props.kind).getAll()
  duplicates.value = existing.filter(other => other.id !== item.id && normalize(other) === normalize(item))
  if (duplicates.value.length && !duplicateConfirmed.value) {
    error.value = '同じ部位・効果・数値の登録が見つかりました。重複の可能性を確認してください。'
    return
  }
  saving.value = true
  try {
    if ('slotType' in item) await db.repo('equipment').put(item)
    else await db.repo('gems').put(item)
    await app.refreshCounts(db)
    if (app.workspace === workspace) await router.push(props.kind === 'equipment' ? '/equipment' : '/gems')
  } catch (e) { error.value = String(e) } finally { saving.value = false }
}
</script>
<template>
  <h2 class="text-h6 mb-4">{{ editId ? '編集' : '新規登録' }}：{{ kind === 'equipment' ? '装備' : 'ジェム' }}</h2>
  <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
  <v-alert v-if="duplicates.length" type="warning" variant="tonal" class="mb-3">
    同じ効果構成の登録：{{ duplicates.map(x => x.name).join('、') }}。ゲーム内で同じ性能の武具を複数所持している場合だけ、重複登録を許可してください。
    <v-checkbox v-model="duplicateConfirmed" label="別個体を所持していることを確認して登録する" hide-details />
  </v-alert>
  <v-form @submit.prevent="save">
    <v-text-field v-model="name" :label="kind === 'equipment' ? '装備名（任意）' : 'ジェム名（任意）'" hint="空欄なら保存時に自動で名前を付けます" persistent-hint />
    <v-select v-if="kind === 'equipment'" v-model="slotType" :items="slots" label="装備部位" />
    <template v-else>
      <v-select v-model="gemTarget" :items="gemTargets" label="ジェムの対象" placeholder="城主またはNPCを選択" />
      <v-select v-model="allowedSlots" :items="slots" multiple chips label="装着可能部位" />
    </template>
    <h3 class="text-subtitle-1 mb-2">効果（初期3件・装備は最大4件）</h3>
    <p v-if="kind === 'equipment' && !editId" class="text-caption mb-2">同じ部位でよく登録される効果を初期表示します。ゲーム画面に合わせて変更できます。</p>
    <p v-if="kind === 'gems'" class="text-caption mb-2">対象を選ぶと専用効果と共通効果が表示されます。複数の対象の効果を入力するときは「すべての効果」を選んでください。</p>
    <p class="text-caption mb-3">同じ効果を複数選択できます。数値は合算して計算します。</p>
    <v-row v-for="(effect, i) in effects" :key="i" dense align="center">
      <v-col cols="12" sm="7">
        <v-select
          v-model="effect.statId"
          :items="effectChoices(effect.statId)"
          :disabled="kind === 'gems' && !gemTarget"
          label="効果"
          density="comfortable"
          class="effect-select"
          :menu-props="{ maxHeight: 440 }"
        >
          <template #item="{ props: itemProps, item }">
            <v-list-item v-bind="itemProps" class="effect-option">
              <template #title>
                <span class="effect-option-name">{{ item.title }}</span>
              </template>
            </v-list-item>
          </template>
          <template #selection="{ item }">
            <span class="effect-selection-name">{{ item.title }}</span>
          </template>
        </v-select>
      </v-col>
      <v-col cols="9" sm="4"><v-text-field v-model.number="effect.value" type="number" step="0.1" min="0"  :label="`効果値 (${effectUnit(effect.statId)})`" density="comfortable" /></v-col>
      <v-col cols="3" sm="1"><v-btn icon="mdi-close" variant="text" size="small" :disabled="effects.length <= 3" @click="effects.splice(i, 1)" /></v-col>
    </v-row>
    <v-btn class="mb-4" variant="outlined" :disabled="kind === 'equipment' ? effects.length >= 4 : !gemTarget" @click="addEffect">効果を追加</v-btn>
    <v-textarea v-model="memo" label="メモ" rows="2" />
    <div class="d-flex ga-2">
      <v-btn type="submit" color="primary" :loading="saving" :disabled="kind === 'gems' && !gemTarget">保存</v-btn>
      <v-btn variant="outlined" @click="router.back()">戻る</v-btn>
    </div>
  </v-form>
</template>

<style scoped>
/* Long GGE stat labels must remain readable on narrow phone screens. */
.effect-option :deep(.v-list-item-title),
.effect-option-name,
.effect-selection-name {
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: normal;
  text-overflow: clip;
}
.effect-option :deep(.v-list-item-title) {
  line-height: 1.45;
}
.effect-option {
  min-height: 48px;
  height: auto;
  padding-top: 10px;
  padding-bottom: 10px;
}
.effect-select :deep(.v-field__input) {
  height: auto;
  min-height: 48px;
}
.effect-selection-name {
  display: block;
  line-height: 1.45;
  padding: 6px 0;
}
</style>
