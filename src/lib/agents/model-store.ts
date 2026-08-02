// Model weight storage in the Cache API. Weights never touch the main thread
// as JS objects — we stream the response straight into the cache, so a
// 2GB GGUF costs no heap.

const CACHE_NAME = "dynaminko-models-v1";

export type DownloadProgress = { receivedMb: number; totalMb: number | null };

async function cache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

export async function installedModels(): Promise<string[]> {
  const c = await cache();
  if (!c) return [];
  const keys = await c.keys();
  return keys.map((r) => new URL(r.url).searchParams.get("model") ?? r.url);
}

function keyFor(modelId: string) {
  return `https://dynaminko.local/model?model=${encodeURIComponent(modelId)}`;
}

export async function isInstalled(modelId: string): Promise<boolean> {
  const c = await cache();
  if (!c) return false;
  return Boolean(await c.match(keyFor(modelId)));
}

/** Streams the weights into the Cache API, reporting progress as it goes. */
export async function downloadModel(
  modelId: string,
  url: string,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const c = await cache();
  if (!c) throw new Error("Cache API unavailable in this browser");

  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`download failed → ${res.status}`);

  const totalHeader = res.headers.get("content-length");
  const total = totalHeader ? Number(totalHeader) : null;
  let received = 0;

  const reported = new Response(
    res.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;
          onProgress?.({
            receivedMb: Math.round(received / 1e6),
            totalMb: total ? Math.round(total / 1e6) : null,
          });
          controller.enqueue(chunk);
        },
      }),
    ),
    { headers: { "content-type": "application/octet-stream" } },
  );

  await c.put(keyFor(modelId), reported);
}

export async function removeModel(modelId: string): Promise<void> {
  const c = await cache();
  await c?.delete(keyFor(modelId));
}

export async function modelBytes(modelId: string): Promise<number | null> {
  const c = await cache();
  const hit = await c?.match(keyFor(modelId));
  if (!hit) return null;
  const buf = await hit.clone().arrayBuffer();
  return buf.byteLength;
}
