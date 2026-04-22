import CryptoJS from 'crypto-js'
import { KVNamespace, ExecutionContext } from '@cloudflare/workers-types'

export interface Env {
  YELBOLT_KV: KVNamespace
  CONSENT_UI_URL: string
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
        const key = CryptoJS.lib.WordArray.random(32).toString(CryptoJS.enc.Hex)
        try {
          return new Response(
            JSON.stringify({
              passkey: key,
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
        const tokens = request.headers.get('tokens') ?? ''
        const passkey = url.searchParams.get('passkey')

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
      GET_OAUTH_METADATA: async () => {
        const baseUrl = `${url.protocol}//${url.host}`
        return new Response(
          JSON.stringify({
            issuer: baseUrl,
            authorization_endpoint: `${baseUrl}/authorize`,
            token_endpoint: `${baseUrl}/token`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code'],
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['none'],
          }),
          {
            status: 200,
            headers: getHeaders({ 'Content-Type': 'application/json' }),
          },
        )
      },
      AUTHORIZE: async () => {
        const responseType = url.searchParams.get('response_type')
        const clientId = url.searchParams.get('client_id')
        const redirectUri = url.searchParams.get('redirect_uri')
        const state = url.searchParams.get('state') ?? ''
        const scope = url.searchParams.get('scope') ?? ''
        const codeChallenge = url.searchParams.get('code_challenge') ?? ''
        const codeChallengeMethod = url.searchParams.get('code_challenge_method') ?? ''

        if (responseType !== 'code') {
          return new Response(JSON.stringify({ error: 'unsupported_response_type' }), {
            status: 400,
            headers: getHeaders({ 'Content-Type': 'application/json' }),
          })
        }
        if (!clientId || !redirectUri) {
          return new Response(JSON.stringify({ error: 'invalid_request', error_description: 'client_id and redirect_uri are required' }), {
            status: 400,
            headers: getHeaders({ 'Content-Type': 'application/json' }),
          })
        }

        const passkey = CryptoJS.lib.WordArray.random(32).toString(CryptoJS.enc.Hex)
        await env.YELBOLT_KV.put(
          `OAUTH_${passkey}`,
          JSON.stringify({ clientId, redirectUri, state, scope, codeChallenge, codeChallengeMethod }),
          { expirationTtl: 600 },
        )

        const consentUrl = new URL(`${env.CONSENT_UI_URL}/oauth/consent`)
        consentUrl.searchParams.set('passkey', passkey)
        consentUrl.searchParams.set('client_id', clientId)
        consentUrl.searchParams.set('scope', scope)
        if (state) consentUrl.searchParams.set('state', state)

        return Response.redirect(consentUrl.toString(), 302)
      },
      TOKEN: async () => {
        let body: URLSearchParams
        try {
          const text = await request.text()
          body = new URLSearchParams(text)
        } catch {
          return new Response(JSON.stringify({ error: 'invalid_request' }), {
            status: 400,
            headers: getHeaders({ 'Content-Type': 'application/json' }),
          })
        }

        const grantType = body.get('grant_type')
        const code = body.get('code') ?? ''
        const clientId = body.get('client_id') ?? ''
        const redirectUri = body.get('redirect_uri') ?? ''
        const codeVerifier = body.get('code_verifier') ?? ''

        if (grantType !== 'authorization_code') {
          return new Response(JSON.stringify({ error: 'unsupported_grant_type' }), {
            status: 400,
            headers: getHeaders({ 'Content-Type': 'application/json' }),
          })
        }

        const oauthStateRaw = await env.YELBOLT_KV.get(`OAUTH_${code}`)
        if (!oauthStateRaw) {
          return new Response(JSON.stringify({ error: 'invalid_grant' }), {
            status: 400,
            headers: getHeaders({ 'Content-Type': 'application/json' }),
          })
        }

        const oauthState = JSON.parse(oauthStateRaw) as {
          clientId: string
          redirectUri: string
          state: string
          scope: string
          codeChallenge: string
          codeChallengeMethod: string
        }

        if (clientId !== oauthState.clientId || redirectUri !== oauthState.redirectUri) {
          return new Response(JSON.stringify({ error: 'invalid_grant' }), {
            status: 400,
            headers: getHeaders({ 'Content-Type': 'application/json' }),
          })
        }

        if (oauthState.codeChallenge && oauthState.codeChallengeMethod === 'S256') {
          if (!codeVerifier) {
            return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'code_verifier required' }), {
              status: 400,
              headers: getHeaders({ 'Content-Type': 'application/json' }),
            })
          }
          const encoder = new TextEncoder()
          const digest = await crypto.subtle.digest('SHA-256', encoder.encode(codeVerifier))
          const base64url = btoa(String.fromCharCode(...new Uint8Array(digest)))
            .replace(/=/g, '')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
          if (base64url !== oauthState.codeChallenge) {
            return new Response(JSON.stringify({ error: 'invalid_grant' }), {
              status: 400,
              headers: getHeaders({ 'Content-Type': 'application/json' }),
            })
          }
        }

        const tokensRaw = await env.YELBOLT_KV.get(`TOKENS_${code}`)
        if (!tokensRaw) {
          return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'User has not completed authorization' }), {
            status: 400,
            headers: getHeaders({ 'Content-Type': 'application/json' }),
          })
        }

        const tokenData = JSON.parse(tokensRaw) as {
          access_token: string
          refresh_token?: string
          expires_in?: number
        }

        await Promise.all([
          env.YELBOLT_KV.delete(`OAUTH_${code}`),
          env.YELBOLT_KV.delete(`TOKENS_${code}`),
        ])

        return new Response(
          JSON.stringify({
            access_token: tokenData.access_token,
            token_type: 'bearer',
            expires_in: tokenData.expires_in ?? 3600,
            refresh_token: tokenData.refresh_token ?? null,
            scope: oauthState.scope,
          }),
          {
            status: 200,
            headers: getHeaders({ 'Content-Type': 'application/json' }),
          },
        )
      },
      GET_TOKENS: async () => {
        const passkey = url.searchParams.get('passkey')

        try {
          const value = await env.YELBOLT_KV.get(`TOKENS_${passkey}`)

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
    } else if (path === '/.well-known/oauth-authorization-server' && request.method === 'GET') {
      return actions.GET_OAUTH_METADATA()
    } else if (path === '/authorize' && request.method === 'GET') {
      return actions.AUTHORIZE()
    } else if (path === '/token' && request.method === 'POST') {
      return actions.TOKEN()
    }

    return new Response('Invalid action type', {
      status: 400,
    })
  },
}
