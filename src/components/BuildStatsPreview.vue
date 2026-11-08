<script setup lang="ts">
import { computed } from 'vue'
import { buildBreakdown, effectiveTotals, knownCaps } from '@/domain/effects'
import type { OptimizationResult } from '@/domain/optimizer'
import type { CommanderBuild, Equipment, Gem, StatDefinition } from '@/domain'
const props = defineProps<{ result: OptimizationResult; previous?: CommanderBuild; equipment: Equipment[]; gems: Gem[]; stats: StatDefinition[] }>()
const name = (id: string) => props.stats.find(s => s.id === id)?.name ?? id
const unit = (id: string) => props.stats.find(s => s.id === id)?.unit ?? '%'
const round = (n: number) => Number(n.toFixed(3))
const current = computed(() => {
  const parts = buildBreakdown(props.result, props.equipment, props.gems)
  return effectiveTotals(parts.equipment, parts.gem, knownCaps(props.stats))
})
const previous = computed(() => {
  if (!props.previous) return null
  const parts = buildBreakdown(props.previous, props.equipment, props.gems)
  return parts.missingItems ? null : effectiveTotals(parts.equipment, parts.gem, knownCaps(props.stats))
})
const rows = computed(() => [...new Set([...Object.keys(current.value), ...Object.keys(previous.value ?? {})])]
  .map(id => ({ id, value: current.value[id] ?? 0, old: previous.value?.[id] ?? 0,
    delta: (current.value[id] ?? 0) - (previous.value?.[id] ?? 0) }))
  .filter(row => row.value || row.old))
</script>
<template>
  <section aria-label="構成の効果" class="mt-3">
    <h4 class="text-subtitle-2 mb-2">目標達成状況</h4>
    <p v-if="!result.shortfalls.length" class="text-body-2">最低目標なし。指定された効果の採点で比較しています。</p>
    <div v-for="target in result.shortfalls" :key="target.statId" class="d-flex flex-wrap ga-2 align-center mb-2">
      <span>{{ name(target.statId) }}：{{ round(target.actual) }} / {{ target.required }}{{ unit(target.statId) }}</span>
      <v-chip size="x-small" :color="target.missing > 0 ? 'warning' : 'success'">{{ target.missing > 0 ? '不足 ' + round(target.missing) : '達成' }}</v-chip>
    </div>
    <h4 class="text-subtitle-2 mt-4 mb-2">上限適用後の効果{{ previous ? '・現在の構成との差分' : '' }}</h4>
    <v-table density="compact">
      <thead><tr><th>効果</th><th v-if="previous">現在</th><th>候補</th><th v-if="previous">増減</th></tr></thead>
      <tbody><tr v-for="row in rows" :key="row.id">
        <td>{{ name(row.id) }}</td><td v-if="previous">{{ round(row.old) }}{{ unit(row.id) }}</td>
        <td>{{ round(row.value) }}{{ unit(row.id) }}</td>
        <td v-if="previous" :class="row.delta > 0 ? 'text-success' : row.delta < 0 ? 'text-error' : ''">
          {{ row.delta > 0 ? '+' : '' }}{{ round(row.delta) }}{{ unit(row.id) }}
        </td>
      </tr></tbody>
    </v-table>
  </section>
</template>
