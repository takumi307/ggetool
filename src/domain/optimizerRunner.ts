import { optimizeCastellanPlan, type CastellanPlanInput } from './castellanPlanner'
import type { CpSatOutcome } from './cpSatClient'
import { optimizeSingle, type OptimizationResult, type OptimizeInput } from './optimizer'

/**
 * 1体用探索をWeb Workerで実行する。中止するとWorkerを終了して探索も止まる。
 * Workerが使えない環境（テスト等）では同期実行にフォールバックする。
 */
export type OptimizerTask = { kind: 'single'; input: OptimizeInput } | { kind: 'castellan-plan'; input: CastellanPlanInput }

export function runOptimizeSingle(input: OptimizeInput, signal?: AbortSignal): Promise<OptimizationResult | null> {
  return runWorker({ kind: 'single', input }, () => optimizeSingle(input), signal)
}

export function runCastellanPlan(input: CastellanPlanInput, signal?: AbortSignal): Promise<CpSatOutcome> {
  return runWorker({ kind: 'castellan-plan', input }, () => optimizeCastellanPlan(input), signal)
}

function runWorker<Result>(task: OptimizerTask, fallback: () => Result, signal?: AbortSignal): Promise<Result> {
  if (signal?.aborted) return Promise.reject(new DOMException('中断しました', 'AbortError'))
  if (typeof Worker === 'undefined') return Promise.resolve().then(fallback)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./optimizerWorker.ts', import.meta.url), { type: 'module' })
    const finish = () => { signal?.removeEventListener('abort', abort); worker.terminate() }
    const abort = () => { finish(); reject(new DOMException('中断しました', 'AbortError')) }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<{ ok: true; result: Result } | { ok: false; error: string }>) => {
      finish()
      if (event.data.ok) resolve(event.data.result); else reject(new Error(event.data.error ?? '探索に失敗しました'))
    }
    worker.onerror = (event) => { finish(); reject(new Error(event.message || '探索Workerでエラーが発生しました')) }
    worker.onmessageerror = () => { finish(); reject(new Error('探索Workerの結果を読み込めませんでした')) }
    try {
      worker.postMessage(JSON.parse(JSON.stringify(task)))
    } catch (error) {
      finish()
      reject(error)
    }
  })
}
