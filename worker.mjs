const prefix = '/api/optimizer'
const renderOrigin = 'https://e4k-cpsat-optimizer.onrender.com'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith(prefix + '/')) return env.ASSETS.fetch(request)

    const path = url.pathname.slice(prefix.length)
    const submitting = request.method === 'POST' && path === '/jobs'
    const polling = request.method === 'GET' && /^\/jobs\/[a-f0-9]{32}$/.test(path)
    if (!submitting && !polling) return new Response(null, { status: 404 })
    const origin = request.headers.get('Origin')
    if (origin && origin !== url.origin) return new Response(null, { status: 403 })
    const contentType = request.headers.get('Content-Type') ?? ''
    if (submitting && contentType.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return new Response(null, { status: 415 })
    }
    try {
      const upstream = await fetch(renderOrigin + path, {
        method: request.method,
        headers: submitting ? { 'Content-Type': 'application/json' } : {},
        body: submitting ? request.body : undefined,
        redirect: 'manual',
      })
      if (upstream.status >= 300 && upstream.status < 400) {
        return Response.json({ detail: 'Unexpected redirect from Render' }, { status: 502 })
      }
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
          'Cache-Control': 'no-store',
        },
      })
    } catch {
      return Response.json({ detail: 'Render is unavailable' }, { status: 502 })
    }
  },
}
