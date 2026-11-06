# Windows PCでローカルCP-SATを実行する

CloudflareのE4K Commander Builder画面はそのまま使い、計算だけWindows PCで実行します。既存のIndexedDBデータは移動・削除されません。

## 初回セットアップ（PowerShell）

1. Python 3.12（64-bit）をインストールします。
2. GitHubのこのリポジトリをPCへダウンロードして展開します。
3. PowerShellでリポジトリ内の `optimizer-service` フォルダーに移動し、次を実行します。

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## 起動（毎回）

Cloudflareで開いているWebアプリの**正確なオリジン**（https://ホスト名、末尾のスラッシュなし）を設定してください。以下は現在のデプロイ先の例です。

```powershell
$env:CORS_ORIGINS = "https://ggetool.takutaku307.workers.dev"
$env:CPSAT_WORKERS = "4"
.\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8765
```

ブラウザで `http://127.0.0.1:8765/health` にアクセスし、`{"ok":true}` が返れば起動できています。**PowerShellを閉じると停止します。**

## アプリ側

1. 同じPCでCloudflare版E4K Commander Builderを開きます。
2. 最適化画面で「このPC（ローカルCP-SAT）」を選びます。
3. まず「5分」で実行し、達成数・理論上限をRenderと比較します。10分/30分も選べます。
4. 計算時間は**各段階**の上限であり、合計は最大2倍程度になります。

Render版はそのまま残ります。スマホでは「Render（クラウド）」を選択してください。

## 注意

- Windows PCのCPU i5-14500 / メモリ16GBなら、最初は `CPSAT_WORKERS=4` を推奨。メモリ不足が起きる場合は2に下げます。
- HTTPSページからlocalhostへのアクセスはブラウザのローカルネットワーク権限等でブロックされる場合があります。その場合はブラウザの許可設定を確認してください。
- localhostサーバーは **127.0.0.1 のみにバインド**してください。LAN全体へ公開しないでください。
- 現時点ではブラウザからの停止は通信中断だけで、サーバー側キャンセルはPR #30の導入後に利用できます。
- ローカル化だけで23体を超える保証はありません。計算時間・ワーカー数を比較し、最良解を探します。
