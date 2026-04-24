// Polyfill TextEncoder / crypto.subtle for jsdom before importing the SUT.
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from "util";
if (typeof globalThis.TextEncoder === "undefined") {
  (globalThis as unknown as { TextEncoder: typeof NodeTextEncoder }).TextEncoder = NodeTextEncoder;
}
if (typeof globalThis.TextDecoder === "undefined") {
  (globalThis as unknown as { TextDecoder: typeof NodeTextDecoder }).TextDecoder = NodeTextDecoder;
}
// jsdom doesn't expose Node's webcrypto on the global `crypto` object in
// all versions — wire it up explicitly.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeCrypto = require("crypto");
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: nodeCrypto.webcrypto ?? nodeCrypto,
    configurable: true,
  });
}

import { requestUrl } from "obsidian";
import type { RequestUrlParam } from "obsidian";
import type { Stroke, StrokePoint } from "../types";
import { encodePoints } from "../document/PointEncoder";
import {
  MyScriptBackend,
  buildRequestBody,
  hmacSha512Hex,
  strokesToMyScriptFormat,
  transcriptToLines,
} from "./MyScriptBackend";

const requestUrlMock = requestUrl as unknown as jest.Mock;

function mockResponse(status: number, body: string): void {
  requestUrlMock.mockImplementationOnce(() =>
    Promise.resolve({ status, headers: {}, text: body, json: null, arrayBuffer: new ArrayBuffer(0) }),
  );
}

function makeStrokeFromPoints(id: string, points: StrokePoint[]): Stroke {
  return {
    id,
    pageIndex: 0,
    style: "_default",
    bbox: [0, 0, 100, 100],
    pointCount: points.length,
    pts: encodePoints(points),
  };
}

function pt(x: number, y: number, t: number, p = 0.5): StrokePoint {
  return { x, y, pressure: p, tiltX: 0, tiltY: 0, twist: 0, timestamp: t };
}

describe("MyScriptBackend", () => {
  beforeEach(() => requestUrlMock.mockReset());

  describe("isConfigured", () => {
    it("true only when both keys are set", () => {
      expect(new MyScriptBackend(() => ({ applicationKey: "a", hmacKey: "b", language: "en_US" })).isConfigured()).toBe(true);
      expect(new MyScriptBackend(() => ({ applicationKey: "", hmacKey: "b", language: "en_US" })).isConfigured()).toBe(false);
      expect(new MyScriptBackend(() => ({ applicationKey: "a", hmacKey: "", language: "en_US" })).isConfigured()).toBe(false);
    });
  });

  describe("testConnection", () => {
    it("ok on 200", async () => {
      mockResponse(200, "anything");
      const b = new MyScriptBackend(() => ({ applicationKey: "a", hmacKey: "b", language: "en_US" }));
      expect((await b.testConnection()).ok).toBe(true);
    });

    it("auth error on 401", async () => {
      mockResponse(401, "forbidden");
      const b = new MyScriptBackend(() => ({ applicationKey: "bad", hmacKey: "bad", language: "en_US" }));
      const res = await b.testConnection();
      expect(res.ok).toBe(false);
      expect(res.error).toContain("Auth rejected");
    });

    it("signs requests with applicationKey + hmac headers", async () => {
      mockResponse(200, "ok");
      const b = new MyScriptBackend(() => ({ applicationKey: "my-app", hmacKey: "my-hmac", language: "en_US" }));
      await b.testConnection();

      const call = requestUrlMock.mock.calls[0][0] as RequestUrlParam;
      expect(call.headers?.applicationKey).toBe("my-app");
      expect(call.headers?.hmac).toMatch(/^[0-9a-f]{128}$/); // SHA-512 = 64 bytes = 128 hex chars
      expect(call.headers?.["Content-Type"]).toBe("application/json");
    });
  });

  describe("recognizeDocument", () => {
    it("sends strokes, parses plain-text response into lines", async () => {
      mockResponse(200, "hello world\ntwo lines");
      const b = new MyScriptBackend(() => ({ applicationKey: "a", hmacKey: "b", language: "en_US" }));
      const stroke = makeStrokeFromPoints("s1", [pt(10, 10, 0), pt(20, 15, 16)]);

      const result = await b.recognizeDocument({ pages: [{ pageIndex: 0, strokes: [stroke] }] });

      expect(result.backend).toBe("myscript");
      expect(result.pages).toHaveLength(1);
      expect(result.pages[0].lines).toHaveLength(2);
      expect(result.pages[0].lines[0].text).toBe("hello world");
    });

    it("returns empty lines for pages with no strokes", async () => {
      const b = new MyScriptBackend(() => ({ applicationKey: "a", hmacKey: "b", language: "en_US" }));
      const result = await b.recognizeDocument({ pages: [{ pageIndex: 2, strokes: [] }] });
      expect(result.pages[0].lines).toEqual([]);
      expect(requestUrlMock).not.toHaveBeenCalled();
    });

    it("throws on non-2xx response", async () => {
      mockResponse(500, "server error");
      const b = new MyScriptBackend(() => ({ applicationKey: "a", hmacKey: "b", language: "en_US" }));
      const stroke = makeStrokeFromPoints("s1", [pt(0, 0, 0), pt(1, 1, 10)]);
      await expect(
        b.recognizeDocument({ pages: [{ pageIndex: 0, strokes: [stroke] }] })
      ).rejects.toThrow(/MyScript failed: 500/);
    });
  });
});

