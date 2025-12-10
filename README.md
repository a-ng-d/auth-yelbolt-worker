# Auth Yelbolt Worker

A Cloudflare Worker service that provides secure authentication token exchange for Yelbolt suite applications:

- UI Color Palette
- Ideas Spark Booth

## Overview

This worker implements a secure passkey-based authentication flow using Cloudflare KV storage. It generates temporary passkeys and manages OAuth token exchange between services.

## API Endpoints

### `GET /passkey`

Generates a new random passkey for authentication.

**Response:**
```json
{
  "passkey": "339e4eee6720573a14228fb0fc180c1f5f7030cb3eaed20cfc11db651a6e2916",
  "message": "Passkey generated"
}
```

### `POST /tokens?passkey={passkey}`

Stores authentication tokens associated with a passkey.

**Query Parameters:**
- `passkey` (required): The passkey generated from `/passkey` endpoint

**Headers:**
- `tokens` (required): JSON string containing the authentication tokens

**Response:**
```json
{
  "message": "Tokens written"
}
```

### `GET /tokens?passkey={passkey}`

Retrieves and deletes tokens associated with a passkey (one-time use).

**Query Parameters:**
- `passkey` (required): The passkey used to store the tokens

**Response (success):**
```json
{
  "tokens": { /* your token data */ },
  "message": "Tokens found"
}
```

**Response (not found):**
```json
{
  "message": "No token found"
}
```

## Authentication Flow

1. **Client A** requests a passkey: `GET /passkey`
2. **Client A** shares the passkey with **Client B** via secure channel
3. **Client B** stores tokens: `POST /tokens?passkey={passkey}` with tokens in header
4. **Client A** retrieves tokens: `GET /tokens?passkey={passkey}`
5. Tokens are automatically deleted after retrieval (one-time use)

## Development

### Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- Cloudflare account with KV namespace

### Installation

```bash
npm install
```

### Local Development

```bash
npm run dev
# or on specific port
npm run start:8787
```

### Deployment

```bash
npm run deploy
```

### Configuration

Update `wrangler.toml` with your KV namespace binding:

```toml
[[kv_namespaces]]
binding = "YELBOLT_KV"
id = "your-kv-namespace-id"
```

## Security Features

- **CORS enabled** for cross-origin requests
- **One-time token retrieval** - tokens are deleted after first access
- **Cryptographically secure passkeys** - 32-byte random hex strings
- **No persistent storage** of sensitive data

## Technologies

- **Cloudflare Workers** - Edge computing platform
- **Cloudflare KV** - Distributed key-value storage
- **CryptoJS** - Cryptographic random generation
- **TypeScript** - Type-safe development

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
