export class BoundedJsonResponseError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
        this.name = 'BoundedJsonResponseError';
    }
}
/** Reads untrusted JSON without allowing an upstream service to grow memory without bound. */
export async function readBoundedJsonResponse(response, maximumBytes) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
        throw new BoundedJsonResponseError('invalidResponse');
    }
    const declaredLength = response.headers.get('content-length');
    if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > maximumBytes) {
        throw new BoundedJsonResponseError('responseTooLarge');
    }
    if (!response.body)
        throw new BoundedJsonResponseError('invalidResponse');
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            total += value.byteLength;
            if (total > maximumBytes)
                throw new BoundedJsonResponseError('responseTooLarge');
            chunks.push(value);
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return JSON.parse(text);
    }
    catch (error) {
        if (error instanceof BoundedJsonResponseError)
            throw error;
        throw new BoundedJsonResponseError('invalidResponse');
    }
    finally {
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}
/** Releases an ignored or rejected response without trusting upstream cancellation behavior. */
export function discardResponseBody(response) {
    try {
        const cancellation = response?.body?.cancel();
        if (cancellation)
            void cancellation.catch(() => undefined);
    }
    catch {
        // Cancellation is best-effort and must not replace the bounded caller error.
    }
    return Promise.resolve();
}
