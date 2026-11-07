<script setup lang="ts">
import { useAppStore } from '@/stores/app'
const app = useAppStore()
const rows = [
  ['equipment', '装備'], ['gems', 'ジェム'], ['stats', 'ステータス定義'],
  ['presets', 'ビルドプリセット'], ['plans', '作成計画'], ['commanders', '保存済み' + app.roleLabel],
] as const
</script>

<template>
  <h2 class="text-h6 mb-3">ダッシュボード</h2>
  <v-row>
    <v-col v-for="[k, label] in rows" :key="k" cols="6" md="4">
      <v-card class="pa-3">
        <div class="text-caption">{{ label }}</div>
        <div class="text-h5">{{ app.counts[k] }}</div>
      </v-card>
    </v-col>
  </v-row>
  <v-chip class="mt-4" :color="app.persistent ? 'success' : 'warning'" size="small">
    {{ app.persistent ? 'IndexedDB 接続OK' : 'メモリ保存（非永続）' }}
  </v-chip>
</template>
