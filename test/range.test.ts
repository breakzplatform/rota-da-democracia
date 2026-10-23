import { describe, expect, it } from "vitest";
import { fetchWithRange, parseRange } from "../src/range";

describe("parseRange", () => {
  it("reads single byte ranges", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=500-5000", 1000)).toEqual({ start: 500, end: 999 });
  });

  it("serves the full body for absent or unsupported ranges", () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange("bytes=0-1,5-9", 1000)).toBeNull();
    expect(parseRange("bytes=-", 1000)).toBeNull();
    expect(parseRange("items=0-1", 1000)).toBeNull();
  });

  it("rejects ranges past the end", () => {
    expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 1000)).toBe("unsatisfiable");
  });
});

describe("fetchWithRange", () => {
  const bytes = Uint8Array.from({ length: 1000 }, (_, index) => index % 256);
  const assets = {
    async fetch(input: Request): Promise<Response> {
      expect(input.headers.get("Range")).toBeNull();
      // Several chunks, so slices cross chunk boundaries.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let at = 0; at < bytes.length; at += 128) controller.enqueue(bytes.slice(at, at + 128));
          controller.close();
        },
      });
      // Like the real binding, no Content-Length.
      return new Response(body, { headers: { "Content-Type": "video/mp4" } });
    },
  } as unknown as Fetcher;
  const url = "https://carona.test/media/video.mp4";

  it("answers a range with 206 and only those bytes", async () => {
    const response = await fetchWithRange(new Request(url, { headers: { Range: "bytes=100-299" } }), assets);
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 100-299/1000");
    expect(response.headers.get("Content-Length")).toBe("200");
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.slice(100, 300));
  });

  it("serves the whole file with Accept-Ranges when no range is asked", async () => {
    const response = await fetchWithRange(new Request(url), assets);
    expect(response.status).toBe(200);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect((await response.arrayBuffer()).byteLength).toBe(1000);
  });

  it("answers 416 past the end", async () => {
    const response = await fetchWithRange(new Request(url, { headers: { Range: "bytes=2000-" } }), assets);
    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */1000");
  });
});
