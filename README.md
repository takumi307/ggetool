# E4K Commander Builder

## セットアップ
```bash
bun install        # bun.lock を生成・更新
bun run dev        # 開発サーバー
bun run test       # Vitest
bun run typecheck
bun run build
```

依存関係はVite 6.4.5 / Vitest 2.1.9などに固定しています。
Vite本体の設定（`vite.config.ts`）とVitestの設定（`vitest.config.ts`）を分離し、
Vitest内部のVite型とViteプラグインの型が混在しないようにしています。
`bun install` 実行後に生成される `bun.lock` はGitHubへコミットしてください。
Cloudflare Pagesのビルドコマンドは `bun run build`、出力ディレクトリは `dist` です。

## 構成
- `src/domain`        型・初期データ（Vue/IndexedDB非依存。最適化エンジンは Phase 3 で `domain/optimizer` に追加）
- `src/repositories`  `Database` インターフェース + IndexedDB / Memory 実装
- `src/stores`        Pinia
- `src/views`         13画面（Phase 1 は枠のみ）
