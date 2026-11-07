<script setup lang="ts">
import { useAppStore } from '@/stores/app'
import { SCHEMA_VERSION } from '@/domain'

const app = useAppStore()
const { roleLabel } = app
</script>
<template>
  <h2 class="text-h6 mb-4">設定</h2>
  <v-card class="pa-4 mb-4">
    <h3 class="text-subtitle-1 font-weight-bold mb-3">データの保存状態</h3>
    <v-chip :color="app.persistent ? 'success' : 'warning'" class="mb-3">
      {{ app.persistent ? 'このブラウザに保存中（IndexedDB）' : '一時保存（ブラウザ終了時に消える可能性）' }}
    </v-chip>
    <p class="text-body-2 mb-2">データはこの端末・ブラウザに保存され、他の端末とは自動同期されません。</p>
    <v-row dense>
      <v-col cols="6" sm="4">装備：{{ app.counts.equipment }}件</v-col>
      <v-col cols="6" sm="4">ジェム：{{ app.counts.gems }}件</v-col>
      <v-col cols="6" sm="4">効果定義：{{ app.counts.stats }}件</v-col>
      <v-col cols="6" sm="4">プリセット：{{ app.counts.presets }}件</v-col>
      <v-col cols="6" sm="4">{{ roleLabel }}：{{ app.counts.commanders }}体</v-col>
    </v-row>
    <v-btn class="mt-3" variant="outlined" color="primary" to="/backup">JSONバックアップ・復元へ</v-btn>
  </v-card>
  <v-card class="pa-4 mb-4">
    <h3 class="text-subtitle-1 font-weight-bold mb-3">最適化設定</h3>
    <p class="text-body-2 mb-3">実行先と計算時間は最適化実行画面で選択します。</p>
    <v-btn variant="outlined" color="primary" to="/optimize">最適化実行へ</v-btn>
  </v-card>
  <v-card class="pa-4">
    <h3 class="text-subtitle-1 font-weight-bold mb-2">アプリ情報</h3>
    <p class="text-body-2">E4K Commander Builder</p>
    <p class="text-body-2">データ形式バージョン：{{ SCHEMA_VERSION }}</p>
    <p class="text-caption mt-2">ブラウザのサイトデータを消去すると、保存データも消える場合があります。定期的にJSONバックアップを取得してください。</p>
  </v-card>
</template>
