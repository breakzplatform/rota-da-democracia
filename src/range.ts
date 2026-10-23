// Workers static assets ignore Range requests, and iOS Safari will not play a
// video unless the server answers them with 206. The assets binding reports no
// Content-Length either, so the file is read into memory once per isolate and
// ranges are sliced from that copy. Only meant for the few files under /media.

export type ByteRange = { start: number; end: number };

// Returns null when the header is absent or not a single byte range (the full
// body is served then) and "unsatisfiable" when it falls outside the file.
export function parseRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match) return null;
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return null;
  if (first === "") {
    const suffix = Number(last);
    if (suffix === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  if (start >= size) return "unsatisfiable";
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  if (end < start) return null;
  return { start, end };
}

const cache = new Map<string, { etag: string | null; bytes: Uint8Array }>();

export async function fetchWithRange(request: Request, assets: Fetcher): Promise<Response> {
  const rangeHeader = request.headers.get("Range");
  const headers = new Headers(request.headers);
  headers.delete("Range");
  const response = await assets.fetch(new Request(request.url, { method: "GET", headers }));
  if (response.status !== 200 || !response.body) return response;

  const key = new URL(request.url).pathname;
  const etag = response.headers.get("ETag");
  let entry = cache.get(key);
  if (entry && entry.etag === etag) {
    await response.body.cancel();
  } else {
    entry = { etag, bytes: new Uint8Array(await response.arrayBuffer()) };
    cache.set(key, entry);
  }
  const { bytes } = entry;
  const size = bytes.byteLength;

  const out = new Headers(response.headers);
  out.set("Accept-Ranges", "bytes");
  const range = request.method === "GET" ? parseRange(rangeHeader, size) : null;
  if (range === "unsatisfiable") {
    out.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers: out });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  out.set("Content-Length", String(end - start + 1));
  if (range) out.set("Content-Range", `bytes ${start}-${end}/${size}`);
  const body = request.method === "HEAD" ? null : bytes.subarray(start, end + 1);
  return new Response(body, { status: range ? 206 : 200, headers: out });
}
