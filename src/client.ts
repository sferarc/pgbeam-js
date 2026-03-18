import {
  type ApiOperations,
  operationsByPath,
  operationsByTag,
  type RequestMap,
  type Route,
} from "./generated/operations-map.gen";
import {
  type FetcherOptions,
  fetcher,
  type OnResponseHook,
  type RetryConfig,
} from "./utils/fetcher";

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
}

/** Type-safe client with tag-based proxy access and .request() method. */
export type ApiClient = ApiOperations & {
  /**
   * Type-safe request by route string.
   *
   * @example
   * const projects = await api.request('GET /v1/projects', { queryParams: { org_id } });
   * const project = await api.request('GET /v1/projects/{project_id}', { pathParams: { project_id } });
   */
  request: <K extends Route>(
    route: K,
    ...args: RequestMap[K]["params"] extends undefined
      ? [params?: undefined]
      : [params: RequestMap[K]["params"]]
  ) => Promise<RequestMap[K]["response"]>;
};

export class PgBeamClient {
  private _baseUrl: string;
  private _tokenOrFn: string | null | (() => Promise<string | null>);
  private _fetchImpl?: typeof globalThis.fetch;
  private _onResponse?: OnResponseHook;
  private _retry?: RetryConfig;
  private _api?: ApiClient;

  constructor(options: PgBeamClientOptions) {
    this._baseUrl = options.baseUrl;
    this._tokenOrFn = options.token;
    this._fetchImpl = options.fetch;
    this._onResponse = options.onResponse;
    this._retry =
      options.retry === false ? { maxRetries: 0 } : (options.retry ?? { maxRetries: 5 });
  }

  private async _resolveToken(): Promise<string | null> {
    if (typeof this._tokenOrFn === "function") {
      return this._tokenOrFn();
    }
    return this._tokenOrFn;
  }

  private _call(method: string, path: string) {
    return async (params: Record<string, unknown> = {}) => {
      const token = await this._resolveToken();
      return fetcher({
        method,
        path,
        pathParams: params.pathParams as FetcherOptions["pathParams"],
        queryParams: params.queryParams as FetcherOptions["queryParams"],
        body: params.body,
        baseUrl: this._baseUrl,
        token,
        fetchImpl: this._fetchImpl,
        onResponse: this._onResponse,
        retry: this._retry,
      });
    };
  }

  /** Access API operations via tag-based namespaces or `.request()`. */
  get api(): ApiClient {
    if (this._api) return this._api;

    const request = async <K extends Route>(
      route: K,
      params?: RequestMap[K]["params"],
    ): Promise<RequestMap[K]["response"]> => {
      const meta = operationsByPath[route as keyof typeof operationsByPath];
      if (!meta) throw new Error(`Unknown route: ${String(route)}`);
      const token = await this._resolveToken();
      return fetcher({
        method: meta.method,
        path: meta.path,
        pathParams: (params as Record<string, unknown> | undefined)
          ?.pathParams as FetcherOptions["pathParams"],
        queryParams: (params as Record<string, unknown> | undefined)
          ?.queryParams as FetcherOptions["queryParams"],
        body: (params as Record<string, unknown> | undefined)?.body,
        baseUrl: this._baseUrl,
        token,
        fetchImpl: this._fetchImpl,
        onResponse: this._onResponse,
        retry: this._retry,
      });
    };

    this._api = new Proxy({} as ApiClient, {
      get: (_, prop: string) => {
        if (prop === "request") return request;

        const tagOps = operationsByTag[prop as keyof typeof operationsByTag];
        if (!tagOps) return undefined;

        return new Proxy(
          {},
          {
            get: (_, method: string) => {
              const ops = tagOps as Record<string, { method: string; path: string }>;
              const opMeta = ops[method];
              if (!opMeta) return undefined;
              return this._call(opMeta.method, opMeta.path);
            },
          },
        );
      },
    }) as ApiClient;

    return this._api;
  }
}
