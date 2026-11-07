import { optimizeSingle, type OptimizeInput } from './optimizer'

// 1体用探索をメインスレッドから切り離す。入力・出力はJSON互換の値のみ。
// DOM型と競合しないよう、Workerのグローバルは最小の型でだけ扱う。
const ctx = self as unknown as { onmessage: ((event: MessageEvent<OptimizeInput>) => void) | null; postMessage(message: unknown): void }
ctx.onmessage = (event) => {
  try {
    ctx.postMessage({ ok: true, result: optimizeSingle(event.data) })
  } catch (e) {
    ctx.postMessage({ ok: false, error: String(e) })
  }
}
