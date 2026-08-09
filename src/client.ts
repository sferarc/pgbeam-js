import { type ApiClient, operationsByPath, operationsByTag } from "./generated/operations-map.gen";
import {
  type FetcherOptions,
  fetcher,
  type OnResponseHook,
  type RetryConfig,
} from "./utils/fetcher";

export type { ApiClient };

/** A single operation's HTTP method and path template. */
export interface OperationMeta {
  method: string;
  path: string;
}

/**
 * The dispatch tables the client drives: operations grouped by tag (for
 * `api.<tag>.<operationId>()`) and keyed by route (for `api.request()`).
 *
 * Defaults to the registry generated from the public API bundle. A client
 * generated from a different bundle passes its own registry and its own `api`
 * type, so it reuses this transport (auth, retries, error mapping) instead of
 * forking it. See `@pgbeam/sdk-internal`.
 */
export interface OperationRegistry {
  byTag: Record<string, Record<string, OperationMeta>>;
  byPath: Record<string, OperationMeta>;
}

const publicRegistry: OperationRegistry = {
  byTag: operationsByTag,
  byPath: operationsByPath,
};

/** Params accepted by every generated operation, before the surface types narrow them. */
interface CallParams {
  pathParams?: FetcherOptions["pathParams"];
  queryParams?: FetcherOptions["queryParams"];
  body?: unknown;
}

export interface PgBeamClientOptions {
  /** JWT token, or async function that resolves one (for lazy/refreshing tokens). */
  token: string | null | (() => Promise<string | null>);
  /** Base URL of the PgBeam API (e.g. "https://api.pgbeam.com"). */
  baseUrl: string;
  /** Optional custom fetch implementation. */
  fetch?: typeof globalThis.fetch;
  /** Optional hook called after every response (e.g. for 401 redirect). */
  onResponse?: OnResponseHook;
  /** Retry configuration. Default: { maxRetries: 5 }. Set false to disable. */
  retry?: RetryConfig | false;
  /** Operation registry to dispatch on. Defaults to the public API's. */
  operations?: OperationRegistry;
}

export class PgBeamClient<TApi = ApiClient> {
  private _baseUrl: string;
  private _tokenOrFn: string | null | (() => Promise<string | null>);
  private _fetchImpl?: typeof globalThis.fetch;
  private _onResponse?: OnResponseHook;
  private _retry?: RetryConfig;
  private _operations: OperationRegistry;
  private _api?: TApi;

  constructor(options: PgBeamClientOptions) {
    this._baseUrl = options.baseUrl;
    this._tokenOrFn = options.token;
    this._fetchImpl = options.fetch;
    this._onResponse = options.onResponse;
    this._retry =
      options.retry === false ? { maxRetries: 0 } : (options.retry ?? { maxRetries: 5 });
    this._operations = options.operations ?? publicRegistry;
  }

  private async _resolveToken(): Promise<string | null> {
    if (typeof this._tokenOrFn === "function") {
      return this._tokenOrFn();
    }
    return this._tokenOrFn;
  }

  private async _send(meta: OperationMeta, params: CallParams): Promise<unknown> {
    const token = await this._resolveToken();
    return fetcher({
      method: meta.method,
      path: meta.path,
      pathParams: params.pathParams,
      queryParams: params.queryParams,
      body: params.body,
      baseUrl: this._baseUrl,
      token,
      fetchImpl: this._fetchImpl,
      onResponse: this._onResponse,
      retry: this._retry,
    });
  }

  private _call(meta: OperationMeta) {
    return (params: CallParams = {}) => this._send(meta, params);
  }

  /** Access API operations via tag-based namespaces or `.request()`. */
  get api(): TApi {
    if (this._api) return this._api;

    // Async so an unknown route rejects rather than throwing synchronously,
    // which is what callers awaiting .request() expect.
    const request = async (route: string, params: CallParams = {}) => {
      const meta = this._operations.byPath[route];
      if (!meta) throw new Error(`Unknown route: ${route}`);
      return this._send(meta, params);
    };

    this._api = new Proxy({} as TApi, {
      get: (_, prop: string) => {
        if (prop === "request") return request;

        const tagOps = this._operations.byTag[prop];
        if (!tagOps) return undefined;

        return new Proxy(
          {},
          {
            get: (_, method: string) => {
              const opMeta = tagOps[method];
              if (!opMeta) return undefined;
              return this._call(opMeta);
            },
          },
        );
      },
    }) as TApi;

    return this._api;
  }
}
