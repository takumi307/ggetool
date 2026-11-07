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
