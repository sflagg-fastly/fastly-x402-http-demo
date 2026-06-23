# Fastly Compute x402 HTTP Payment Demo

Fastly Compute demo that protects an HTTP endpoint with an x402 payment challenge.

`GET /protected-route` costs `$0.001` on Base Sepolia. A direct request returns `402 Payment Required`. The paid flow calls `POST /api/fetch-protected-route`, signs the x402 challenge with a configured test payer key, retries the protected request, and returns the protected response.

## What this demonstrates

- Fastly Compute serving an HTTP resource.
- x402 `402 Payment Required` challenge generation.
- Signed payment retry through `@x402/fetch`.
- Server-side payment verification through an x402 facilitator.
- A browser UI that exercises both the unpaid 402 response and the paid endpoint.

## Verification status

Both paths have been validated:

- curl against `POST /api/fetch-protected-route`
- browser UI at `/`

Use curl as the easiest way to inspect the raw 402 challenge and paid response. Use the UI for demos.

## Project layout

```txt
.
├── .env.example
├── .npmrc
├── fastly.toml
├── package.json
├── scripts/
│   ├── check-balance.mjs
│   ├── decode-payment-required.mjs
│   └── generate-wallets.mjs
├── src/
│   ├── entry.ts
│   └── index.ts
└── tsconfig.json
```

`src/entry.ts` is the Compute entrypoint. It installs the small runtime compatibility shim needed by npm dependencies that expect `Buffer`. This does not make Fastly Compute a Node.js runtime. The service still runs on Fastly Compute, and the shim only supplies the specific global expected by the x402 dependency path.

`src/index.ts` contains the Hono app, routes, x402 middleware, and browser UI assets.

## Prerequisites

- Node.js 20+
- Fastly CLI
- Optional: CDP CLI for requesting Base Sepolia testnet funds

CDP means Coinbase Developer Platform. In this demo, the CDP CLI is only used to request testnet USDC from a faucet. It is not part of Fastly, and it does not deploy or run the Compute service.

## Wallet model

Use two test wallets:

| Wallet | Purpose | App config | Needs funds? |
| --- | --- | --- | --- |
| Receiver / merchant | Receives payment | Address only: `SERVER_ADDRESS` | No |
| Payer / agent | Signs and pays the challenge | Private key: `CLIENT_TEST_PK` | Yes, Base Sepolia USDC |

Do not use production wallets. Do not commit `.env`, `cdp-api-key.json`, or private keys.

## Install

```sh
npm install --registry=https://registry.npmjs.org/
```

## Create payer and receiver wallets

Generate test wallets:

```sh
npm run wallets
```

Or run the wallet generation directly:

```sh
node --input-type=module <<'NODE'
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const receiverPk = generatePrivateKey();
const receiver = privateKeyToAccount(receiverPk);

const payerPk = generatePrivateKey();
const payer = privateKeyToAccount(payerPk);

console.log("\n# Receiver / merchant wallet");
console.log("SERVER_ADDRESS=" + receiver.address);
console.log("# receiver private key, save only if you care about recovering test funds:");
console.log("# " + receiverPk);

console.log("\n# Payer / agent wallet");
console.log("PAYER_ADDRESS=" + payer.address);
console.log("CLIENT_TEST_PK=" + payerPk);
NODE
```

Create `.env`:

```sh
cp .env.example .env
```

Set these values:

```env
SERVER_ADDRESS=0xReceiverWalletAddress
CLIENT_TEST_PK=0xPayerPrivateKey
X402_FACILITATOR_URL=https://www.x402.org/facilitator
EVM_RPC_URL=https://sepolia.base.org
```

Only fund the payer address. The app does not need the receiver private key.

## Fund the payer wallet

The payer wallet needs Base Sepolia USDC. The demo price is `$0.001`, so 1 test USDC is enough.

Authenticate CDP CLI:

```sh
cdp env live --key-file ./cdp-api-key.json
```

Request testnet USDC:

```sh
cdp evm faucet \
  address=0xPayerWalletAddress \
  network=base-sepolia \
  token=usdc
```

Optional testnet ETH, useful for troubleshooting:

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

Or derive the payer address from `CLIENT_TEST_PK` in `.env`:

