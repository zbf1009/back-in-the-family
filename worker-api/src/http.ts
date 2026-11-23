export type RequestBody =
  | { ok: true; value: unknown }
  | { ok: false; kind: 'malformed_request' | 'payload_too_large' };

/** Count actual streamed UTF-8 bytes before parsing a single JSON value. */
export async function readRequest(request: Request, cap: number): Promise<RequestBody> {
  if (request.body === null) return { ok: false, kind: 'malformed_request' };
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > cap) {
        await reader.cancel().catch(() => {});
        return { ok: false, kind: 'payload_too_large' };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown };
  } catch {
    await reader.cancel().catch(() => {});
    return { ok: false, kind: 'malformed_request' };
  } finally {
    reader.releaseLock();
  }
}
