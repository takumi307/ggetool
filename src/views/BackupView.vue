<script setup lang="ts">
import { ref } from 'vue'
import { useDb, useAppStore } from '@/stores/app'
import { exportBackup, parseBackup, importBackup, type BackupData } from '@/domain/backup'
const app = useAppStore()
const preview = ref<BackupData | null>(null), error = ref(''), success = ref(''), busy = ref(false)
async function download() {
  error.value = ''
  try {
    const data = await exportBackup(useDb())
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'e4k-backup-' + new Date().toISOString().slice(0, 10) + '.json'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (e) { error.value = String(e) }
}
async function selectFile(event: Event) {
  error.value = ''; success.value = ''; preview.value = null
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    if (file.size > 20 * 1024 * 1024) throw Error('20MBを超えるファイルは読み込めません')
    preview.value = parseBackup(await file.text())
  } catch (e) { error.value = String(e) }
}
async function restore() {
  if (!preview.value || !confirm('現在の全データをバックアップの内容で置換します。続けますか？')) return
  busy.value = true; error.value = ''
  try {
    await importBackup(useDb(), preview.value)
    await app.refreshCounts()
    preview.value = null
    success.value = '復元しました'
  } catch (e) { error.value = String(e) } finally { busy.value = false }
}
</script>
<template>
  <h2 class="text-h6 mb-3">JSONバックアップ・復元</h2>
  <v-alert type="info" variant="tonal" class="mb-4">データはこのブラウザに保存されます。定期的にバックアップを保存してください。</v-alert>
  <v-btn color="primary" class="mb-6" @click="download">全データをJSONで保存</v-btn>
  <h3 class="text-subtitle-1 mb-2">バックアップから復元</h3>
  <input type="file" accept=".json,application/json" @change="selectFile" />
  <v-alert v-if="error" type="error" class="mt-3">{{ error }}</v-alert>
  <v-alert v-if="success" type="success" class="mt-3">{{ success }}</v-alert>
  <v-card v-if="preview" class="pa-4 mt-4">
    <strong>復元プレビュー</strong>
    <p>作成日：{{ preview.exportedAt }}</p>
    <p v-for="(rows, name) in preview.stores" :key="name">{{ name }}：{{ rows.length }}件</p>
    <v-alert type="warning" variant="tonal" class="my-3">復元すると現在の全データが置換されます。必ず先に現在のデータを保存してください。</v-alert>
    <v-btn color="error" :loading="busy" @click="restore">確認して全件置換</v-btn>
  </v-card>
</template>
