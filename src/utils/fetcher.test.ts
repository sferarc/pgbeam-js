import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, extractMessage, fetcher } from "./fetcher";

// ---------------------------------------------------------------------------
// ApiError
// ---------------------------------------------------------------------------
describe("ApiError", () => {
  it("sets message from body.error.message when present", () => {
    const body = { error: { code: "NOT_FOUND", message: "Project not found" } };
    const err = new ApiError(404, "Not Found", body);

    expect(err.message).toBe("Project not found");
    expect(err.name).toBe("ApiError");
    expect(err.status).toBe(404);
    expect(err.statusText).toBe("Not Found");
    expect(err.body).toBe(body);
  });

  it("falls back to body.message when body.error.message is missing", () => {
    const body = { message: "Something went wrong" };
    const err = new ApiError(500, "Internal Server Error", body);

    expect(err.message).toBe("Something went wrong");
  });

  it("falls back to statusText when body has no extractable message", () => {
    const body = { foo: "bar" };
    const err = new ApiError(400, "Bad Request", body);

    expect(err.message).toBe("Bad Request");
  });

  it("uses statusText when body is a string", () => {
    const err = new ApiError(403, "Forbidden", "raw string body");

    expect(err.message).toBe("Forbidden");
    expect(err.body).toBe("raw string body");
  });

  it("uses statusText when body is null", () => {
    const err = new ApiError(500, "Internal Server Error", null);

    expect(err.message).toBe("Internal Server Error");
    expect(err.body).toBeNull();
  });

  it("uses statusText when body is a number", () => {
    const err = new ApiError(500, "Internal Server Error", 42);

    expect(err.message).toBe("Internal Server Error");
    expect(err.body).toBe(42);
  });

  it("is an instance of Error", () => {
    const err = new ApiError(404, "Not Found", null);

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
  });
});

