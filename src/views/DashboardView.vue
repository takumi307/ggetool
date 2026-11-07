<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAppStore, useDb } from '@/stores/app'
import EquipmentAvailability from '@/components/EquipmentAvailability.vue'
import { equipmentAvailability } from '@/domain/equipmentAvailability'

const app = useAppStore()
const db = useDb()
const slots = ref<ReturnType<typeof equipmentAvailability>>([])
const error = ref('')
const canBuild = computed(() => slots.value.length > 0 && slots.value.every(slot => slot.available > 0))
const nextStep = computed(() => {
  if (!canBuild.value) return { to: '/equipment', label: '装備管理へ' }
  if (!app.counts.presets) return { to: '/presets', label: '目標を設定' }
  return { to: '/optimize?mode=single', label: '1体を最適化' }
})
onMounted(async () => {
  try {
    const [equipment, allocations] = await Promise.all([
      db.repo('equipment').getAll(), db.repo('equipmentAllocations').getAll(),
    ])
    slots.value = equipmentAvailability(equipment, allocations)
  } catch (cause) { error.value = String(cause) }
})
</script>

<template>
  <header class="mb-4">
    <div class="text-overline">{{ app.roleLabel }}ビルダー</div>
    <h2 class="text-h5">ダッシュボード</h2>
  </header>
  <v-alert v-if="error" type="error" class="mb-4">{{ error }}</v-alert>
  <v-card class="pa-4 mb-4" variant="outlined">
    <h3 class="text-subtitle-1 font-weight-bold mb-3">ビルドを作る</h3>
    <v-row dense>
      <v-col cols="12" md="4">
        <div class="text-subtitle-2 mb-2">1. 4部位の装備を用意</div>
        <EquipmentAvailability v-if="slots.length" :slots="slots" />
        <p class="text-caption mt-2">件数は未使用の装備。ジェムは任意です。</p>
      </v-col>
      <v-col cols="12" md="4">
        <div class="text-subtitle-2 mb-2">2. 目標を選ぶ</div>
        <p class="text-body-2">{{ app.counts.presets ? '登録済みのプリセットを使えます。' : 'プリセットに効果と最低値を登録します。' }}</p>
      </v-col>
      <v-col cols="12" md="4">
        <div class="text-subtitle-2 mb-2">3. 計算して保存</div>
        <p class="text-body-2">結果を確認してから、構成を保存します。</p>
      </v-col>
    </v-row>
    <div class="d-flex flex-wrap ga-2 mt-4">
      <v-btn v-if="slots.length" color="primary" :to="nextStep.to">{{ nextStep.label }}</v-btn>
      <v-btn variant="outlined" to="/commanders">保存済みの構成（{{ app.counts.commanders }}）</v-btn>
    </div>
  </v-card>
  <v-row dense>
    <v-col v-for="item in [
      { label: '装備', count: app.counts.equipment, to: '/equipment', icon: 'mdi-shield-sword' },
      { label: 'ジェム', count: app.counts.gems, to: '/gems', icon: 'mdi-diamond-stone' },
      { label: 'プリセット', count: app.counts.presets, to: '/presets', icon: 'mdi-clipboard-list' },
      { label: '作成計画', count: app.counts.plans, to: '/plan', icon: 'mdi-calendar-check' },
    ]" :key="item.to" cols="6" md="3">
      <v-card :to="item.to" class="pa-3" variant="tonal">
        <v-icon :icon="item.icon" size="small" class="mr-1" />
        <span class="text-body-2">{{ item.label }}</span>
        <div class="text-h6">{{ item.count }}件</div>
      </v-card>
    </v-col>
  </v-row>
</template>
