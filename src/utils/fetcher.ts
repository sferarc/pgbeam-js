export class ApiError extends Error {
  status: number;
  statusText: string;
  body: unknown;

  constructor(status: number, statusText: string, body: unknown) {
    const message =
      typeof body === "object" && body !== null ? (extractMessage(body) ?? statusText) : statusText;
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

/** Extract a human-readable message from an API error body. */
export function extractMessage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const obj = body as Record<string, unknown>;
  // API returns { error: { code, message } }
  if (typeof obj.error === "object" && obj.error !== null) {
    const inner = obj.error as Record<string, unknown>;
    if (typeof inner.message === "string") return inner.message;
  }
  if (typeof obj.message === "string") return obj.message;
  return undefined;
}

export type OnResponseHook = (response: Response) => void | Promise<void>;

export interface RetryConfig {
  /** Max retry attempts after initial request (default: 5, 0 = disabled). */
  maxRetries?: number;
  /** Initial backoff in ms (default: 500). */
  initialDelayMs?: number;
  /** Max backoff in ms (default: 30_000). */
  maxDelayMs?: number;
  /** Auto-send Idempotency-Key on mutating retries (default: true). */
  idempotencyKeys?: boolean;
}

export interface FetcherOptions {
  method: string;
  path: string;
  pathParams?: Record<string, string>;
  queryParams?: Record<string, unknown>;
  body?: unknown;
  baseUrl: string;
  token: string | null;
  fetchImpl?: typeof globalThis.fetch;
  onResponse?: OnResponseHook;
  retry?: RetryConfig;
}

const RETRYABLE_STATUS_CODES = [408, 429, 502, 503, 504];

const DEFAULT_RETRY: Required<RetryConfig> = {
  maxRetries: 5,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  idempotencyKeys: true,
};

function resolveRetry(config?: RetryConfig): Required<RetryConfig> {
  if (!config) return { ...DEFAULT_RETRY, maxRetries: 0 };
  return { ...DEFAULT_RETRY, ...config };
}

/** Parse Retry-After header as milliseconds. Returns undefined if unparseable. */
function parseRetryAfter(response: Response): number | undefined {
  const header = response.headers.get("Retry-After");
  if (!header) return undefined;

  // Integer seconds
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  // HTTP-date
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    const ms = date - Date.now();
    return ms > 0 ? ms : 0;
  }

  return undefined;
}

/** Compute exponential backoff with jitter. */
function backoff(attempt: number, initialDelayMs: number, maxDelayMs: number): number {
  const delay = Math.min(initialDelayMs * 2 ** attempt, maxDelayMs);
  return delay * (0.5 + Math.random());
}

/** Generate a UUID v4 using crypto.randomUUID if available, otherwise fallback. */
function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function isMutatingMethod(method: string): boolean {
  const upper = method.toUpperCase();
  return upper === "POST" || upper === "PATCH";
}

export async function fetcher<T>(options: FetcherOptions): Promise<T> {
  let url = options.path;
  if (options.pathParams) {
    for (const [key, value] of Object.entries(options.pathParams)) {
      url = url.replace(`{${key}}`, encodeURIComponent(value));
    }
  }

  const fullUrl = new URL(url, options.baseUrl);

  if (options.queryParams) {
    for (const [key, value] of Object.entries(options.queryParams)) {
      if (value !== undefined && value !== null) {
        fullUrl.searchParams.set(key, String(value));
      }
    }
  }

  const headers: Record<string, string> = {};
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  const retry = resolveRetry(options.retry);
  const urlStr = fullUrl.toString();
  const fetchBody = options.body !== undefined ? JSON.stringify(options.body) : undefined;

  // Generate idempotency key once, reused across all retry attempts.
  const idempotencyKey =
    retry.maxRetries > 0 && retry.idempotencyKeys && isMutatingMethod(options.method)
      ? generateUUID()
      : undefined;

  for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
    const reqHeaders = { ...headers };

    // Attach idempotency key on all attempts for mutating requests.
    if (idempotencyKey) {
      reqHeaders["Idempotency-Key"] = idempotencyKey;
    }

    try {
      const response = await fetchFn(urlStr, {
        method: options.method,
        headers: reqHeaders,
        body: fetchBody,
      });

      if (options.onResponse) {
        await options.onResponse(response);
      }

      if (response.ok) {
        return parseResponseBody<T>(response);
      }

      // Non-retryable error or last attempt — throw immediately.
      if (!RETRYABLE_STATUS_CODES.includes(response.status) || attempt === retry.maxRetries) {
        const errorBody = await response.json().catch(() => null);
        throw new ApiError(response.status, response.statusText, errorBody);
      }

      // Retryable error — wait and retry.
      const delay =
        parseRetryAfter(response) ?? backoff(attempt, retry.initialDelayMs, retry.maxDelayMs);
      await sleep(delay);
    } catch (err) {
      // If it's already an ApiError, rethrow (we threw it above).
      if (err instanceof ApiError) throw err;

      // Network error — retry if we have attempts left.
      if (attempt === retry.maxRetries) throw err;

      const delay = backoff(attempt, retry.initialDelayMs, retry.maxDelayMs);
      await sleep(delay);
    }
  }

  // Unreachable — the loop either returns or throws.
  throw new Error("fetcher: exhausted all retry attempts");
}

async function parseResponseBody<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    return response.json() as Promise<T>;
  }
  // Non-JSON body (e.g. text/csv from audit-log export). Parse opportunistically
  // in case the server mislabels JSON, but fall back to the raw text so callers
  // get the payload instead of undefined. Only an empty body is undefined.
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
