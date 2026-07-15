import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/public/whoami-stripe')({
  server: {
    handlers: {
      GET: async () => {
        const key = process.env.STRIPE_SECRET_KEY
        if (!key) return new Response('no key', { status: 500 })
        const r = await fetch('https://api.stripe.com/v1/account', {
          headers: { Authorization: `Bearer ${key}` },
        })
        const body = await r.text()
        return new Response(body, { status: r.status, headers: { 'content-type': 'application/json' } })
      },
    },
  },
})
