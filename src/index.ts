/// <reference types="@fastly/js-compute" />

import { allowDynamicBackends } from "fastly:experimental";
import { env } from "fastly:env";
import { Hono } from "hono";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme as registerClientEvmScheme } from "@x402/evm/exact/client";
import { ExactEvmScheme as ServerExactEvmScheme } from "@x402/evm/exact/server";
import { privateKeyToAccount } from "viem/accounts";

allowDynamicBackends(true);

const PRICE = "$0.001";
const NETWORK = "eip155:84532";
const DEFAULT_FACILITATOR_URL = "https://www.x402.org/facilitator";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function readEnv(name: string): string {
  try {
    return env(name) || "";
  } catch {
    return "";
  }
}

function getServerAddress(): `0x${string}` {
  const value = readEnv("SERVER_ADDRESS");
  return (value || ZERO_ADDRESS) as `0x${string}`;
}

function getFacilitatorUrl(): string {
  return readEnv("X402_FACILITATOR_URL") || DEFAULT_FACILITATOR_URL;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function textResponse(body: string, contentType: string): Response {
  return new Response(body, {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=60"
    }
  });
}

function requireConfig():
  | { ok: true; privateKey: `0x${string}`; serverAddress: `0x${string}` }
  | { ok: false; error: string } {
  const serverAddress = readEnv("SERVER_ADDRESS");
  if (!serverAddress || !serverAddress.startsWith("0x") || serverAddress.length !== 42) {
    return { ok: false, error: "SERVER_ADDRESS is missing or invalid" };
  }

  const privateKey = readEnv("CLIENT_TEST_PK");
  if (!privateKey || !privateKey.startsWith("0x")) {
    return { ok: false, error: "CLIENT_TEST_PK is missing or invalid" };
  }

  return {
    ok: true,
    privateKey: privateKey as `0x${string}`,
    serverAddress: serverAddress as `0x${string}`
  };
}

