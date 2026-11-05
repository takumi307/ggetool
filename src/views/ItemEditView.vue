<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDb, useAppStore } from '@/stores/app'
import { SLOT_TYPES, SLOT_LABELS, type SlotType, type StatDefinition, type EffectEntry, type Equipment, type Gem } from '@/domain'
import { validateEquipment, validateGem } from '@/domain/validation'
const props = defineProps<{ kind: 'equipment' | 'gems' }>()
const route = useRoute(), router = useRouter(), app = useAppStore()
const name = ref(''), slotType = ref<SlotType>('helmet'), memo = ref('')
const allowedSlots = ref<SlotType[]>([...SLOT_TYPES])
const effects = ref<EffectEntry[]>([{ statId: '', value: 0 }]), stats = ref<StatDefinition[]>([])
const error = ref(''), saving = ref(false), createdAt = ref('')
const editId = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
const choices = computed(() => stats.value.filter(s => s.category === (props.kind === 'equipment' ? 'equipment' : 'gem')).map(s => ({ title: s.name, value: s.id })))
const slots = SLOT_TYPES.map(s => ({ title: SLOT_LABELS[s], value: s }))
const effectUnit = (id: string) => stats.value.find(s => s.id === id)?.unit || '%'
onMounted(async () => {
  stats.value = await useDb().repo('stats').getAll()
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
  const base = {
    id: editId.value || crypto.randomUUID(), name: name.value.trim(), memo: memo.value,
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
    <v-text-field v-model="name" label="名前" required />
    <v-select v-if="kind === 'equipment'" v-model="slotType" :items="slots" label="装備部位" />
    <v-select v-else v-model="allowedSlots" :items="slots" multiple chips label="装着可能部位" />
    <h3 class="text-subtitle-1 mb-2">効果（装備は3～4件）</h3>
    <v-row v-for="(effect, i) in effects" :key="i" dense align="center">
      <v-col cols="12" sm="7"><v-select v-model="effect.statId" :items="choices" label="効果" density="comfortable" /></v-col>
      <v-col cols="9" sm="4"><v-text-field v-model.number="effect.value" type="number" step="0.1" min="0"  :label="`効果値 (${effectUnit(effect.statId)})`" density="comfortable" /></v-col>
      <v-col cols="3" sm="1"><v-btn icon="mdi-close" variant="text" size="small" :disabled="effects.length <= 1" @click="effects.splice(i, 1)" /></v-col>
    </v-row>
    <v-btn class="mb-4" variant="outlined" :disabled="kind === 'equipment' && effects.length >= 4" @click="addEffect">効果を追加</v-btn>
    <v-textarea v-model="memo" label="メモ" rows="2" />
    <div class="d-flex ga-2">
      <v-btn type="submit" color="primary" :loading="saving">保存</v-btn>
      <v-btn variant="outlined" @click="router.back()">戻る</v-btn>
    </div>
  </v-form>
</template>
