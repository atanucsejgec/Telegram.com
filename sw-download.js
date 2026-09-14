// ============================================================
//  sw-download.js — Service Worker for Streaming Downloads
//  Also integrated into sw.js for single unified SW mode.
// ============================================================

const PORT_MAP = new Map();

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "INIT_PORT") {
    const { uuid, filename, mime, size } = e.data;
    const port = e.ports && e.ports[0];
    if (port && uuid) {
      PORT_MAP.set(uuid, { port, filename, mime: mime || "application/octet-stream", size: size || 0 });
    }
  }
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (!url.pathname.includes("/sw-download/")) return;

  const parts = url.pathname.split("/sw-download/");
  const uuid = parts[1];
  if (!uuid) return;

  const entry = PORT_MAP.get(uuid);
  if (!entry) {
    e.respondWith(new Response("Download session not found or expired", { status: 404 }));
    return;
  }

  PORT_MAP.delete(uuid);
  const { port, filename, mime, size } = entry;

  const body = new ReadableStream({
    start(controller) {
      port.onmessage = (evt) => {
        const data = evt.data;

        if (data && data.done) {
          controller.close();
          port.close();
          return;
        }

        if (data && data.error) {
          controller.error(new Error(data.error));
          port.close();
          return;
        }

        if (data instanceof ArrayBuffer) {
          controller.enqueue(new Uint8Array(data));
        } else if (data instanceof Uint8Array) {
          controller.enqueue(data);
        } else if (data && data.buffer) {
          controller.enqueue(new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength || data.length));
        } else if (data) {
          controller.enqueue(data);
        }
      };

      port.onmessageerror = () => {
        controller.error(new Error("MessagePort transfer error"));
        port.close();
      };
    },
    cancel() {
      try { port.postMessage({ cancelled: true }); } catch (_) {}
      port.close();
    }
  });

  const encodedName = encodeURIComponent(filename).replace(/'/g, "%27");
  const headers = {
    "Content-Type": mime,
    "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodedName}`,
    "Cache-Control": "no-cache, no-store, must-revalidate",
  };
  if (size > 0) {
    headers["Content-Length"] = String(size);
  }

  e.respondWith(new Response(body, { headers }));
});
