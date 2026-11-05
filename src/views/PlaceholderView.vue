<script setup lang="ts">
import { useRoute } from 'vue-router'
const route = useRoute()
</script>

<template>
  <v-card class="pa-4">
    <v-card-title>{{ route.meta.title }}</v-card-title>
    <v-card-text>
      <p>{{ route.meta.desc }}</p>
      <v-chip class="mt-3" color="grey" size="small">Phase {{ route.meta.phase }} で実装予定（未実装）</v-chip>
    </v-card-text>
  </v-card>
</template>
