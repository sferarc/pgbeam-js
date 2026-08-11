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

/**
 * A request that never got an HTTP answer: DNS failure, refused or reset
 * connection, or a timeout. Distinct from `ApiError`, which means the server
 * did answer and the answer was an error.
 *
 * Node reports every connection-level failure as `TypeError: fetch failed` and
 * hangs the real reason off `cause`, so the message flattens that chain. A log
 * line should say which URL was called and why it did not answer without the
 * reader having to inspect the object.
 */
export class NetworkError extends Error {
  /** Fully-resolved request URL, including query string. */
  readonly url: string;
  readonly method: string;
  /** Total attempts made, including the first. */
  readonly attempts: number;
  /** Wall-clock time spent across every attempt. */
  readonly elapsedMs: number;
  /** True when the last attempt was cut off by the per-request timeout. */
  readonly timedOut: boolean;

  constructor(args: {
    method: string;
    url: string;
    attempts: number;
    elapsedMs: number;
    timedOut: boolean;
    timeoutMs: number;
    cause: unknown;
  }) {
    const reason = args.timedOut
      ? `timed out after ${args.timeoutMs}ms`
      : describeError(args.cause);
    super(
      `${args.method} ${args.url} failed after ${args.attempts} attempt(s) in ${args.elapsedMs}ms: ${reason}`,
      { cause: args.cause },
    );
    this.name = "NetworkError";
    this.url = args.url;
    this.method = args.method;
    this.attempts = args.attempts;
    this.elapsedMs = args.elapsedMs;
    this.timedOut = args.timedOut;
  }
}

/**
 * Flatten an error and its `cause` chain into one line.
 *
 * `TypeError: fetch failed` on its own says nothing. The useful detail (an
 * `ECONNREFUSED` with the address it tried, a TLS failure, a DNS `EAI_AGAIN`)
 * is always one or two `cause` levels down.
 */
export function describeError(err: unknown, depth = 0): string {
  if (depth > 5) return "…";
  if (err === null || err === undefined) return String(err);
  if (typeof err !== "object") return String(err);

  const candidate = err as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };
  const name = typeof candidate.name === "string" ? candidate.name : "Error";
  const message = typeof candidate.message === "string" ? candidate.message : String(err);
  const code = typeof candidate.code === "string" ? ` [${candidate.code}]` : "";
  const head = `${name}: ${message}${code}`;

  // AggregateError (what undici raises when every address for a host fails)
  // carries the real reasons in `errors`, not in `cause`.
  const errors = (err as { errors?: unknown }).errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const inner = errors.map((e) => describeError(e, depth + 1)).join("; ");
    return `${head} (caused by ${inner})`;
  }

  if (candidate.cause !== undefined && candidate.cause !== null) {
    return `${head} (caused by ${describeError(candidate.cause, depth + 1)})`;
  }
  return head;
}

/** `AbortSignal.timeout` rejects with TimeoutError; an aborted fetch with AbortError. */
function isAbortError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const name = (err as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
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
  /**
   * Ceiling for the whole call, measured from the first attempt and including
   * time spent in requests (default: 120_000). A retry is skipped when it would
   * land past this, so a long backoff ladder against a service that is down
   * cannot outlive the budget.
   */
  totalBudgetMs?: number;
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
  /**
   * Per-attempt timeout in ms (default: 30_000). 0 disables it, which leaves the
   * request at the mercy of the platform's own socket timeouts.
   */
  timeoutMs?: number;
}

const RETRYABLE_STATUS_CODES = [408, 429, 502, 503, 504];

/**
 * Long enough for the slowest legitimate call (an audit-log CSV export), short
 * enough that a black-holed connection fails in a sane time instead of hanging
 * until the platform gives up.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

const DEFAULT_RETRY: Required<RetryConfig> = {
  maxRetries: 5,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  idempotencyKeys: true,
  totalBudgetMs: 120_000,
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

/** Whether waiting `delayMs` and trying again would land past the total budget. */
function outOfBudget(startedAt: number, delayMs: number, totalBudgetMs: number): boolean {
  if (totalBudgetMs <= 0) return false;
  return Date.now() - startedAt + delayMs >= totalBudgetMs;
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
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
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

    // Distinguishes a transport failure from an `onResponse` hook that threw
    // after the server had already answered.
    let answered = false;

    try {
      const response = await fetchFn(urlStr, {
        method: options.method,
        headers: reqHeaders,
        body: fetchBody,
        ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
      });
      answered = true;

      if (options.onResponse) {
        await options.onResponse(response);
      }

      if (response.ok) {
        return parseResponseBody<T>(response);
      }

      const retryable =
        RETRYABLE_STATUS_CODES.includes(response.status) && attempt < retry.maxRetries;
      const delay = retryable
        ? (parseRetryAfter(response) ?? backoff(attempt, retry.initialDelayMs, retry.maxDelayMs))
        : 0;

      // Not retryable, out of attempts, or the wait would outlive the budget.
      if (!retryable || outOfBudget(startedAt, delay, retry.totalBudgetMs)) {
        const errorBody = await response.json().catch(() => null);
        throw new ApiError(response.status, response.statusText, errorBody);
      }

      await sleep(delay);
    } catch (err) {
      // If it's already an ApiError, rethrow (we threw it above).
      if (err instanceof ApiError) throw err;

      // The request never got an answer. Retry while attempts and budget last,
      // then report the endpoint and the real underlying cause.
      const delay = backoff(attempt, retry.initialDelayMs, retry.maxDelayMs);
      if (attempt === retry.maxRetries || outOfBudget(startedAt, delay, retry.totalBudgetMs)) {
        // The server did answer, so this is not a reachability problem. Report
        // it as it came rather than dressing it up as one.
        if (answered) throw err;
        throw new NetworkError({
          method: options.method,
          url: urlStr,
          attempts: attempt + 1,
          elapsedMs: Date.now() - startedAt,
          timedOut: isAbortError(err),
          timeoutMs,
          cause: err,
        });
      }

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