async function fetchProtectedRouteWithPayment(request: Request): Promise<Response> {
  const config = requireConfig();
  if (!config.ok) {
    return jsonResponse(
      {
        ok: false,
        error: config.error,
        hint: "Copy .env.example to .env, set values, export them, then restart fastly compute serve."
      },
      500
    );
  }

  try {
    const account = privateKeyToAccount(config.privateKey);
    const client = new x402Client();

    registerClientEvmScheme(client, { signer: account });

    const fetchWithPay = wrapFetchWithPayment(fetch, client);
    const paidUrl = new URL("/protected-route", request.url).toString();
    const paidResponse = await fetchWithPay(paidUrl, {
      method: "GET",
      headers: {
        accept: "application/json"
      }
    });

    const responseText = await paidResponse.text();
    let parsedBody: unknown = responseText;
    try {
      parsedBody = JSON.parse(responseText);
    } catch {
      // Keep non-JSON bodies as text.
    }

    if (!paidResponse.ok) {
      return jsonResponse(
        {
          ok: false,
          paid: false,
          status: paidResponse.status,
          statusText: paidResponse.statusText,
          payer: account.address,
          receiver: config.serverAddress,
          paidUrl,
          error: parsedBody
        },
        paidResponse.status
      );
    }

    return jsonResponse({
      ok: true,
      paid: true,
      status: paidResponse.status,
      statusText: paidResponse.statusText,
      payer: account.address,
      receiver: config.serverAddress,
      paidUrl,
      result: parsedBody
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        paid: false,
        error: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}

function createResourceServer() {
  const facilitatorClient = new HTTPFacilitatorClient({
    url: getFacilitatorUrl()
  });

  return new x402ResourceServer(facilitatorClient)
    .register(NETWORK, new ServerExactEvmScheme());
}

let cachedResourceServer: ReturnType<typeof createResourceServer> | undefined;
let resourceServerInitPromise: Promise<void> | undefined;

async function getInitializedResourceServer(): Promise<ReturnType<typeof createResourceServer>> {
  if (!cachedResourceServer) {
    cachedResourceServer = createResourceServer();
    resourceServerInitPromise = undefined;
  }

  if (!resourceServerInitPromise) {
    resourceServerInitPromise = Promise.resolve(
      (cachedResourceServer as { initialize: () => Promise<void> | void }).initialize()
    ).then(() => undefined);
  }

  await resourceServerInitPromise;
  return cachedResourceServer;
}

function createProtectedRoutePaymentMiddleware(server: ReturnType<typeof createResourceServer>) {
  return paymentMiddleware(
    {
      "GET /protected-route": {
        accepts: [
          {
            scheme: "exact",
            price: PRICE,
            network: NETWORK,
            payTo: getServerAddress()
          }
        ],
        description: "Access to premium content",
        mimeType: "application/json"
      }
    },
    server,
    undefined,
    undefined,
    false
  );
}

const app = new Hono();

app.onError((error) => {
  console.error("Unhandled app error", error);
  return jsonResponse(
    {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    },
    500
  );
});

app.get("/", (c) => c.html(INDEX_HTML));
app.get("/styles.css", () => textResponse(STYLES_CSS, "text/css; charset=utf-8"));
app.get("/client.js", () => textResponse(CLIENT_JS, "application/javascript; charset=utf-8"));

app.get("/health", () =>
  jsonResponse({
    ok: true,
    runtime: "Fastly Compute",
    x402: {
      price: PRICE,
      network: NETWORK,
      facilitator: getFacilitatorUrl(),
      serverAddressConfigured: Boolean(readEnv("SERVER_ADDRESS")),
      clientKeyConfigured: Boolean(readEnv("CLIENT_TEST_PK")),
      evmRpcUrlConfigured: Boolean(readEnv("EVM_RPC_URL"))
    }
  })
);

app.post("/api/fetch-protected-route", async (c) => fetchProtectedRouteWithPayment(c.req.raw));

app.use("/protected-route", async (c, next) => {
  try {
    const server = await getInitializedResourceServer();
    const protectedRoutePaymentMiddleware = createProtectedRoutePaymentMiddleware(server);
    return await protectedRoutePaymentMiddleware(c, next);
  } catch (error) {
    console.error("x402 middleware error", error);
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        hint: "Use X402_FACILITATOR_URL=https://www.x402.org/facilitator and fund CLIENT_TEST_PK with Base Sepolia USDC."
      },
      500
    );
  }
});

app.get("/protected-route", (c) =>
  c.json({
    message: "This content is behind an x402 paywall. Thanks for paying!",
    servedBy: "Fastly Compute",
    paid: true,
    timestamp: new Date().toISOString()
  })
);

app.notFound(() => jsonResponse({ ok: false, error: "Not found" }, 404));

addEventListener("fetch", (event) => {
  event.respondWith(app.fetch(event.request));
});

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>x402 Payments on Fastly Compute</title>
    <link rel="stylesheet" href="/styles.css" />
    <script>
      (() => {
        const stored = localStorage.getItem("theme");
        const mode = stored || "light";
        document.documentElement.setAttribute("data-mode", mode);
        document.documentElement.style.colorScheme = mode;
      })();
    </script>
  </head>
  <body>
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <span class="brand-icon">$</span>
          <div>
            <h1>x402 Payments</h1>
            <p>Fastly Compute HTTP payment gate</p>
          </div>
        </div>
        <button id="theme" class="icon-button" type="button" aria-label="Toggle theme">☾</button>
      </header>

      <main>
        <section class="card intro">
          <div class="eyebrow">Edge demo</div>
          <h2>Protect an HTTP route with x402</h2>
          <p>
            This app runs on Fastly Compute and gates <code>/protected-route</code>
            behind a <strong>$0.001</strong> payment on Base Sepolia. The button calls
            a payer endpoint that signs and pays with the configured test wallet.
          </p>
        </section>

        <section class="card protected">
          <div class="route-row">
            <div>
              <div class="eyebrow">Protected route</div>
              <h2><code>GET /protected-route</code></h2>
            </div>
            <span class="badge">$0.001</span>
          </div>
          <p>Press the button to fetch the route through the x402 payment flow.</p>
          <div class="actions">
            <button id="fetch" class="primary" type="button">Fetch &amp; Pay</button>
            <button id="clear" class="secondary" type="button">Clear</button>
          </div>
        </section>

        <section class="results">
          <h2>Results</h2>
          <div id="results" class="result-list empty">No requests yet.</div>
        </section>
      </main>

      <footer>Powered by Fastly Compute</footer>
    </div>
    <script src="/client.js" type="module"></script>
  </body>
</html>`;

const STYLES_CSS = `:root {
  --bg: #f7f7f8;
  --card: #ffffff;
  --text: #191b1f;
  --muted: #646b76;
  --line: #e4e7ec;
  --accent: #ff282d;
  --accent-dark: #c91419;
  --good: #16833a;
  --bad: #b42318;
  --code: #f0f2f5;
}

:root[data-mode="dark"] {
  --bg: #101114;
  --card: #17191e;
  --text: #f3f4f6;
  --muted: #a1a7b3;
  --line: #2a2f39;
  --accent: #ff4d51;
  --accent-dark: #ff6a6d;
  --good: #56d37d;
  --bad: #ff8179;
  --code: #20242c;
}

* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: var(--bg);
  color: var(--text);
}
.shell { min-height: 100vh; display: flex; flex-direction: column; }
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.25rem;
  border-bottom: 1px solid var(--line);
  background: color-mix(in oklab, var(--card), transparent 8%);
}
.brand { display: flex; align-items: center; gap: .85rem; }
.brand-icon {
  display: grid;
  place-items: center;
  width: 2.2rem;
  height: 2.2rem;
  border-radius: .8rem;
  background: var(--accent);
  color: white;
  font-weight: 800;
}
h1, h2, p { margin: 0; }
h1 { font-size: 1.1rem; line-height: 1.2; }
.brand p { margin-top: .15rem; color: var(--muted); font-size: .85rem; }
main { width: min(760px, calc(100% - 2rem)); margin: 2rem auto; flex: 1; }
.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 1rem;
  padding: 1.25rem;
  box-shadow: 0 8px 28px rgba(0, 0, 0, .06);
  margin-bottom: 1rem;
}
.eyebrow { color: var(--accent); font-size: .78rem; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; margin-bottom: .4rem; }
.intro h2, .protected h2 { font-size: 1.4rem; margin-bottom: .65rem; }
p { color: var(--muted); line-height: 1.55; }
code { background: var(--code); padding: .1rem .35rem; border-radius: .35rem; }
.route-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.badge { background: var(--code); border: 1px solid var(--line); padding: .35rem .55rem; border-radius: 999px; font-weight: 800; }
.actions { display: flex; gap: .75rem; margin-top: 1rem; }
button {
  border: 0;
  border-radius: .7rem;
  padding: .7rem 1rem;
  font-weight: 800;
  cursor: pointer;
}
button:disabled { opacity: .6; cursor: not-allowed; }
.primary { background: var(--accent); color: white; }
.primary:hover { background: var(--accent-dark); }
.secondary, .icon-button { background: var(--code); color: var(--text); border: 1px solid var(--line); }
.icon-button { width: 2.2rem; height: 2.2rem; padding: 0; }
.results { margin-top: 1.5rem; }
.results h2 { font-size: 1rem; margin-bottom: .75rem; }
.result-list.empty { color: var(--muted); border: 1px dashed var(--line); border-radius: 1rem; padding: 1rem; }
.result {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 1rem;
  padding: 1rem;
  margin-bottom: .75rem;
}
.result.ok { border-color: color-mix(in oklab, var(--good), var(--line) 60%); }
.result.error { border-color: color-mix(in oklab, var(--bad), var(--line) 60%); }
.result-meta { display: flex; justify-content: space-between; gap: 1rem; color: var(--muted); font-size: .8rem; margin-bottom: .6rem; }
.result.ok .status { color: var(--good); }
.result.error .status { color: var(--bad); }
pre { margin: 0; overflow: auto; white-space: pre-wrap; word-break: break-word; color: var(--text); }
footer { color: var(--muted); text-align: center; padding: 1rem; border-top: 1px solid var(--line); }
@media (max-width: 560px) {
  .route-row, .actions { flex-direction: column; align-items: stretch; }
  button { width: 100%; }
}`;

const CLIENT_JS = `const results = document.querySelector("#results");
const fetchButton = document.querySelector("#fetch");
const clearButton = document.querySelector("#clear");
const themeButton = document.querySelector("#theme");

