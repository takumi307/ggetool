import { createRouter, createWebHashHistory } from 'vue-router'
const Placeholder = () => import('@/views/PlaceholderView.vue')
export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { title: 'ダッシュボード' } },
    { path: '/equipment', name: 'equipment', component: () => import('@/views/ItemsView.vue'), props: { kind: 'equipment' }, meta: { title: '装備管理', phase: 2 } },
    { path: '/equipment/edit/:id?', name: 'equipment-edit', component: () => import('@/views/ItemEditView.vue'), props: { kind: 'equipment' }, meta: { title: '装備登録・編集', phase: 2 } },
    { path: '/gems', name: 'gems', component: () => import('@/views/ItemsView.vue'), props: { kind: 'gems' }, meta: { title: 'ジェム管理', phase: 2 } },
    { path: '/gems/edit/:id?', name: 'gem-edit', component: () => import('@/views/ItemEditView.vue'), props: { kind: 'gems' }, meta: { title: 'ジェム登録・編集', phase: 2 } },
    { path: '/stats', name: 'stats', component: () => import('@/views/StatsView.vue'), meta: { title: 'ステータス・上限管理', phase: 2 } },
    { path: '/presets', name: 'presets', component: () => import('@/views/PresetsView.vue'), meta: { title: 'ビルドプリセット管理', phase: 2 } },
    { path: '/plan', name: 'plan', component: Placeholder, meta: { title: 'ビルド作成計画', phase: 4, desc: '作成個数と優先順位の設定。' } },
    { path: '/optimize', name: 'optimize', component: () => import('@/views/OptimizeView.vue'), meta: { title: '最適化実行', phase: 3 } },
    { path: '/result', name: 'result', component: Placeholder, meta: { title: '最適化結果', phase: 3, desc: '結果の保存機能は次回実装。' } },
    { path: '/commanders', name: 'commanders', component: () => import('@/views/CommandersView.vue'), meta: { title: '保存済み司令官一覧', phase: 3 } },
    { path: '/backup', name: 'backup', component: () => import('@/views/BackupView.vue'), meta: { title: 'JSONバックアップ・復元', phase: 2 } },
    { path: '/settings', name: 'settings', component: Placeholder, meta: { title: '設定', phase: 2, desc: 'アプリ設定。' } },
  ],
})
