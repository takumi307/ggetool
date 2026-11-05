<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useAppStore, useDb } from '@/stores/app'
import { SCHEMA_VERSION, type AppSettings } from '@/domain'

const app = useAppStore()
const settings = ref<AppSettings | null>(null)
const error = ref('')
const notice = ref('')
const busy = ref(false)
const algorithms = [
  { title: '自動（推奨）', value: 'auto' },
  { title: '高精度（最大100万候補）', value: 'precise' },
  { title: '高速（候補を絞り込み）', value: 'fast' }
]
onMounted(async () => {
  try { settings.value = await useDb().repo('settings').get('app') ?? { id: 'app', schemaVersion: SCHEMA_VERSION, optimizerId: 'auto' } }
  catch (e) { error.value = String(e) }
})
async function save() {
  if (!settings.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    if (settings.value.optimizerId === 'default') settings.value.optimizerId = 'auto'
    if (!algorithms.some(a => a.value === settings.value?.optimizerId)) throw Error('未対応の探索方式です')
    await useDb().repo('settings').put({ ...settings.value, schemaVersion: SCHEMA_VERSION })
    notice.value = '設定を保存しました'
  } catch (e) { error.value = String(e) } finally { busy.value = false }
}
</script>
<template>
  <h2 class="text-h6 mb-4">設定</h2>
  <v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert>
  <v-alert v-if="notice" type="success" class="mb-3">{{ notice }}</v-alert>
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
      <v-col cols="6" sm="4">司令官：{{ app.counts.commanders }}体</v-col>
    </v-row>
    <v-btn class="mt-3" variant="outlined" color="primary" to="/backup">JSONバックアップ・復元へ</v-btn>
  </v-card>
  <v-card class="pa-4 mb-4">
    <h3 class="text-subtitle-1 font-weight-bold mb-3">最適化設定</h3>
    <v-select v-if="settings" v-model="settings.optimizerId" :items="algorithms" label="探索方式" />
    <p class="text-caption mb-3">自動は候補数に応じて方式を選択。高精度は最大100万件を探索し、全候補を調べた場合のみ最適性を保証。高速は候補を事前に絞るため常に暫定解です。大規模な探索は端末が一時的に重くなる場合があります。</p>
    <v-btn color="primary" :loading="busy" :disabled="!settings" @click="save">設定を保存</v-btn>
  </v-card>
  <v-card class="pa-4">
    <h3 class="text-subtitle-1 font-weight-bold mb-2">アプリ情報</h3>
    <p class="text-body-2">E4K Commander Builder</p>
    <p class="text-body-2">データ形式バージョン：{{ SCHEMA_VERSION }}</p>
    <p class="text-caption mt-2">ブラウザのサイトデータを消去すると、保存データも消える場合があります。定期的にJSONバックアップを取得してください。</p>
  </v-card>
</template>
