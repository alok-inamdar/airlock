/** Small browser-safe ID helper with a non-crypto fallback. */

export function createId(prefix = "audit"): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return `${prefix}_${cryptoApi.randomUUID()}`;
  }
  const random = cryptoApi?.getRandomValues
    ? Array.from(cryptoApi.getRandomValues(new Uint8Array(8)))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
    : Math.random().toString(16).slice(2, 18);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}
