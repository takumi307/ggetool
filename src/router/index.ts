import { createRouter, createWebHashHistory } from 'vue-router'

const Placeholder = () => import('@/views/PlaceholderView.vue')

// 13画面（設計書 §12）。Phase 1 は画面枠のみ、Phase ごとに実体へ差し替える。
export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { title: 'ダッシュボード' } },
    { path: '/equipment', name: 'equipment', component: Placeholder, meta: { title: '装備管理', phase: 2, desc: '部位別タブで装備を一覧・比較します。' } },
    { path: '/equipment/edit/:id?', name: 'equipment-edit', component: Placeholder, meta: { title: '装備登録・編集', phase: 2, desc: '装備の新規登録と編集。' } },
    { path: '/gems', name: 'gems', component: Placeholder, meta: { title: 'ジェム管理', phase: 2, desc: 'ジェムの一覧と所持・装着状況。' } },
    { path: '/gems/edit/:id?', name: 'gem-edit', component: Placeholder, meta: { title: 'ジェム登録・編集', phase: 2, desc: 'ジェムの新規登録と編集。' } },
    { path: '/stats', name: 'stats', component: Placeholder, meta: { title: 'ステータス・上限管理', phase: 2, desc: '効果名・上限値・上限未確認の管理。' } },
    { path: '/presets', name: 'presets', component: Placeholder, meta: { title: 'ビルドプリセット管理', phase: 2, desc: '目標値・最大化ステータス順位の編集。' } },
    { path: '/plan', name: 'plan', component: Placeholder, meta: { title: 'ビルド作成計画', phase: 4, desc: '作成個数と優先順位の設定。' } },
    { path: '/optimize', name: 'optimize', component: Placeholder, meta: { title: '最適化実行', phase: 3, desc: '最適化の実行と探索状況の表示。' } },
    { path: '/result', name: 'result', component: Placeholder, meta: { title: '最適化結果', phase: 3, desc: '構成・ステータス判定・選定理由の表示。' } },
    { path: '/commanders', name: 'commanders', component: Placeholder, meta: { title: '保存済み司令官一覧', phase: 3, desc: '保存した構成と装備使用状態。' } },
    { path: '/backup', name: 'backup', component: Placeholder, meta: { title: 'JSONバックアップ・復元', phase: 2, desc: 'エクスポート／インポート。' } },
    { path: '/settings', name: 'settings', component: Placeholder, meta: { title: '設定', phase: 2, desc: 'アプリ設定。' } },
  ],
})
