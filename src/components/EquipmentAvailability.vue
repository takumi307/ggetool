<script setup lang="ts">
import { SLOT_LABELS, type SlotType } from '@/domain'

defineProps<{ slots: { slot: SlotType; available: number }[] }>()
</script>

<template>
  <ul class="d-flex flex-wrap ga-2 list-unstyled pa-0" aria-label="部位ごとの使用可能な装備">
    <li v-for="{ slot, available } in slots" :key="slot">
      <v-chip v-if="available" color="success" size="small">
        {{ SLOT_LABELS[slot] }} {{ available }}件
      </v-chip>
      <v-chip v-else color="warning" size="small" :to="{ path: '/equipment/edit', query: { slot } }">
        {{ SLOT_LABELS[slot] }}を登録
      </v-chip>
    </li>
  </ul>
</template>

<style scoped>
.list-unstyled { list-style: none; }
</style>
