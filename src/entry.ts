/// <reference types="@fastly/js-compute" />

import { Buffer as BufferPolyfill } from "buffer";

Object.defineProperty(globalThis, "Buffer", {
  value: BufferPolyfill,
  writable: true,
  configurable: true
});

Object.defineProperty(globalThis, "global", {
  value: globalThis,
  writable: true,
  configurable: true
});

let appPromise: Promise<typeof import("./index")> | undefined;

function loadApp() {
  appPromise ??= import("./index");
  return appPromise;
}

addEventListener("fetch", (event) => {
  event.respondWith(
    (async () => {
      try {
        const { app } = await loadApp();
        return app.fetch(event.request);
      } catch (error) {
        console.error("App initialization error", error);

        return new Response(
          JSON.stringify(
            {
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            },
            null,
            2
          ),
          {
            status: 500,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store"
            }
          }
        );
      }
    })()
  );
});