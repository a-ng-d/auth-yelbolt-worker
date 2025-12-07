import CryptoJS from 'crypto-js'
import { KVNamespace, ExecutionContext } from '@cloudflare/workers-types'

export interface Env {
  YELBOLT_KV: KVNamespace
}

export interface Env {
  YELBOLT_KV: KVNamespace
}

const getHeaders = (extraHeaders: Record<string, string> = {}): Record<string, string> => {
  return {
    'Access-Control-Allow-Origin': '*',
    ...extraHeaders,
  }
}

export default {
  async fetch(request: Request, env: Env, _: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: getHeaders({
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, distinct-id, passkey, tokens, baggage, type, sentry-trace',
        }),
      })
    }

    const actions = {
      GET_PASSKEY: async () => {
        const key = CryptoJS.lib.WordArray.random(32).toString(CryptoJS.enc.Hex),
          distinctId = request.headers.get('distinct-id')

        try {
          await env.YELBOLT_KV.put(`PASSKEY_${distinctId}`, key)
          const value = await env.YELBOLT_KV.get(`PASSKEY_${distinctId}`)

          if (value === null) {
            return new Response(
              JSON.stringify({
                message: 'Passkey not found',
              }) as BodyInit,
              {
                status: 404,
                headers: getHeaders(),
              },
            )
          }
          return new Response(
            JSON.stringify({
              passkey: value,
              message: 'Passkey generated',
            }) as BodyInit,
            {
              status: 200,
              headers: getHeaders(),
            },
          )
        } catch (err) {
          console.error(`KV returned error: ${err}`)
          return new Response(
            JSON.stringify({
              message: err,
            }) as BodyInit,
            {
              status: 500,
              headers: getHeaders(),
            },
          )
        }
      },
      SEND_TOKENS: async () => {
        const tokens = request.headers.get('tokens') ?? '',
          passkey = url.searchParams.get('passkey')

        try {
          await env.YELBOLT_KV.put(`TOKENS_${passkey}`, tokens)
          const value = await env.YELBOLT_KV.get(`TOKENS_${passkey}`)

          if (value === null) {
            return new Response(
              JSON.stringify({
                message: 'No token written',
              }) as BodyInit,
              {
                status: 404,
                headers: getHeaders(),
              },
            )
          }
          return new Response(
            JSON.stringify({
              message: 'Tokens written',
            }) as BodyInit,
            {
              status: 200,
              headers: getHeaders(),
            },
          )
        } catch (err) {
          console.error(`KV returned error: ${err}`)
          return new Response(
            JSON.stringify({
              message: err,
            }) as BodyInit,
            {
              status: 500,
              headers: getHeaders(),
            },
          )
        }
      },
      GET_TOKENS: async () => {
        const distinctId = request.headers.get('distinct-id') ?? '',
          passkey = url.searchParams.get('passkey')

        try {
          const value = await env.YELBOLT_KV.get(`TOKENS_${passkey}`)
          await env.YELBOLT_KV.delete(`PASSKEY_${distinctId}`)

          if (value === null) {
            return new Response(
              JSON.stringify({
                message: 'No token found',
              }) as BodyInit,
              {
                status: 200,
                headers: getHeaders(),
              },
            )
          } else {
            const json = JSON.parse(value)

            await env.YELBOLT_KV.delete(`TOKENS_${passkey}`)

            return new Response(
              JSON.stringify({
                tokens: json,
                message: 'Tokens found',
              }) as BodyInit,
              {
                status: 200,
                headers: getHeaders(),
              },
            )
          }
        } catch (err) {
          console.error(`KV returned error: ${err}`)
          return new Response(
            JSON.stringify({
              message: err,
            }) as BodyInit,
            {
              status: 500,
              headers: getHeaders(),
            },
          )
        }
      },
    }

    if (path === '/passkey' && request.method === 'GET') {
      return actions.GET_PASSKEY()
    } else if (path === '/tokens' && request.method === 'POST') {
      return actions.SEND_TOKENS()
    } else if (path === '/tokens' && request.method === 'GET') {
      return actions.GET_TOKENS()
    }

    return new Response('Invalid action type', {
      status: 400,
    })
  },
}
