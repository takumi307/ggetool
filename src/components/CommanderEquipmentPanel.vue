<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { SLOT_LABELS, type SlotType, type CommanderBuild, type Equipment, type Gem, type StatDefinition } from '@/domain'
import { canonicalStatId } from '@/domain/statAliases'

const props = defineProps<{ build: CommanderBuild; equipment: Equipment[]; gems: Gem[]; stats: StatDefinition[] }>()
const slots: { key: SlotType; icon: string }[] = [
  { key: 'armor', icon: 'mdi-shield' }, { key: 'weapon', icon: 'mdi-sword' },
  { key: 'helmet', icon: 'mdi-helmet' }, { key: 'artifact', icon: 'mdi-medal' }
]
const selectedSlot = ref<SlotType>('armor')
const showStats = ref(true)
watch(() => props.build.id, () => { selectedSlot.value = 'armor' })
const sortedEquipment = computed(() => [...props.equipment].sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)))
const sortedGems = computed(() => [...props.gems].sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)))
const eqNo = (id?: string) => id ? sortedEquipment.value.findIndex(e => e.id === id) + 1 : 0
const gemNo = (id?: string) => id ? sortedGems.value.findIndex(g => g.id === id) + 1 : 0
const itemFor = (slot: SlotType) => props.equipment.find(e => e.id === props.build.equipmentIds[slot])
const gemFor = (slot: SlotType) => props.gems.find(g => g.id === props.build.gemAssignments.find(a => a.slotType === slot)?.gemId)
const item = computed(() => itemFor(selectedSlot.value))
const gem = computed(() => gemFor(selectedSlot.value))
const statName = (id: string) => props.stats.find(s => s.id === id)?.name ?? id
const statUnit = (id: string) => props.stats.find(s => s.id === id)?.unit ?? '%'
const equipmentTotals = computed(() => {
  const totals: Record<string, number> = {}
  for (const slot of slots) for (const effect of itemFor(slot.key)?.effects ?? []) {
    const id = canonicalStatId(effect.statId)
    totals[id] = (totals[id] ?? 0) + effect.value
  }
  return totals
})
const gemTotals = computed(() => {
  const totals: Record<string, number> = {}
  for (const slot of slots) for (const effect of gemFor(slot.key)?.effects ?? []) {
    const id = canonicalStatId(effect.statId)
    totals[id] = (totals[id] ?? 0) + effect.value
  }
  return totals
})
const statRows = computed(() => {
  const keys = new Set([...Object.keys(equipmentTotals.value), ...Object.keys(gemTotals.value)])
  return [...keys].map(id => {
    const stat = props.stats.find(s => canonicalStatId(s.id) === id)
    const cap = stat?.capStatus === 'known' && stat.cap !== null ? stat.cap : null
    const equipment = equipmentTotals.value[id] ?? 0
    const gem = gemTotals.value[id] ?? 0
    const effective = Math.min(equipment, cap ?? Infinity) + gem
    return { id, name: statName(id), equipment, gem, cap, effective, unit: stat?.unit ?? '%' }
  }).filter(row => row.effective !== 0)
})
const categories = [
  { title: '部隊の効果', ids: ['S001','S002','G005'] },
  { title: '防御の構成の効果', ids: ['S004','S005','S006'] },
  { title: '攻撃の効果', ids: ['S003','S009','S010'] },
  { title: '戦闘前の効果', ids: ['S007'] },
  { title: '戦闘後の効果', ids: ['S008'] }
]
function groupFor(id: string, name: string) {
  if (categories.some(c => c.ids.includes(id))) return categories.find(c => c.ids.includes(id))!.title
  if (/遠隔兵|乱闘兵/.test(name)) return '部隊の効果'
  if (/城壁|城門|堀の防御/.test(name)) return '防御の構成の効果'
  if (/移動スピード|移動速度/.test(name)) return '戦闘前の効果'
  if (/略奪|資源/.test(name)) return '戦闘後の効果'
  return '攻撃の効果'
}
const grouped = computed(() => categories.map(c => ({
  title: c.title, rows: statRows.value.filter(row => groupFor(row.id, row.name) === c.title)
})).filter(c => c.rows.length))
const npcRanged = computed(() => statRows.value.find(r => r.id === 'S002')?.effective ?? 0)
const npcRangedTotal = computed(() => (statRows.value.find(r => r.id === 'S002')?.effective ?? 0) + (statRows.value.find(r => r.id === 'G005')?.effective ?? 0))
const fmt = (n: number) => Number(n.toFixed(3)).toLocaleString('ja-JP')
</script>