describe("strokesToMyScriptFormat", () => {
  it("drops strokes with fewer than 2 points", () => {
    const oneShot = makeStrokeFromPoints("s", [pt(0, 0, 0)]);
    expect(strokesToMyScriptFormat([oneShot])).toEqual([]);
  });

  it("populates x/y/t arrays in point order", () => {
    const s = makeStrokeFromPoints("s", [pt(10, 20, 0), pt(15, 25, 16), pt(20, 30, 32)]);
    const [out] = strokesToMyScriptFormat([s]);
    expect(out.x).toEqual([10, 15, 20]);
    expect(out.y).toEqual([20, 25, 30]);
    expect(out.t.length).toBe(3);
  });

  it("applies stroke transform to points", () => {
    // Translate +100 in x, +50 in y
    const s: Stroke = {
      ...makeStrokeFromPoints("s", [pt(0, 0, 0), pt(10, 10, 16)]),
      transform: [1, 0, 0, 1, 100, 50],
    };
    const [out] = strokesToMyScriptFormat([s]);
    expect(out.x[0]).toBe(100);
    expect(out.y[0]).toBe(50);
    expect(out.x[1]).toBe(110);
    expect(out.y[1]).toBe(60);
  });

  it("includes pressure when strokes have varying pressure", () => {
    const s = makeStrokeFromPoints("s", [pt(0, 0, 0, 0.2), pt(1, 1, 10, 0.8)]);
    const [out] = strokesToMyScriptFormat([s]);
    expect(out.p).toBeDefined();
    expect(out.p?.length).toBe(2);
  });
});

describe("buildRequestBody", () => {
  it("emits the expected JSON shape", () => {
    const body = buildRequestBody([{ x: [0, 1], y: [0, 1], t: [0, 10] }], "fr_FR");
    const parsed = JSON.parse(body);
    expect(parsed.contentType).toBe("Text");
    expect(parsed.configuration.lang).toBe("fr_FR");
    expect(parsed.xDPI).toBe(96);
    expect(parsed.strokeGroups).toHaveLength(1);
    expect(parsed.strokeGroups[0].strokes[0].x).toEqual([0, 1]);
  });
});

describe("hmacSha512Hex", () => {
  it("produces 128 hex chars (SHA-512)", async () => {
    const hex = await hmacSha512Hex("hello", "secret");
    expect(hex).toMatch(/^[0-9a-f]{128}$/);
  });

  it("is deterministic for the same input+key", async () => {
    const a = await hmacSha512Hex("foo", "bar");
    const b = await hmacSha512Hex("foo", "bar");
    expect(a).toBe(b);
  });

  it("matches a known test vector (RFC 4231 test case 1, HMAC-SHA512)", async () => {
    // key=0x0b×20, data="Hi There" → HMAC-SHA512 known output
    const key = "\x0b".repeat(20);
    const hex = await hmacSha512Hex("Hi There", key);
    expect(hex).toBe(
      "87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854",
    );
  });
});

describe("transcriptToLines", () => {
  it("splits and filters empty lines", () => {
    const lines = transcriptToLines("one\n\ntwo\n", 3);
    expect(lines.map((l) => l.text)).toEqual(["one", "two"]);
    expect(lines[0].id).toBe("L-3-0");
  });
});
