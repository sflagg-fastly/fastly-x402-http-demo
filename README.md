# Fastly Compute x402 HTTP Payment Demo

A GitHub-ready Fastly Compute demo that gates an HTTP endpoint behind an x402 payment.

The demo protects `GET /protected-route` behind a `$0.001` payment on Base Sepolia. The browser calls `POST /api/fetch-protected-route`; the Compute app uses a configured test payer key to satisfy the x402 challenge and then returns the protected content.

## What it demonstrates

- Fastly Compute serving a protected HTTP endpoint.
- x402 `402 Payment Required` challenge generation.
- Automatic signed retry with `PAYMENT-SIGNATURE` through `@x402/fetch`.
- Server-side payment verification through the x402 facilitator.
- A simple browser UI with no external UI framework.

## Project layout

```txt
.
├── .github/workflows/ci.yml
├── .env.example
├── .gitignore
├── .npmrc
├── fastly.toml
├── package.json
├── scripts/
│   ├── check-balance.mjs
│   ├── decode-payment-required.mjs
│   └── generate-wallets.mjs
├── src/index.ts
└── tsconfig.json
```

## Prerequisites

- Node.js 20+
- Fastly CLI
- Optional: GitHub CLI for pushing the repo quickly
- Optional: CDP CLI for funding the test payer wallet from the command line

## Wallet model

Use two test wallets:

| Wallet | Purpose | Goes in app config? | Needs funds? |
| --- | --- | --- | --- |
| Receiver / merchant | Receives the x402 payment | Address only: `SERVER_ADDRESS` | No |
| Payer / agent | Signs and pays the x402 challenge | Private key: `CLIENT_TEST_PK` | Yes, Base Sepolia USDC |

Do not use a real production wallet. Do not commit `.env`, `cdp-api-key.json`, or any private key.

## Quick start

Install dependencies:

```sh
npm install --registry=https://registry.npmjs.org/
```

Generate two test wallets:

```sh
npm run wallets
```

Copy the output into `.env`:

```sh
cp .env.example .env
```

Example `.env` shape:

```env
SERVER_ADDRESS=0xReceiverWalletAddress
CLIENT_TEST_PK=0xFundedPayerPrivateKey
X402_FACILITATOR_URL=https://www.x402.org/facilitator
EVM_RPC_URL=https://sepolia.base.org
```

Only fund the payer address. The receiver private key is not required by the app.

## Fund the payer wallet

The payer wallet must have Base Sepolia USDC. The demo price is `$0.001`, so 1 test USDC is plenty.

Using CDP CLI:

```sh
cdp env live --key-file ./cdp-api-key.json

cdp evm faucet \
  address=0xPayerWalletAddress \
  network=base-sepolia \
  token=usdc
```

Optional, but useful for general testnet troubleshooting:

```sh
cdp evm faucet \
  address=0xPayerWalletAddress \
  network=base-sepolia \
  token=eth
```

Check the payer balance:

```sh
npm run balance -- 0xPayerWalletAddress
```

Or, if `.env` contains `CLIENT_TEST_PK`, derive the payer address automatically:

```sh
npm run balance
```

You want at least:

```txt
Base Sepolia USDC: 0.001
```

## Run locally

Export `.env` before building and serving:

```sh
set -a
source .env
set +a

fastly compute build
fastly compute serve
```

The local server is usually:

```txt
http://127.0.0.1:7676
```

Open the browser UI or use curl.

## Test with curl

Health check:

```sh
curl -sS http://127.0.0.1:7676/health | jq
```

Confirm the protected route is gated:

```sh
curl -i http://127.0.0.1:7676/protected-route
```

Expected: `402 Payment Required` with a `payment-required` header.

Run the paid flow:

```sh
curl -sS -X POST http://127.0.0.1:7676/api/fetch-protected-route | jq
```

Expected success:

```json
{
  "ok": true,
  "paid": true,
  "status": 200,
  "statusText": "OK",
  "payer": "0x...",
  "receiver": "0x...",
  "result": {
    "message": "This content is behind an x402 paywall. Thanks for paying!",
    "servedBy": "Fastly Compute",
    "paid": true
  }
}
```

If the paid flow returns `402`, the payer probably has no Base Sepolia USDC, or `.env` points at a different payer key than the address you funded.

## Decode the payment challenge

To inspect the payment challenge from `/protected-route`:

```sh
HEADER=$(curl -is http://127.0.0.1:7676/protected-route | awk -F': ' 'tolower($1)=="payment-required" {print $2}' | tr -d '\r')
npm run decode:payment-required -- "$HEADER"
```

You should see the Base Sepolia network, the USDC asset, the payment amount, and the receiver `payTo` address.

## Publish the repo to GitHub

Using GitHub CLI:

```sh
git init
git add .
git commit -m "Initial Fastly Compute x402 demo"
gh repo create fastly-x402-http-demo --public --source=. --remote=origin --push
```

Without GitHub CLI:

```sh
git init
git add .
git commit -m "Initial Fastly Compute x402 demo"
git branch -M main
git remote add origin git@github.com:<your-org-or-user>/fastly-x402-http-demo.git
git push -u origin main
```

The included GitHub Actions workflow runs install, typecheck, and build with dummy values. It does not deploy and it does not require real wallet credentials.

## Deploy to Fastly

For the local demo flow, export `.env` before publishing so the same environment variables used locally are available to the build command:

```sh
set -a
source .env
set +a

fastly compute publish --accept-defaults
```

You can also run:

```sh
npm run deploy
```

For anything beyond a demo, do not bake a long-lived payer private key into the Compute package. Use a separate signer, secret management flow, or service-side payment architecture appropriate for your environment.

## Troubleshooting

### `SERVER_ADDRESS is missing or invalid`

Set `SERVER_ADDRESS` to a valid `0x...` address, export `.env`, and restart `fastly compute serve`.

### `CLIENT_TEST_PK is missing or invalid`

Set `CLIENT_TEST_PK` to a test private key beginning with `0x`. Never use a production key.

### Direct `/protected-route` returns 500 instead of 402

Make sure:

```env
X402_FACILITATOR_URL=https://www.x402.org/facilitator
```

Then rebuild and restart.

### Paid flow returns 402

The x402 challenge is working, but the payer did not complete payment. Check that the funded payer address matches the private key in `.env`:

```sh
npm run balance
```

### npm tries to fetch from an internal or stale registry

This repo includes `.npmrc` with the public npm registry. If needed:

```sh
rm -rf node_modules package-lock.json
npm install --registry=https://registry.npmjs.org/
```

## Security notes

This is a testnet demo. The `CLIENT_TEST_PK` model is intentionally simple so the payment flow is easy to demonstrate end to end. For production, avoid embedding payer keys in a public repo or deploy artifact.