<template>
  <section class="commander-panel" aria-label="司令官の装備とステータス">
    <header class="panel-header"><strong>司令官の武具</strong><span>部位をタップして詳細を確認</span></header>
    <div class="slot-grid" role="group" aria-label="装備スロット">
      <button v-for="slot in slots" :key="slot.key" type="button" class="slot" :class="{ active: selectedSlot === slot.key }"
        :aria-pressed="selectedSlot === slot.key" @click="selectedSlot = slot.key">
        <v-icon :icon="slot.icon" size="30" />
        <strong>{{ SLOT_LABELS[slot.key] }}</strong>
        <span class="slot-number">武具 #{{ eqNo(build.equipmentIds[slot.key]) || '—' }}</span>
        <span class="slot-number">ジェム #{{ gemNo(build.gemAssignments.find(a => a.slotType === slot.key)?.gemId) || '—' }}</span>
      </button>
    </div>
    <div class="detail">
      <h3>{{ SLOT_LABELS[selectedSlot] }}の装備詳細</h3>
      <strong>武具 #{{ eqNo(item?.id) || '—' }}：{{ item?.name ?? '未登録' }}</strong>
      <div v-for="(e,i) in item?.effects ?? []" :key="'e'+i" class="effect-row"><span>{{ statName(e.statId) }}</span><b>+{{ fmt(e.value) }}{{ statUnit(e.statId) }}</b></div>
      <h4 class="mt-3">ジェム #{{ gemNo(gem?.id) || '—' }}：{{ gem?.name ?? 'なし' }}</h4>
      <div v-for="(e,i) in gem?.effects ?? []" :key="'g'+i" class="effect-row"><span>{{ statName(e.statId) }}</span><b>+{{ fmt(e.value) }}{{ statUnit(e.statId) }}</b></div>
    </div>
    <div class="status-header">
      <strong>司令官のステータス</strong>
      <button type="button" @click="showStats = !showStats">{{ showStats ? '閉じる ▲' : '表示する ▼' }}</button>
    </div>
    <div v-if="showStats" class="stats">
      <div v-if="statRows.some(r => r.id === 'G005')" class="npc-summary">
        NPC相手の遠隔兵戦闘力 <strong>+{{ fmt(npcRangedTotal) }}%</strong>
        <small>通常遠隔 {{ fmt(npcRanged) }}% ＋ NPC専用 {{ fmt(statRows.find(r => r.id === 'G005')?.effective ?? 0) }}%</small>
      </div>
      <section v-for="group in grouped" :key="group.title" class="stat-group">
        <h3>{{ group.title }}</h3>
        <div v-for="row in group.rows" :key="row.id" class="stat-row">
          <div class="stat-main"><span>{{ row.name }}</span><strong>+{{ fmt(row.effective) }}{{ row.unit }}</strong></div>
          <div class="stat-breakdown">装備 {{ fmt(row.equipment) }}{{ row.unit }}<template v-if="row.cap !== null">（上限 {{ fmt(row.cap) }}{{ row.unit }}）</template> ＋ ジェム {{ fmt(row.gem) }}{{ row.unit }}</div>
        </div>
      </section>
      <p class="footnote">現在登録されている武具・ジェムから再計算した値です。ゲーム内の補正・表示方法と完全一致する保証はありません。</p>
    </div>
  </section>
</template>

<style scoped>
.commander-panel{border:1px solid #8d724b;border-radius:10px;overflow:hidden;background:#f4ead6;color:#392c1d;margin:12px 0}
.panel-header{background:#594331;color:#fff2d5;padding:12px 14px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
.panel-header span{font-size:12px}
.slot-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;padding:12px}
.slot{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:0;min-height:100px;border:2px solid #9a8263;border-radius:7px;background:#e3d2b3;color:#392c1d;cursor:pointer;padding:6px 2px}
.slot.active{background:#fff0ca;border-color:#9c671e;box-shadow:0 0 0 2px #e3b963}
.slot-number{font-size:11px;overflow-wrap:anywhere}
.detail{padding:14px;background:#fffaf0}
.detail h3{font-size:16px;margin-bottom:10px}
.detail h4{font-size:14px}
.effect-row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid #e7d9c3;font-size:13px}
.effect-row b{white-space:nowrap}
.status-header{background:#594331;color:#fff2d5;display:flex;justify-content:space-between;padding:12px 14px;gap:10px}
.status-header button{color:inherit;text-decoration:underline}
.stats{padding:10px}
.npc-summary{padding:12px;background:#e5f0e1;border:1px solid #9dbb93;border-radius:5px;display:flex;justify-content:space-between;gap:5px;flex-wrap:wrap}
.npc-summary small{width:100%;color:#53614e}
.stat-group{margin:12px 0}
.stat-group h3{background:#8d6848;color:white;font-size:14px;padding:9px}
.stat-row{padding:10px;border-bottom:1px solid #ddccb4}
.stat-main{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:13px}
.stat-main strong{font-size:15px;white-space:nowrap}
.stat-breakdown{font-size:11px;color:#725e48;margin-top:5px}
.footnote{font-size:11px;color:#725e48;padding:8px}
@media(max-width:600px){.slot-grid{gap:4px;padding:7px}.slot{min-height:88px}.slot-number{font-size:10px}.stat-main{align-items:flex-start}}
</style>
