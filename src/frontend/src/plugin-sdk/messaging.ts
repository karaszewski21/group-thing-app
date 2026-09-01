const REQUEST_ID_PREFIX = "aj.plugin.";
const TIMEOUT_MS = 10_000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingRequest>();

function generateRequestId(): string {
  return REQUEST_ID_PREFIX + crypto.randomUUID();
}

/**
 * Sends a message to the host and waits for a correlated response.
 * Times out after 10 seconds.
 */
export function sendMessageAndWait(
  type: string,
  payload: Record<string, unknown>,
  hostOrigin: string,
): Promise<unknown> {
  const requestId = generateRequestId();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`Plugin message timeout: ${type} (${requestId})`));
    }, TIMEOUT_MS);

    pending.set(requestId, { resolve, reject, timer });

    window.parent.postMessage(
      { requestId, type, payload },
      hostOrigin,
    );
  });
}

/**
 * Sends a message to the host without waiting for a response.
 * Used for fire-and-forget messages like filterChange.
 */
export function sendFireAndForget(
  type: string,
  payload: Record<string, unknown>,
  hostOrigin: string,
): void {
  const requestId = generateRequestId();

  window.parent.postMessage(
    { requestId, type, payload },
    hostOrigin,
  );
}

/**
 * Handles a response message from the host, resolving the matching pending promise.
 */
export function handleResponse(data: { responseId: string; payload: unknown; error?: string }): void {
  const entry = pending.get(data.responseId);
  if (!entry) return;

  clearTimeout(entry.timer);
  pending.delete(data.responseId);

  if (data.error) {
    entry.reject(new Error(data.error));
  } else {
    entry.resolve(data.payload);
  }
}

/**
 * Returns the number of pending request/response promises. Used for testing.
 */
export function getPendingCount(): number {
  return pending.size;
}

/**
 * Installs the global message listener that routes host responses to pending promises.
 * Validates event.origin matches the expected hostOrigin to prevent response spoofing.
 */
export function installResponseListener(hostOrigin: string): void {
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.origin !== hostOrigin) return;
    const data = event.data;
    if (data?.responseId) {
      handleResponse(data);
    }
  });
}
