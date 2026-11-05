<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useDisplay } from 'vuetify'
import { useRoute, useRouter } from 'vue-router'
import { NAV_ITEMS } from '@/navigation'
import { useAppStore } from '@/stores/app'

const { mdAndUp } = useDisplay()
const route = useRoute()
const router = useRouter()
const app = useAppStore()
const moreOpen = ref(false)

const bottomItems = NAV_ITEMS.filter((i) => i.bottom)
const moreItems = NAV_ITEMS.filter((i) => !i.bottom)
const activeBottom = computed(() => bottomItems.find((i) => route.path === i.path || (i.path !== '/' && route.path.startsWith(i.path)))?.name ?? 'more')

function go(path: string) { moreOpen.value = false; router.push(path) }
onMounted(() => { app.init() })
</script>

<template>
  <v-app>
    <v-navigation-drawer v-if="mdAndUp" permanent width="240">
      <v-list-item title="E4K Commander Builder" subtitle="Phase 1" class="py-4" />
      <v-divider />
      <v-list nav density="comfortable">
        <v-list-item
          v-for="i in NAV_ITEMS" :key="i.name" :prepend-icon="i.icon" :title="i.title"
          :active="route.path === i.path" @click="go(i.path)"
        />
      </v-list>
    </v-navigation-drawer>

    <v-app-bar v-if="!mdAndUp" density="comfortable" flat border="b">
      <v-app-bar-title>{{ route.meta.title ?? 'E4K Commander Builder' }}</v-app-bar-title>
    </v-app-bar>

    <v-main>
      <v-container fluid class="pa-4" :style="{ maxWidth: '1200px' }">
        <v-alert v-if="app.ready && !app.persistent" type="warning" class="mb-4" variant="tonal">
          IndexedDBを利用できないため、データは保存されません（ページを閉じると消えます）。{{ app.error }}
        </v-alert>
        <router-view v-if="app.ready" />
        <v-progress-linear v-else indeterminate />
      </v-container>
    </v-main>

    <v-bottom-navigation v-if="!mdAndUp" :model-value="activeBottom" grow color="primary">
      <v-btn v-for="i in bottomItems" :key="i.name" :value="i.name" @click="go(i.path)">
        <v-icon>{{ i.icon }}</v-icon><span>{{ i.title.slice(0, 6) }}</span>
      </v-btn>
      <v-btn value="more" @click="moreOpen = true"><v-icon>mdi-dots-horizontal</v-icon><span>その他</span></v-btn>
    </v-bottom-navigation>

    <v-bottom-sheet v-model="moreOpen">
      <v-card>
        <v-list>
          <v-list-item v-for="i in moreItems" :key="i.name" :prepend-icon="i.icon" :title="i.title" @click="go(i.path)" />
        </v-list>
      </v-card>
    </v-bottom-sheet>
  </v-app>
</template>
