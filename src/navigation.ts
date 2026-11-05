export interface NavItem { name: string; title: string; icon: string; path: string; bottom?: boolean }

/** サイドナビ(PC)は全件、ボトムナビ(スマホ)は bottom:true + 「その他」 */
export const NAV_ITEMS: NavItem[] = [
  { name: 'dashboard', title: 'ダッシュボード', icon: 'mdi-view-dashboard', path: '/', bottom: true },
  { name: 'equipment', title: '装備管理', icon: 'mdi-shield-sword', path: '/equipment', bottom: true },
  { name: 'gems', title: 'ジェム管理', icon: 'mdi-diamond-stone', path: '/gems', bottom: true },
  { name: 'optimize', title: '最適化実行', icon: 'mdi-calculator-variant', path: '/optimize', bottom: true },
  { name: 'stats', title: 'ステータス・上限', icon: 'mdi-chart-bar', path: '/stats' },
  { name: 'presets', title: 'ビルドプリセット', icon: 'mdi-clipboard-list', path: '/presets' },
  { name: 'plan', title: 'ビルド作成計画', icon: 'mdi-calendar-check', path: '/plan' },
  { name: 'result', title: '最適化結果', icon: 'mdi-trophy', path: '/result' },
  { name: 'commanders', title: '保存済み司令官', icon: 'mdi-account-star', path: '/commanders' },
  { name: 'backup', title: 'バックアップ・復元', icon: 'mdi-database-export', path: '/backup' },
  { name: 'settings', title: '設定', icon: 'mdi-cog', path: '/settings' },
]
