# Security notes

This repository is a testnet demo.

Do not commit:

- `.env`
- `cdp-api-key.json`
- payer private keys
- receiver private keys
- production wallet credentials

The local demo intentionally uses `CLIENT_TEST_PK` so it is easy to prove the end-to-end x402 flow. For production, use a dedicated signing service, secret-management workflow, or another architecture that avoids embedding long-lived private keys into a deploy artifact.
