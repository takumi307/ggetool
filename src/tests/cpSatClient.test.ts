import { expect, it, vi } from 'vitest'
import { optimizeCpSat } from '@/domain/cpSatClient'

it('retries a timed-out cloud submission with the same request ID', async () => {
  vi.useFakeTimers()
  const accepted: typeof fetch = async (_url, init) => {
    const { requestId } = JSON.parse(String(init?.body))
    return Response.json({ jobId: requestId, state: 'running', castellan: true }, { status: 202 })
  }
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 524 }))
    .mockImplementationOnce(accepted)
    .mockResolvedValueOnce(Response.json({
      state: 'completed', result: { status: 'OPTIMAL', optimal: true, achieved: 0, requested: 0, builds: [] },
    }))
  vi.stubGlobal('fetch', fetchMock)
  try {
    const result = optimizeCpSat({
      endpoint: '/api/optimizer', castellan: true, jobs: [], equipment: [], gems: [], stats: [],
      reservedEquipmentIds: [], reservedGemIds: [], timeLimitSeconds: 5,
    })
    const completed = expect(result).resolves.toMatchObject({ status: 'OPTIMAL' })
    await vi.advanceTimersByTimeAsync(5000)
    await completed
    const body = fetchMock.mock.calls[0][1]?.body
    expect(fetchMock.mock.calls[1][1]?.body).toBe(body)
    expect(fetchMock.mock.calls[2][0]).toBe('/api/optimizer/jobs/' + JSON.parse(String(body)).requestId)
  } finally {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})

it('recovers a dropped poll and a proxy timeout without submitting again', async () => {
  vi.useFakeTimers()
  const onSearchProgress = vi.fn()
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ jobId: 'ab'.repeat(16), state: 'running' }, { status: 202 }))
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(new Response(null, { status: 524 }))
    .mockResolvedValueOnce(Response.json({ state: 'running', progress: {
      stage: 'weighted', stageIndex: 3, stageCount: 3, achieved: 0, upperBound: 0, countOptimal: true, elapsedSeconds: 10,
    } }))
    .mockResolvedValueOnce(Response.json({ state: 'completed', result: {
      status: 'OPTIMAL', optimal: true, countOptimal: true, achieved: 0, requested: 0, builds: [],
    } }))
  vi.stubGlobal('fetch', fetchMock)
  try {
    const result = optimizeCpSat({ endpoint: 'http://localhost:8765', jobs: [], equipment: [], gems: [], stats: [],
      reservedEquipmentIds: [], reservedGemIds: [], timeLimitSeconds: 5, onSearchProgress })
    const completed = expect(result).resolves.toMatchObject({ countOptimal: true })
    await vi.advanceTimersByTimeAsync(16000)
    await completed
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(onSearchProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'weighted' }))
  } finally {
    vi.useRealTimers(); vi.unstubAllGlobals()
  }
})
