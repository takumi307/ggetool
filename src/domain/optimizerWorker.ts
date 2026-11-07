import { optimizeSingle } from './optimizer'
import { optimizeCastellanPlan } from './castellanPlanner'
import type { OptimizerTask } from './optimizerRunner'

// 1体用探索をメインスレッドから切り離す。入力・出力はJSON互換の値のみ。
// DOM型と競合しないよう、Workerのグローバルは最小の型でだけ扱う。
const ctx = self as unknown as { onmessage: ((event: MessageEvent<OptimizerTask>) => void) | null; postMessage(message: unknown): void }
ctx.onmessage = (event) => {
  try {
    const task = event.data
    const result = task.kind === 'single' ? optimizeSingle(task.input) : optimizeCastellanPlan(task.input)
    ctx.postMessage({ ok: true, result })
  } catch (e) {
    ctx.postMessage({ ok: false, error: String(e) })
  }
}
