// ============================================================
//  sw-download.js — Service Worker for Streaming Downloads
//  Enables mobile browsers to download large files from Telegram
//  without holding the entire file in RAM.
//
//  Flow:
//  1. Main thread sends INIT_PORT message with a MessagePort + metadata
//  2. Main thread navigates iframe to /sw-download/{uuid}
//  3. This SW intercepts that fetch and responds with a ReadableStream
//     that reads chunks from the MessagePort
//  4. Browser's native download manager saves the stream to disk
// ============================================================

const PORT_MAP = new Map(); // uuid -> { port, filename, mime, size }

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

// Receive MessagePort from main thread
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "INIT_PORT") {
    const { uuid, filename, mime, size } = e.data;
    const port = e.ports[0];
    if (port && uuid) {
      PORT_MAP.set(uuid, { port, filename, mime: mime || "application/octet-stream", size: size || 0 });
    }
  }
});

// Intercept download fetch requests
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Only intercept our special download path
  if (!url.pathname.startsWith("/sw-download/")) return;

  const uuid = url.pathname.split("/sw-download/")[1];
  if (!uuid) return;

  const entry = PORT_MAP.get(uuid);
  if (!entry) {
    e.respondWith(new Response("Download session not found", { status: 404 }));
    return;
  }

  PORT_MAP.delete(uuid); // one-shot: clean up immediately

  const { port, filename, mime, size } = entry;

  // Build a ReadableStream that reads chunks from the MessagePort
  const body = new ReadableStream({
    start(controller) {
      port.onmessage = (evt) => {
        const data = evt.data;

        if (data && data.done) {
          // Stream complete
          controller.close();
          port.close();
          return;
        }

        if (data && data.error) {
          // Stream aborted
          controller.error(new Error(data.error));
          port.close();
          return;
        }

        // data is a chunk (Uint8Array or ArrayBuffer)
        if (data instanceof ArrayBuffer) {
          controller.enqueue(new Uint8Array(data));
        } else if (data instanceof Uint8Array) {
          controller.enqueue(data);
        } else if (data && data.buffer) {
          // Buffer-like object
          controller.enqueue(new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength || data.length));
        } else {
          // Unknown format, try to pass through
          controller.enqueue(data);
        }
      };

      port.onmessageerror = () => {
        controller.error(new Error("MessagePort error"));
        port.close();
      };
    },
    cancel() {
      // Consumer cancelled (e.g., user cancelled download in browser)
      try { port.postMessage({ cancelled: true }); } catch (_) {}
      port.close();
    }
  });

  // Encode filename for Content-Disposition header (RFC 5987)
  const encodedName = encodeURIComponent(filename).replace(/'/g, "%27");

  const headers = {
    "Content-Type": mime,
    "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodedName}`,
    "Cache-Control": "no-cache, no-store",
  };

  // Include Content-Length if known (enables progress bar in download manager)
  if (size > 0) {
    headers["Content-Length"] = String(size);
  }

  e.respondWith(new Response(body, { headers }));
});
