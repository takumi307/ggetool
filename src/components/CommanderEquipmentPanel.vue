<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { SLOT_LABELS, type SlotType, type CommanderBuild, type Equipment, type Gem, type StatDefinition } from '@/domain'

const props = defineProps<{ build: CommanderBuild; equipment: Equipment[]; gems: Gem[]; stats: StatDefinition[] }>()
type DisplaySlot = SlotType | 'banner'
const selectedSlot = ref<DisplaySlot>('helmet')
const slots: { key: DisplaySlot; icon: string; title: string }[] = [
  { key: 'helmet', icon: 'mdi-helmet', title: '兜' },
  { key: 'armor', icon: 'mdi-shield', title: '鎧' },
  { key: 'weapon', icon: 'mdi-sword', title: '武器' },
  { key: 'artifact', icon: 'mdi-medal', title: '工芸品' },
  { key: 'banner', icon: 'mdi-flag', title: '旗（未対応）' },
]
watch(() => props.build.id, () => { selectedSlot.value = 'helmet' })
const item = computed(() => selectedSlot.value === 'banner' ? undefined :
  props.equipment.find(e => e.id === props.build.equipmentIds[selectedSlot.value as SlotType]))
const gem = computed(() => selectedSlot.value === 'banner' ? undefined :
  props.gems.find(g => g.id === props.build.gemAssignments.find(a => a.slotType === selectedSlot.value)?.gemId))
const statName = (id: string) => props.stats.find(s => s.id === id)?.name ?? id
const statUnit = (id: string) => props.stats.find(s => s.id === id)?.unit ?? '%'
const hasItem = (slot: DisplaySlot) => slot !== 'banner' && !!props.build.equipmentIds[slot]
const itemTitle = computed(() => selectedSlot.value === 'banner' ? '旗（現在は登録対象外）' : SLOT_LABELS[selectedSlot.value])
</script>

<template>
  <section class="commander-panel" aria-label="司令官の装備セット">
    <header class="commander-panel__header">
      <span>あなたのセット 司令官</span>
      <span class="commander-panel__sub">装備を選択して効果を確認</span>
    </header>
    <div class="commander-panel__slots">
      <button v-for="slot in slots" :key="slot.key" type="button"
        class="commander-panel__slot" :class="{ 'commander-panel__slot--active': selectedSlot === slot.key, 'commander-panel__slot--empty': !hasItem(slot.key) }"
        :aria-pressed="selectedSlot === slot.key" :aria-label="slot.title + 'の詳細を見る'"
        @click="selectedSlot = slot.key">
        <v-icon :icon="slot.icon" size="38" />
        <span>{{ slot.title }}</span>
      </button>
    </div>
    <div class="commander-panel__gems" aria-label="ジェムの装着状況">
      <div v-for="slot in slots" :key="slot.key" class="commander-panel__gem" :class="{ 'commander-panel__gem--active': selectedSlot === slot.key }">
        <v-icon icon="mdi-diamond-stone" size="23" />
        <span>{{ slot.key === 'banner' ? '—' : build.gemAssignments.some(a => a.slotType === slot.key) ? '装着済' : 'なし' }}</span>
      </div>
    </div>
    <div class="commander-panel__detail" aria-live="polite">
      <h3>{{ itemTitle }}の詳細</h3>
      <template v-if="selectedSlot === 'banner'">
        <p>現在の最適化では旗は使用しません。将来の拡張用スロットです。</p>
      </template>
      <template v-else>
        <p class="commander-panel__item-name">{{ item?.name ?? '装備なし（または登録データがありません）' }}</p>
        <div v-if="item?.effects.length" class="commander-panel__effects">
          <div v-for="(effect, index) in item.effects" :key="index">
            <span>{{ statName(effect.statId) }}</span>
            <strong>+{{ effect.value }}{{ statUnit(effect.statId) }}</strong>
          </div>
        </div>
        <p class="commander-panel__gem-title">ジェム：{{ gem?.name ?? 'なし' }}</p>
        <div v-if="gem?.effects.length" class="commander-panel__effects">
          <div v-for="(effect, index) in gem.effects" :key="index">
            <span>{{ statName(effect.statId) }}</span>
            <strong>+{{ effect.value }}{{ statUnit(effect.statId) }}</strong>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.commander-panel{background:#342419;color:#f0ddbb;border:1px solid #916735;border-radius:12px;overflow:hidden;margin-bottom:16px}
.commander-panel__header{background:#281b12;border-bottom:1px solid #8b6335;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;gap:12px;color:#f4bd55;font-weight:700;flex-wrap:wrap}
.commander-panel__sub{font-size:12px;color:#bca789;font-weight:400}
.commander-panel__slots,.commander-panel__gems{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;padding:12px}
.commander-panel__slot{display:flex;flex-direction:column;justify-content:center;align-items:center;gap:7px;min-height:100px;min-width:0;border:2px solid #7e603b;border-radius:7px;background:#211b16;color:#f0c579;cursor:pointer;font:inherit}
.commander-panel__slot:hover,.commander-panel__slot:focus-visible{border-color:#f1c36b;outline-offset:2px}
.commander-panel__slot--active{border-color:#ffcf6c;background:#55402a;box-shadow:inset 0 0 0 1px #f1c36b}
.commander-panel__slot--empty{color:#806d55}
.commander-panel__slot span{font-size:12px}
.commander-panel__gems{padding-top:0;border-bottom:1px solid #73512d}
.commander-panel__gem{display:flex;flex-direction:column;align-items:center;gap:2px;background:#302218;border:1px solid #62472e;border-radius:5px;color:#998164;padding:7px 2px;font-size:11px}
.commander-panel__gem--active{border-color:#d4a557}
.commander-panel__detail{padding:16px 18px;background:#2b2018}
.commander-panel__detail h3{color:#f4c56e;font-size:17px;margin-bottom:8px}
.commander-panel__detail p{margin-bottom:8px}
.commander-panel__item-name{font-weight:600}
.commander-panel__effects>div{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid #5b4734}
.commander-panel__effects strong{color:#f3c56c;white-space:nowrap}
.commander-panel__gem-title{margin-top:14px;font-weight:600}
@media(max-width:600px){.commander-panel__slots,.commander-panel__gems{gap:4px;padding:8px}.commander-panel__slot{min-height:76px}.commander-panel__slot .v-icon{font-size:28px!important}.commander-panel__slot span{font-size:10px}.commander-panel__detail{padding:12px}}
</style>
