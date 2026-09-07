/** One field the request got wrong, from a problem document's `errors`. */
export type ApiFieldError = {
  /** Dotted path into the request body, e.g. `database.host`. */
  field: string;
  /** What is wrong with that field. */
  detail: string;
};

/**
 * An error the server answered with.
 *
 * The API answers every error with an RFC 9457 problem document
 * (`application/problem+json`), so the fields of that document are lifted onto
 * the error rather than left for the caller to dig out of `body`.
 *
 * Branch on `code`, not on `message`. `code` is the stable identity of the
 * condition and distinguishes cases that share a status: a `403` is either
 * `FORBIDDEN` (ask an admin for a role) or `PLAN_LIMIT_REACHED` (change plan),
 * and those are resolved in completely different ways. `message` is prose and
 * is free to change between releases.
 */
export class ApiError extends Error {
  status: number;
  statusText: string;
  body: unknown;

  /** Stable machine-readable identity of the condition, e.g. `NOT_FOUND`. */
  readonly code?: string;
  /** The same identity as a URI, resolving to the published error catalog. */
  readonly type?: string;
  /** Short human-readable summary of the condition. */
  readonly title?: string;
  /** Explanation specific to this occurrence. Same value as `message`. */
  readonly detail?: string;
  /** Path of the request that produced the error. */
  readonly instance?: string;
  /** Correlation id, also returned in the `X-Request-Id` header. */
  readonly requestId?: string;
  /** Field-level detail, present when the request failed validation. */
  readonly errors?: ApiFieldError[];

  constructor(status: number, statusText: string, body: unknown) {
    const message =
      typeof body === "object" && body !== null ? (extractMessage(body) ?? statusText) : statusText;
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;

    const problem = asRecord(body);
    if (problem) {
      this.code = str(problem.code);
      this.type = str(problem.type);
      this.title = str(problem.title);
      this.detail = str(problem.detail);
      this.instance = str(problem.instance);
      this.requestId = str(problem.request_id);
      this.errors = fieldErrors(problem.errors);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function fieldErrors(value: unknown): ApiFieldError[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = value.flatMap((entry) => {
    const obj = asRecord(entry);
    const field = str(obj?.field);
    const detail = str(obj?.detail);
    return field !== undefined && detail !== undefined ? [{ field, detail }] : [];
  });
  return parsed.length > 0 ? parsed : undefined;
}

/**
 * Extract a human-readable message from an API error body.
 *
 * The control plane answers with a problem document, whose human-readable
 * explanation is `detail`. The two older shapes are still read because not
 * everything a client talks to is the control plane: the edge MCP endpoint
 * still answers `{ error: { code, message } }`, and Echo's own default is
 * `{ message }`.
 */
export function extractMessage(body: unknown): string | undefined {
  const obj = asRecord(body);
  if (!obj) return undefined;
  // RFC 9457 problem document.
  if (typeof obj.detail === "string") return obj.detail;
  // Legacy envelope: { error: { code, message } }.
  const inner = asRecord(obj.error);
  if (inner && typeof inner.message === "string") return inner.message;
  if (typeof obj.message === "string") return obj.message;
  // A problem document with no `detail` still has a `title`, which beats
  // falling all the way back to the status line.
  if (typeof obj.title === "string" && typeof obj.status === "number") return obj.title;
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
  /**
   * A JWT, or a function resolving one. The function form is resolved here,
   * under `timeoutMs`, rather than by the caller: a lazy token is itself a
   * network call, and one resolved before the fetcher is entered would sit
   * outside every bound this module applies.
   */
  token: string | null | (() => Promise<string | null>);
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

/**
 * Resolve a lazy token, or give up once `timeoutMs` has passed without it.
 *
 * A token function is a network call in disguise. Both browser clients resolve
 * a JWT from an auth endpoint (`authClient.token()`), so an auth endpoint that
 * accepts the request and never answers is a stall like any other. It just
 * happened before the attempt loop, where none of this module's bounds reach:
 * `AbortSignal.timeout` is attached to the fetch, `totalBudgetMs` is measured
 * from the first attempt, and neither exists yet. A `try`/`catch` in the token
 * function does not cover it either, because a call that never answers never
 * rejects. The result was a request with no ceiling of any kind, which is
 * exactly what every other bound in this file was written to rule out.
 *
 * The failure is reported as a timed-out `NetworkError`, the same shape a
 * stalled attempt produces, because it is the same event to a caller: the
 * request never got an answer and a second try tests the same thing again.
 * `lib/query-provider.tsx` in the dashboard already withholds its retry on
 * `timedOut`, so it gets the right behaviour here for free.
 *
 * The bound is `timeoutMs`, the per-attempt ceiling, because the token round
 * trip is an attempt. A call whose token stalls and whose request then stalls
 * costs two of them, which is the honest cost of two sequential round trips and
 * still finite, where before it was unbounded.
 *
 * `timeoutMs` of 0 disables the fetch timeout by documented contract, so it
 * disables this one too rather than inventing a ceiling the caller turned off.
 */
async function resolveToken(
  token: FetcherOptions["token"],
  ctx: { method: string; url: string; startedAt: number; timeoutMs: number },
): Promise<string | null> {
  if (typeof token !== "function") return token;
  if (ctx.timeoutMs <= 0) return token();

  const stalled = Symbol("token-timeout");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof stalled>((resolve) => {
    timer = setTimeout(() => resolve(stalled), ctx.timeoutMs);
  });

  // A rejection from `token()` wins the race and propagates unchanged: the
  // function decided it had failed, and relabelling that as a network timeout
  // would lose the reason.
  const resolved = await Promise.race([token(), deadline]).finally(() => clearTimeout(timer));
  if (resolved !== stalled) return resolved;

  throw new NetworkError({
    method: ctx.method,
    url: ctx.url,
    attempts: 0,
    elapsedMs: Date.now() - ctx.startedAt,
    timedOut: true,
    timeoutMs: ctx.timeoutMs,
    cause: new Error("token resolution did not settle"),
  });
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

  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  const retry = resolveRetry(options.retry);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  const urlStr = fullUrl.toString();
  const fetchBody = options.body !== undefined ? JSON.stringify(options.body) : undefined;

  // Resolved once, before the attempt loop, so retries reuse one token rather
  // than paying for a fresh auth round trip each time.
  const token = await resolveToken(options.token, {
    method: options.method,
    url: urlStr,
    startedAt,
    timeoutMs,
  });

  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

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
