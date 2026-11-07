import { optimizeSingle, type OptimizationResult, type OptimizeInput } from './optimizer'

/**
 * 1体用探索をWeb Workerで実行する。中止するとWorkerを終了して探索も止まる。
 * Workerが使えない環境（テスト等）では同期実行にフォールバックする。
 */
export function runOptimizeSingle(input: OptimizeInput, signal?: AbortSignal): Promise<OptimizationResult | null> {
  if (signal?.aborted) return Promise.reject(new DOMException('中断しました', 'AbortError'))
  if (typeof Worker === 'undefined') return Promise.resolve().then(() => optimizeSingle(input))
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./optimizerWorker.ts', import.meta.url), { type: 'module' })
    const finish = () => { signal?.removeEventListener('abort', abort); worker.terminate() }
    const abort = () => { finish(); reject(new DOMException('中断しました', 'AbortError')) }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<{ ok: boolean; result?: OptimizationResult | null; error?: string }>) => {
      finish()
      if (event.data.ok) resolve(event.data.result ?? null); else reject(new Error(event.data.error ?? '探索に失敗しました'))
    }
    worker.onerror = (event) => { finish(); reject(new Error(event.message || '探索Workerでエラーが発生しました')) }
    worker.onmessageerror = () => { finish(); reject(new Error('探索Workerの結果を読み込めませんでした')) }
    try {
      worker.postMessage(JSON.parse(JSON.stringify(input)))
    } catch (error) {
      finish()
      reject(error)
    }
  })
}