```sh
npm run balance
```

Expected minimum:

```txt
Base Sepolia USDC: 0.001
```

## Run locally

Export `.env`, build, and serve:

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

## Verify with curl

Health check:

```sh
curl -sS http://127.0.0.1:7676/health | jq
```

Confirm the protected route is gated:

```sh
curl -i http://127.0.0.1:7676/protected-route
```

Expected:

```txt
HTTP/1.1 402 Payment Required
payment-required: <base64 challenge>
```

Run the paid flow:

```sh
curl -sS -X POST http://127.0.0.1:7676/api/fetch-protected-route | jq
```

Expected:

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

If the paid flow returns `402`, check that the funded payer address matches the private key in `.env`.

## Verify with the browser UI

Open:

```txt
http://127.0.0.1:7676
```

Click **Show 402** to display the unpaid `402 Payment Required` response from `GET /protected-route`.

Click **Fetch & Pay** to run the paid flow.

Expected: the UI displays the same successful JSON payload returned by the curl command.

## Decode the payment challenge

To inspect the challenge from `/protected-route`:

```sh
HEADER=$(curl -is http://127.0.0.1:7676/protected-route | awk -F': ' 'tolower($1)=="payment-required" {print $2}' | tr -d '\r')
npm run decode:payment-required -- "$HEADER"
```

You should see the Base Sepolia network, USDC asset, payment amount, and receiver `payTo` address.

## Deploy to Fastly

For the demo flow, export `.env` before publishing so the build receives the same values used locally:

```sh
set -a
source .env
set +a

fastly compute publish --accept-defaults
```

Or:

```sh
npm run deploy
```

For production, do not bake a long-lived payer private key into the Compute package. Use a dedicated signer, secret management flow, or payment-provider architecture appropriate for your use case.

## Troubleshooting

### `SERVER_ADDRESS is missing or invalid`

Set `SERVER_ADDRESS` to a valid `0x...` address, export `.env`, and restart `fastly compute serve`.

### `CLIENT_TEST_PK is missing or invalid`

Set `CLIENT_TEST_PK` to a test private key beginning with `0x`. Never use a production key.

### `Buffer is not defined`

The x402 dependency path expects a Node-style `Buffer` global. Fastly Compute is not Node, so this repo provides a small compatibility shim through `src/entry.ts`.

If you see this error, confirm the build script points at `src/entry.ts`, not `src/index.ts`:

```json
"build": "mkdir -p bin && js-compute-runtime --env SERVER_ADDRESS,CLIENT_TEST_PK,X402_FACILITATOR_URL,EVM_RPC_URL src/entry.ts bin/main.wasm"
```

Then rebuild:

```sh
rm -rf bin pkg
npm run build
fastly compute serve
```

### Direct `/protected-route` returns 500 instead of 402

Confirm:

```env
X402_FACILITATOR_URL=https://www.x402.org/facilitator
```

Then rebuild and restart.

A `500` is acceptable while debugging if the x402 middleware cannot initialize or verify. It should fail closed and not serve protected content. A direct unauthenticated request to `/protected-route` should never return `200`.

### Direct `/protected-route` returns 200

This means the paywall is failing open. Do not use the demo until fixed.

Expected direct behavior:

```txt
HTTP/1.1 402 Payment Required
```

or, during middleware failure:

```txt
HTTP/1.1 500 Internal Server Error
```

Unexpected behavior:

```txt
HTTP/1.1 200 OK
```

### Paid flow returns 402

The payer did not complete payment. Check that the funded payer address matches `CLIENT_TEST_PK`:

```sh
npm run balance
```

### Browser UI fails but curl succeeds

The UI calls `POST /api/fetch-protected-route` for the paid flow and directly calls `GET /protected-route` for the unpaid 402 response. Check the browser console, response body, and whether `/client.js` loaded successfully.

### npm uses the wrong registry

This repo includes `.npmrc` with the public npm registry. If needed:

```sh
rm -rf node_modules package-lock.json
npm install --registry=https://registry.npmjs.org/
```

## Security notes

This is a testnet demo. `CLIENT_TEST_PK` is intentionally simple so the x402 flow is easy to prove end to end. For production, avoid embedding payer keys in a public repo or deploy artifact.