// ---------------------------------------------------------------------------
// extractMessage
// ---------------------------------------------------------------------------
describe("extractMessage", () => {
  it('returns message from { error: { message: "msg" } }', () => {
    expect(extractMessage({ error: { message: "msg" } })).toBe("msg");
  });

  it('returns message from { message: "msg" }', () => {
    expect(extractMessage({ message: "msg" })).toBe("msg");
  });

  it("prefers error.message over top-level message", () => {
    const body = { error: { message: "inner" }, message: "outer" };
    expect(extractMessage(body)).toBe("inner");
  });

  it("returns undefined for null", () => {
    expect(extractMessage(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(extractMessage(undefined)).toBeUndefined();
  });

  it("returns undefined for a number", () => {
    expect(extractMessage(42)).toBeUndefined();
  });

  it("returns undefined for a string", () => {
    expect(extractMessage("hello")).toBeUndefined();
  });

  it('returns undefined when error is not an object (e.g. { error: "not-obj" })', () => {
    expect(extractMessage({ error: "not-obj" })).toBeUndefined();
  });

  it("returns undefined when error is an object but message is not a string", () => {
    expect(extractMessage({ error: { message: 123 } })).toBeUndefined();
  });

  it("returns undefined for an empty object", () => {
    expect(extractMessage({})).toBeUndefined();
  });

  it("returns undefined when error is null inside the body", () => {
    expect(extractMessage({ error: null })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fetcher
// ---------------------------------------------------------------------------
describe("fetcher", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  function jsonResponse(
    body: unknown,
    init?: { status?: number; statusText?: string; headers?: Record<string, string> },
  ): Response {
    const status = init?.status ?? 200;
    const statusText = init?.statusText ?? "OK";
    const headers = new Headers(init?.headers ?? { "content-type": "application/json" });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText,
      headers,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response;
  }

  function textResponse(text: string, contentType = "text/plain", status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: "OK",
      headers: new Headers({ "content-type": contentType }),
      json: () => Promise.reject(new Error("not json")),
      text: () => Promise.resolve(text),
    } as unknown as Response;
  }

  function emptyResponse(status: number, statusText = "No Content"): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText,
      headers: new Headers(),
      json: () => Promise.reject(new Error("no body")),
      text: () => Promise.resolve(""),
    } as unknown as Response;
  }

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -- URL construction --

  it("builds the correct URL for a simple GET request", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: 1 }));

    await fetcher({
      method: "GET",
      path: "/v1/projects",
      baseUrl: "https://api.example.com",
      token: null,
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/projects");
  });

  it("substitutes path parameters", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: "p1" }));

    await fetcher({
      method: "GET",
      path: "/v1/projects/{projectId}/databases/{dbId}",
      pathParams: { projectId: "proj-123", dbId: "db-456" },
      baseUrl: "https://api.example.com",
      token: null,
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/projects/proj-123/databases/db-456");
  });

  it("encodes path parameter values", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}));

    await fetcher({
      method: "GET",
      path: "/v1/items/{name}",
      pathParams: { name: "hello world/foo" },
      baseUrl: "https://api.example.com",
      token: null,
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("hello%20world%2Ffoo");
  });

  it("appends query parameters and filters out null/undefined", async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));

    await fetcher({
      method: "GET",
      path: "/v1/items",
      queryParams: { page: 1, limit: 10, filter: null, sort: undefined, active: true },
      baseUrl: "https://api.example.com",
      token: null,
    });

    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("page")).toBe("1");
    expect(parsed.searchParams.get("limit")).toBe("10");
    expect(parsed.searchParams.get("active")).toBe("true");
    expect(parsed.searchParams.has("filter")).toBe(false);
    expect(parsed.searchParams.has("sort")).toBe(false);
  });

  // -- Auth headers --

  it("sets Authorization header when token is provided", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

    await fetcher({
      method: "GET",
      path: "/v1/me",
      baseUrl: "https://api.example.com",
      token: "my-secret-token",
    });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer my-secret-token");
  });

  it("does not set Authorization header when token is null", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

    await fetcher({
      method: "GET",
      path: "/v1/public",
      baseUrl: "https://api.example.com",
      token: null,
    });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("does not set Authorization header when token is an empty string", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

    await fetcher({
      method: "GET",
      path: "/v1/public",
      baseUrl: "https://api.example.com",
      token: "",
    });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  // -- POST with body --

  it("sets Content-Type and stringifies body on POST", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ id: "new-1" }, { status: 201, statusText: "Created" }),
    );

    const payload = { name: "My Project", region: "us-east-1" };
    await fetcher({
      method: "POST",
      path: "/v1/projects",
      body: payload,
      baseUrl: "https://api.example.com",
      token: "tok",
    });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify(payload));
  });

  it("does not set Content-Type or body when body is undefined", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}));

    await fetcher({
      method: "DELETE",
      path: "/v1/projects/{id}",
      pathParams: { id: "p1" },
      baseUrl: "https://api.example.com",
      token: "tok",
    });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers).not.toHaveProperty("Content-Type");
    expect(init.body).toBeUndefined();
  });

  // -- Error handling --

  it("throws ApiError on non-ok response", async () => {
    const errorBody = { error: { code: "NOT_FOUND", message: "Project not found" } };
    mockFetch.mockResolvedValue(jsonResponse(errorBody, { status: 404, statusText: "Not Found" }));

    await expect(
      fetcher({
        method: "GET",
        path: "/v1/projects/missing",
        baseUrl: "https://api.example.com",
        token: "tok",
      }),
    ).rejects.toThrow(ApiError);

    try {
      await fetcher({
        method: "GET",
        path: "/v1/projects/missing",
        baseUrl: "https://api.example.com",
        token: "tok",
      });
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(404);
      expect(apiErr.statusText).toBe("Not Found");
      expect(apiErr.message).toBe("Project not found");
      expect(apiErr.body).toEqual(errorBody);
    }
  });

  it("throws ApiError with null body when error response is not valid JSON", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      headers: new Headers(),
      json: () => Promise.reject(new Error("not json")),
      text: () => Promise.resolve("bad gateway"),
    } as unknown as Response);

    await expect(
      fetcher({
        method: "GET",
        path: "/v1/health",
        baseUrl: "https://api.example.com",
        token: null,
      }),
    ).rejects.toThrow(ApiError);

    try {
      await fetcher({
        method: "GET",
        path: "/v1/health",
        baseUrl: "https://api.example.com",
        token: null,
      });
    } catch (err) {
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(502);
      expect(apiErr.body).toBeNull();
    }
  });

  // -- 204 No Content --

  it("returns undefined for 204 responses", async () => {
    mockFetch.mockResolvedValue(emptyResponse(204, "No Content"));

    const result = await fetcher({
      method: "DELETE",
      path: "/v1/projects/{id}",
      pathParams: { id: "p1" },
      baseUrl: "https://api.example.com",
      token: "tok",
    });

    expect(result).toBeUndefined();
  });

  // -- Content-type parsing --

  it("parses JSON response when content-type is application/json", async () => {
    const data = { id: "p1", name: "My Project" };
    mockFetch.mockResolvedValue(jsonResponse(data));

    const result = await fetcher<{ id: string; name: string }>({
      method: "GET",
      path: "/v1/projects/p1",
      baseUrl: "https://api.example.com",
      token: "tok",
    });

    expect(result).toEqual(data);
  });

  it("parses JSON response when content-type includes charset", async () => {
    const data = { items: [1, 2, 3] };
    mockFetch.mockResolvedValue(
      jsonResponse(data, { headers: { "content-type": "application/json; charset=utf-8" } }),
    );

    const result = await fetcher<{ items: number[] }>({
      method: "GET",
      path: "/v1/items",
      baseUrl: "https://api.example.com",
      token: null,
    });

    expect(result).toEqual(data);
  });

  // -- Empty text response --

  it("returns undefined for empty text response", async () => {
    mockFetch.mockResolvedValue(textResponse(""));

    const result = await fetcher({
      method: "GET",
      path: "/v1/something",
      baseUrl: "https://api.example.com",
      token: null,
    });

    expect(result).toBeUndefined();
  });

  // -- Fallback text-to-JSON parsing --

  it("parses non-JSON content-type response as JSON if text is valid JSON", async () => {
    const data = { key: "value" };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/plain" }),
      json: () => Promise.reject(new Error("not called")),
      text: () => Promise.resolve(JSON.stringify(data)),
    } as unknown as Response);

    const result = await fetcher<{ key: string }>({
      method: "GET",
      path: "/v1/data",
      baseUrl: "https://api.example.com",
      token: null,
    });

    expect(result).toEqual(data);
  });

  it("returns the raw text for a non-JSON body (e.g. text/csv export)", async () => {
    const csv = "id,event\nlog_1,blocked\n";
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/csv" }),
      json: () => Promise.reject(new Error("not called")),
      text: () => Promise.resolve(csv),
    } as unknown as Response);

    const result = await fetcher<string>({
      method: "GET",
      path: "/v1/projects/prj_1/audit-logs/export",
      baseUrl: "https://api.example.com",
      token: null,
    });

    expect(result).toBe(csv);
  });

  // -- onResponse hook --

  it("calls onResponse hook with the response object", async () => {
    const response = jsonResponse({ ok: true });
    mockFetch.mockResolvedValue(response);
    const onResponse = vi.fn();

    await fetcher({
      method: "GET",
      path: "/v1/me",
      baseUrl: "https://api.example.com",
      token: null,
      onResponse,
    });

    expect(onResponse).toHaveBeenCalledOnce();
    expect(onResponse).toHaveBeenCalledWith(response);
  });

  it("awaits async onResponse hook before continuing", async () => {
    const callOrder: string[] = [];
    const response = jsonResponse({ ok: true });
    mockFetch.mockResolvedValue(response);

    const onResponse = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      callOrder.push("onResponse");
    });

    await fetcher({
      method: "GET",
      path: "/v1/me",
      baseUrl: "https://api.example.com",
      token: null,
      onResponse,
    });

    expect(onResponse).toHaveBeenCalledOnce();
    expect(callOrder).toContain("onResponse");
  });

  it("calls onResponse even when response is not ok (before throwing)", async () => {
    const errorResponse = jsonResponse(
      { error: { message: "fail" } },
      { status: 500, statusText: "Internal Server Error" },
    );
    mockFetch.mockResolvedValue(errorResponse);
    const onResponse = vi.fn();

    await expect(
      fetcher({
        method: "GET",
        path: "/v1/fail",
        baseUrl: "https://api.example.com",
        token: null,
        onResponse,
      }),
    ).rejects.toThrow(ApiError);

    expect(onResponse).toHaveBeenCalledOnce();
    expect(onResponse).toHaveBeenCalledWith(errorResponse);
  });

  // -- Custom fetchImpl --

  it("uses custom fetchImpl instead of global fetch", async () => {
    const customFetch = vi.fn().mockResolvedValue(jsonResponse({ custom: true }));

    const result = await fetcher<{ custom: boolean }>({
      method: "GET",
      path: "/v1/custom",
      baseUrl: "https://api.example.com",
      token: null,
      fetchImpl: customFetch,
    });

    expect(customFetch).toHaveBeenCalledOnce();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toEqual({ custom: true });
  });

  it("falls back to global fetch when fetchImpl is not provided", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ global: true }));

    await fetcher({
      method: "GET",
      path: "/v1/global",
      baseUrl: "https://api.example.com",
      token: null,
    });

    expect(mockFetch).toHaveBeenCalledOnce();
  });

  // -- Retry behavior --

  describe("retry", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("retries on network error and succeeds", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("fetch failed"))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const result = await fetcher<{ ok: boolean }>({
        method: "GET",
        path: "/v1/test",
        baseUrl: "https://api.example.com",
        token: null,
        retry: { maxRetries: 3, initialDelayMs: 10, maxDelayMs: 100 },
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ ok: true });
    });

    it("retries on 503 and succeeds", async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse(null, {
            status: 503,
            statusText: "Service Unavailable",
            headers: { "content-type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const result = await fetcher<{ ok: boolean }>({
        method: "GET",
        path: "/v1/test",
        baseUrl: "https://api.example.com",
        token: null,
        retry: { maxRetries: 3, initialDelayMs: 10, maxDelayMs: 100 },
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ ok: true });
    });

    it("respects Retry-After header on 429", async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse(null, {
            status: 429,
            statusText: "Too Many Requests",
            headers: { "content-type": "application/json", "Retry-After": "1" },
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const result = await fetcher<{ ok: boolean }>({
        method: "GET",
        path: "/v1/test",
        baseUrl: "https://api.example.com",
        token: null,
        retry: { maxRetries: 3, initialDelayMs: 10, maxDelayMs: 100 },
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ ok: true });
    });

    it("does not retry on 400 Bad Request", async () => {
      mockFetch.mockResolvedValue(
        jsonResponse(
          { error: { message: "bad input" } },
          { status: 400, statusText: "Bad Request" },
        ),
      );

      await expect(
        fetcher({
          method: "GET",
          path: "/v1/test",
          baseUrl: "https://api.example.com",
          token: null,
          retry: { maxRetries: 3, initialDelayMs: 10, maxDelayMs: 100 },
        }),
      ).rejects.toThrow(ApiError);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("does not retry when maxRetries is 0", async () => {
      mockFetch.mockResolvedValue(
        jsonResponse(null, { status: 503, statusText: "Service Unavailable" }),
      );

      await expect(
        fetcher({
          method: "GET",
          path: "/v1/test",
          baseUrl: "https://api.example.com",
          token: null,
          retry: { maxRetries: 0 },
        }),
      ).rejects.toThrow(ApiError);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("sends Idempotency-Key header on POST retry", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("fetch failed"))
        .mockResolvedValueOnce(
          jsonResponse({ id: "new-1" }, { status: 201, statusText: "Created" }),
        );

      await fetcher({
        method: "POST",
        path: "/v1/projects",
        body: { name: "test" },
        baseUrl: "https://api.example.com",
        token: "tok",
        retry: { maxRetries: 3, initialDelayMs: 10, maxDelayMs: 100 },
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);

      // First attempt: also has Idempotency-Key (needed to dedupe if server commits but client loses response)
      const [, firstInit] = mockFetch.mock.calls[0];
      expect(firstInit.headers).toHaveProperty("Idempotency-Key");

      // Second attempt (retry): same Idempotency-Key
      const [, secondInit] = mockFetch.mock.calls[1];
      expect(secondInit.headers).toHaveProperty("Idempotency-Key");
      expect(secondInit.headers["Idempotency-Key"]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );

      // Same key on both attempts
      expect(firstInit.headers["Idempotency-Key"]).toBe(secondInit.headers["Idempotency-Key"]);
    });

    it("does not send Idempotency-Key header on GET retry", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("fetch failed"))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      await fetcher({
        method: "GET",
        path: "/v1/projects",
        baseUrl: "https://api.example.com",
        token: "tok",
        retry: { maxRetries: 3, initialDelayMs: 10, maxDelayMs: 100 },
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [, secondInit] = mockFetch.mock.calls[1];
      expect(secondInit.headers).not.toHaveProperty("Idempotency-Key");
    });

    it("does not retry without retry config", async () => {
      mockFetch.mockResolvedValue(
        jsonResponse(null, { status: 503, statusText: "Service Unavailable" }),
      );

      await expect(
        fetcher({
          method: "GET",
          path: "/v1/test",
          baseUrl: "https://api.example.com",
          token: null,
        }),
      ).rejects.toThrow(ApiError);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("throws after exhausting all retries", async () => {
      mockFetch.mockRejectedValue(new Error("fetch failed"));

      await expect(
        fetcher({
          method: "GET",
          path: "/v1/test",
          baseUrl: "https://api.example.com",
          token: null,
          retry: { maxRetries: 2, initialDelayMs: 10, maxDelayMs: 100 },
        }),
      ).rejects.toThrow("fetch failed");

      // 1 initial + 2 retries = 3 total
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });
});