function setTheme(mode) {
  document.documentElement.setAttribute("data-mode", mode);
  document.documentElement.style.colorScheme = mode;
  localStorage.setItem("theme", mode);
  themeButton.textContent = mode === "light" ? "☾" : "☀";
}

setTheme(localStorage.getItem("theme") || "light");

themeButton.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-mode") === "light" ? "dark" : "light";
  setTheme(next);
});

clearButton.addEventListener("click", () => {
  results.className = "result-list empty";
  results.textContent = "No requests yet.";
});

fetchButton.addEventListener("click", async () => {
  fetchButton.disabled = true;
  fetchButton.textContent = "Paying...";

  const startedAt = new Date();
  try {
    const res = await fetch("/api/fetch-protected-route", { method: "POST" });
    const text = await res.text();
    let payload = text;
    try { payload = JSON.stringify(JSON.parse(text), null, 2); } catch {}
    addResult(res.ok, res.status, startedAt, payload);
  } catch (error) {
    addResult(false, "network", startedAt, error instanceof Error ? error.message : String(error));
  } finally {
    fetchButton.disabled = false;
    fetchButton.textContent = "Fetch & Pay";
  }
});

function addResult(ok, status, startedAt, payload) {
  if (results.classList.contains("empty")) {
    results.className = "result-list";
    results.textContent = "";
  }

  const item = document.createElement("article");
  item.className = "result " + (ok ? "ok" : "error");
  const meta = document.createElement("div");
  meta.className = "result-meta";
  const statusEl = document.createElement("span");
  statusEl.className = "status";
  statusEl.textContent = (ok ? "Success" : "Error") + " · " + status;
  const timeEl = document.createElement("span");
  timeEl.textContent = startedAt.toLocaleTimeString();
  const pre = document.createElement("pre");
  pre.textContent = payload;
  meta.append(statusEl, timeEl);
  item.append(meta, pre);
  results.prepend(item);
}`;
