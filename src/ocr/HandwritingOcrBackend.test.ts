// jsdom doesn't provide TextEncoder or Blob.arrayBuffer; polyfill them here
// before the SUT is loaded.
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from "util";
if (typeof globalThis.TextEncoder === "undefined") {
  (globalThis as unknown as { TextEncoder: typeof NodeTextEncoder }).TextEncoder = NodeTextEncoder;
}
if (typeof globalThis.TextDecoder === "undefined") {
  (globalThis as unknown as { TextDecoder: typeof NodeTextDecoder }).TextDecoder = NodeTextDecoder;
}
if (typeof Blob.prototype.arrayBuffer !== "function") {
  (Blob.prototype as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer =
    function (this: Blob) {
      return new Promise<ArrayBuffer>((resolve) => {
        const reader = new FileReader();
        reader.onload = (): void => resolve(reader.result as ArrayBuffer);
        reader.readAsArrayBuffer(this);
      });
    };
}

import { requestUrl } from "obsidian";
import type { RequestUrlParam } from "obsidian";
import {
  HandwritingOcrBackend,
  buildMultipartBody,
  transcriptToLines,
} from "./HandwritingOcrBackend";

const requestUrlMock = requestUrl as unknown as jest.Mock;

function mockResponse(status: number, body: unknown): void {
  requestUrlMock.mockImplementationOnce(() =>
    Promise.resolve({
      status,
      headers: {},
      text: typeof body === "string" ? body : JSON.stringify(body),
      json: typeof body === "object" ? body : null,
      arrayBuffer: new ArrayBuffer(0),
    }),
  );
}

describe("HandwritingOcrBackend", () => {
  beforeEach(() => {
    requestUrlMock.mockReset();
  });

  describe("isConfigured", () => {
    it("true when token present", () => {
      const b = new HandwritingOcrBackend(() => ({ apiToken: "abc" }));
      expect(b.isConfigured()).toBe(true);
    });

    it("false when token missing", () => {
      const b = new HandwritingOcrBackend(() => ({ apiToken: "" }));
      expect(b.isConfigured()).toBe(false);
    });
  });

  describe("testConnection", () => {
    it("returns ok on 200", async () => {
      mockResponse(200, { documents: [] });
      const b = new HandwritingOcrBackend(() => ({ apiToken: "abc" }));
      const res = await b.testConnection();
      expect(res.ok).toBe(true);
    });

    it("returns error on 401", async () => {
      mockResponse(401, { error: "unauthorized" });
      const b = new HandwritingOcrBackend(() => ({ apiToken: "bad" }));
      const res = await b.testConnection();
      expect(res.ok).toBe(false);
      expect(res.error).toContain("401");
    });

    it("sends Bearer token", async () => {
      mockResponse(200, {});
      const b = new HandwritingOcrBackend(() => ({ apiToken: "my-token" }));
      await b.testConnection();
      const call = requestUrlMock.mock.calls[0][0] as RequestUrlParam;
      expect(call.headers?.Authorization).toBe("Bearer my-token");
    });
  });

  describe("recognizeDocument", () => {
    it("uploads each page, polls until processed, returns OcrResult", async () => {
      // Page 0 flow: upload → poll (processing) → poll (processed)
      mockResponse(201, { id: "doc-0" });
      mockResponse(200, { id: "doc-0", status: "processing" });
      mockResponse(200, {
        id: "doc-0",
        status: "processed",
        pages: [{ page_number: 1, transcript: "hello world\ntwo lines" }],
      });

      const b = new HandwritingOcrBackend(() => ({
        apiToken: "abc",
        pollIntervalMs: 1,
        maxWaitSeconds: 5,
      }));
      const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
      const result = await b.recognizeDocument({
        pages: [{ pageIndex: 0, blob }],
      });

      expect(result.backend).toBe("handwriting-ocr");
      expect(result.pages).toHaveLength(1);
      expect(result.pages[0].lines).toHaveLength(2);
      expect(result.pages[0].lines[0].text).toBe("hello world");
      expect(result.pages[0].lines[1].text).toBe("two lines");
      expect(result.pages[0].lines[0].id).toBe("L-0-0");
    });

    it("reports progress through each phase", async () => {
      mockResponse(201, { id: "doc-0" });
      mockResponse(200, { id: "doc-0", status: "processed", pages: [{ page_number: 1, transcript: "x" }] });

      const b = new HandwritingOcrBackend(() => ({ apiToken: "abc", pollIntervalMs: 1 }));
      const blob = new Blob([new Uint8Array([0])], { type: "image/png" });
      const phases: string[] = [];
      await b.recognizeDocument({
        pages: [{ pageIndex: 0, blob }],
        onProgress: (p) => phases.push(p.phase),
      });

      expect(phases).toEqual(["uploading", "processing", "parsing"]);
    });

    it("throws on upload failure", async () => {
      mockResponse(413, "Payload too large");
      const b = new HandwritingOcrBackend(() => ({ apiToken: "abc" }));
      const blob = new Blob([new Uint8Array([0])], { type: "image/png" });
      await expect(
        b.recognizeDocument({ pages: [{ pageIndex: 0, blob }] })
      ).rejects.toThrow(/upload failed: 413/);
    });

    it("throws on backend-reported failure", async () => {
      mockResponse(201, { id: "doc-0" });
      mockResponse(200, { id: "doc-0", status: "failed", error: "OCR engine crashed" });

      const b = new HandwritingOcrBackend(() => ({ apiToken: "abc", pollIntervalMs: 1 }));
      const blob = new Blob([new Uint8Array([0])], { type: "image/png" });
      await expect(
        b.recognizeDocument({ pages: [{ pageIndex: 0, blob }] })
      ).rejects.toThrow(/failed.*engine crashed/i);
    });
  });
});

describe("buildMultipartBody", () => {
  it("builds a correct multipart body with a text field and a file", () => {
    const filedata = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const { body, contentType } = buildMultipartBody([
      { name: "action", value: "transcribe" },
      { name: "file", filename: "x.png", contentType: "image/png", data: filedata },
    ]);

    expect(contentType).toMatch(/^multipart\/form-data; boundary=.+$/);
    const boundary = contentType.split("boundary=")[1];
    const text = new TextDecoder().decode(body);
    expect(text).toContain(`--${boundary}\r\n`);
    expect(text).toContain('Content-Disposition: form-data; name="action"\r\n\r\ntranscribe');
    expect(text).toContain('Content-Disposition: form-data; name="file"; filename="x.png"');
    expect(text).toContain("Content-Type: image/png");
    expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true);
  });
});

describe("transcriptToLines", () => {
  it("splits non-empty lines", () => {
    const lines = transcriptToLines("line one\n\nline three\n", 2);
    expect(lines.map((l) => l.text)).toEqual(["line one", "line three"]);
    expect(lines[0].id).toBe("L-2-0");
    expect(lines[1].id).toBe("L-2-1");
  });

  it("returns [] for empty transcript", () => {
    expect(transcriptToLines("", 0)).toEqual([]);
    expect(transcriptToLines("\n\n", 0)).toEqual([]);
  });
});
