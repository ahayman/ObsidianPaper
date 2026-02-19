import { deflateSync, inflateSync, strToU8, strFromU8 } from "fflate";

/** Size threshold in bytes above which v2 compression is used. */
export const COMPRESSION_THRESHOLD = 10_000;

/**
 * Compress a string using deflate and return Base64-encoded result.
 */
export function compressString(input: string): string {
  const data = strToU8(input);
  const compressed = deflateSync(data);
  return uint8ToBase64(compressed);
}

/**
 * Decompress a Base64-encoded deflated string.
 */
export function decompressString(base64: string): string {
  const compressed = base64ToUint8(base64);
  const decompressed = inflateSync(compressed);
  return strFromU8(decompressed);
}

/**
 * Estimate the uncompressed size of a document's stroke data.
 */
export function estimateStrokeDataSize(ptsStrings: readonly string[]): number {
  let size = 0;
  for (const pts of ptsStrings) {
    size += pts.length;
  }
  return size;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
