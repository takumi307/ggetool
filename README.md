# E4K Commander Builder

## セットアップ
```
npm install
npm run dev        # 開発サーバー
npm test           # Vitest
npm run typecheck
npm run build
```

## 構成
- `src/domain`        型・初期データ（Vue/IndexedDB非依存。最適化エンジンは Phase 3 で `domain/optimizer` に追加）
- `src/repositories`  `Database` インターフェース + IndexedDB / Memory 実装
- `src/stores`        Pinia
- `src/views`         13画面（Phase 1 は枠のみ）
