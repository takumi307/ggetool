<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDb, useAppStore } from '@/stores/app'
import { SLOT_TYPES, SLOT_LABELS, type SlotType, type StatDefinition, type EffectEntry, type Equipment, type Gem } from '@/domain'
import { validateEquipment, validateGem } from '@/domain/validation'
const props = defineProps<{ kind: 'equipment' | 'gems' }>()
const route = useRoute(), router = useRouter(), app = useAppStore()
const name = ref(''), slotType = ref<SlotType>('helmet'), memo = ref('')
const allowedSlots = ref<SlotType[]>([...SLOT_TYPES])
const emptyEffect = (): EffectEntry => ({ statId: '', value: 0 })
const effects = ref<EffectEntry[]>(Array.from({ length: 3 }, emptyEffect)), stats = ref<StatDefinition[]>([])
// Common leading effects observed in the 140-item equipment backup.
const commonEffects: Record<SlotType, string[]> = {
  weapon: ['S001', 'S002'],
  armor: ['S004', 'S006'],
  helmet: ['S005', 'S007'],
  artifact: ['S008'],
}
function prefillEffects(slot: SlotType) {
  if (props.kind !== 'equipment' || editId.value) return
  const ids = commonEffects[slot].filter(id => stats.value.some(s => s.id === id && s.category === 'equipment'))
  effects.value = Array.from({ length: 3 }, (_, i) => ({ statId: ids[i] ?? '', value: 0 }))
}
watch(slotType, prefillEffects)
const error = ref(''), saving = ref(false), createdAt = ref('')
const editId = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
const choices = computed(() => stats.value.filter(s => s.category === (props.kind === 'equipment' ? 'equipment' : 'gem')).map(s => ({ title: s.name, value: s.id })))
const slots = SLOT_TYPES.map(s => ({ title: SLOT_LABELS[s], value: s }))
const effectUnit = (id: string) => stats.value.find(s => s.id === id)?.unit || '%'
onMounted(async () => {
  stats.value = await useDb().repo('stats').getAll()
  if (!editId.value) prefillEffects(slotType.value)
  if (!editId.value) return
  const item = await useDb().repo(props.kind).get(editId.value)
  if (!item) { error.value = '対象が見つかりません'; return }
  name.value = item.name; memo.value = item.memo; createdAt.value = item.createdAt
  effects.value = item.effects.map(e => ({ ...e }))
  if ('slotType' in item) slotType.value = item.slotType
  else allowedSlots.value = [...item.allowedSlots]
})
function addEffect() { effects.value.push({ statId: '', value: 0 }) }
async function save() {
  error.value = ''
  const now = new Date().toISOString()
  const id = editId.value || crypto.randomUUID()
  // Equipment names are optional; use a stable generated label for unnamed entries.
  const resolvedName = name.value.trim() || (props.kind === 'equipment' ? `${SLOT_LABELS[slotType.value]}-${id.slice(0, 8)}` : `ジェム-${'${id.slice(0, 8)}'}`)
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
  saving.value = true
  try {
    if ('slotType' in item) await useDb().repo('equipment').put(item)
    else await useDb().repo('gems').put(item)
    await app.refreshCounts()
    await router.push(props.kind === 'equipment' ? '/equipment' : '/gems')
  } catch (e) { error.value = String(e) } finally { saving.value = false }
}
</script>
<template>
  <h2 class="text-h6 mb-4">{{ editId ? '編集' : '新規登録' }}：{{ kind === 'equipment' ? '装備' : 'ジェム' }}</h2>
  <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
  <v-form @submit.prevent="save">
    <v-text-field v-model="name" :label="kind === 'equipment' ? '装備名（任意）' : 'ジェム名（任意）'" hint="空欄なら保存時に自動で名前を付けます" persistent-hint />
    <v-select v-if="kind === 'equipment'" v-model="slotType" :items="slots" label="装備部位" />
    <v-select v-else v-model="allowedSlots" :items="slots" multiple chips label="装着可能部位" />
    <h3 class="text-subtitle-1 mb-2">効果（初期3件・装備は最大4件）</h3>
    <p v-if="kind === 'equipment' && !editId" class="text-caption mb-2">部位に共通する効果は自動選択済みです。異なる場合は変更できます。</p>
    <p class="text-caption mb-3">同じ効果を複数選択できます。数値は合算して計算します。</p>
    <v-row v-for="(effect, i) in effects" :key="i" dense align="center">
      <v-col cols="12" sm="7">
        <v-select
          v-model="effect.statId"
          :items="choices"
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
    <v-btn class="mb-4" variant="outlined" :disabled="kind === 'equipment' && effects.length >= 4" @click="addEffect">効果を追加</v-btn>
    <v-textarea v-model="memo" label="メモ" rows="2" />
    <div class="d-flex ga-2">
      <v-btn type="submit" color="primary" :loading="saving">保存</v-btn>
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
