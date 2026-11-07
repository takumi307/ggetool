<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useDisplay } from 'vuetify'
import { useRoute, useRouter } from 'vue-router'
import type { BuildWorkspace } from '@/domain/workspace'
import { NAV_ITEMS } from '@/navigation'
import { useAppStore } from '@/stores/app'

const { mdAndUp } = useDisplay()
const route = useRoute()
const router = useRouter()
const app = useAppStore()
const moreOpen = ref(false)
const changingWorkspace = ref(false)
const workspaceError = ref('')

const bottomItems = NAV_ITEMS.filter((i) => i.bottom)
const moreItems = NAV_ITEMS.filter((i) => !i.bottom)
const activeBottom = computed(() => bottomItems.find((i) => route.path === i.path || (i.path !== '/' && route.path.startsWith(i.path)))?.name ?? 'more')

const navTitle = (title: string) => title.replace('司令官', app.roleLabel)
function go(path: string) { moreOpen.value = false; router.push(path) }
function savedWorkspace(): BuildWorkspace {
  try { return localStorage.getItem('e4k-workspace') === 'castellan' ? 'castellan' : 'commander' }
  catch { return 'commander' }
}
async function openWorkspace(workspace: BuildWorkspace) {
  if (changingWorkspace.value) return
  changingWorkspace.value = true
  workspaceError.value = ''
  try {
    if (app.ready) {
      if (route.name === 'equipment-edit' || route.name === 'gem-edit') {
        await router.replace(route.name === 'equipment-edit' ? '/equipment' : '/gems')
      } else if (route.query.id || route.query.presetId) {
        await router.replace({ path: route.path })
      }
    }
    await app.init(workspace)
    try { localStorage.setItem('e4k-workspace', workspace) } catch { /* storage may be disabled */ }
  } catch (error) {
    workspaceError.value = String(error)
  } finally {
    changingWorkspace.value = false
  }
}
function switchWorkspace(value: unknown) {
  if ((value === 'commander' || value === 'castellan') && value !== app.workspace) void openWorkspace(value)
}
onMounted(() => { void openWorkspace(savedWorkspace()) })
</script>

<template>
  <v-app>
    <v-navigation-drawer v-if="mdAndUp" permanent width="240">
      <v-list-item title="E4K Commander Builder" :subtitle="app.roleLabel + '装備・ジェム最適化'" class="py-4" />
      <v-divider />
      <v-list nav density="comfortable">
        <v-list-item
          v-for="i in NAV_ITEMS" :key="i.name" :prepend-icon="i.icon" :title="navTitle(i.title)"
          :active="route.path === i.path" @click="go(i.path)"
        />
      </v-list>
    </v-navigation-drawer>

    <v-app-bar v-if="!mdAndUp" density="comfortable" flat border="b">
      <v-app-bar-title>{{ navTitle(String(route.meta.title ?? 'E4K Commander Builder')) }}</v-app-bar-title>
    </v-app-bar>

    <v-main>
      <v-container fluid class="pa-4" :style="{ maxWidth: '1200px' }">
        <v-tabs :model-value="app.workspace" aria-label="装備ビルダーの種類" color="primary" class="mb-4"
          @update:model-value="switchWorkspace">
          <v-tab value="commander" :disabled="changingWorkspace">司令官</v-tab>
          <v-tab value="castellan" :disabled="changingWorkspace">城代</v-tab>
        </v-tabs>
        <v-alert v-if="workspaceError" type="error" class="mb-4">{{ workspaceError }}</v-alert>
        <v-alert v-if="app.ready && !app.persistent" type="warning" class="mb-4" variant="tonal">
          IndexedDBを利用できないため、データは保存されません（ページを閉じると消えます）。{{ app.error }}
        </v-alert>
        <router-view v-if="app.ready" :key="app.workspace" />
        <v-progress-linear v-else-if="changingWorkspace" indeterminate />
      </v-container>
    </v-main>

    <v-bottom-navigation v-if="!mdAndUp" :model-value="activeBottom" grow color="primary">
      <v-btn v-for="i in bottomItems" :key="i.name" :value="i.name" @click="go(i.path)">
        <v-icon>{{ i.icon }}</v-icon><span>{{ navTitle(i.title).slice(0, 6) }}</span>
      </v-btn>
      <v-btn value="more" @click="moreOpen = true"><v-icon>mdi-dots-horizontal</v-icon><span>その他</span></v-btn>
    </v-bottom-navigation>

    <v-bottom-sheet v-model="moreOpen">
      <v-card>
        <v-list>
          <v-list-item v-for="i in moreItems" :key="i.name" :prepend-icon="i.icon" :title="navTitle(i.title)" @click="go(i.path)" />
        </v-list>
      </v-card>
    </v-bottom-sheet>
  </v-app>
</template>
