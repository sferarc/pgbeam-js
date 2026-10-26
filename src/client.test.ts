import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { PgBeamClient } from "./client";
import { ApiError, isNotModified, NetworkError } from "./utils/fetcher";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function emptyResponse(status = 204): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "No Content",
    headers: new Headers(),
    json: () => Promise.reject(new Error("no body")),
    text: () => Promise.resolve(""),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// PgBeamClient construction
// ---------------------------------------------------------------------------
describe("PgBeamClient", () => {
  // The client always calls fetch with a string URL and a plain headers object.
  let mockFetch: Mock<
    (url: string, init: RequestInit & { headers: Record<string, string> }) => Promise<Response>
  > &
    typeof fetch;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true })) as typeof mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a client with required options", () => {
    const client = new PgBeamClient({
      token: "tok-123",
      baseUrl: "https://api.example.com",
    });

    expect(client).toBeInstanceOf(PgBeamClient);
    expect(client.api).toBeDefined();
  });

  it("creates a client with null token", () => {
    const client = new PgBeamClient({
      token: null,
      baseUrl: "https://api.example.com",
    });

    expect(client).toBeInstanceOf(PgBeamClient);
  });

  it("creates a client with an async token function", () => {
    const client = new PgBeamClient({
      token: async () => "dynamic-token",
      baseUrl: "https://api.example.com",
    });

    expect(client).toBeInstanceOf(PgBeamClient);
  });

  // ---------------------------------------------------------------------------
  // api proxy — tag-based access
  // ---------------------------------------------------------------------------
  describe("api proxy (tag-based access)", () => {
    it("returns the same api object on repeated access (caching)", () => {
      const client = new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      const api1 = client.api;
      const api2 = client.api;
      expect(api1).toBe(api2);
    });

    it("returns a namespace proxy for a known tag", () => {
      const client = new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      const projects = client.api.projects;
      expect(projects).toBeDefined();
    });

    it("returns undefined for an unknown tag", () => {
      const client = new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      // Access an unknown tag — should be undefined
      const unknown = (client.api as unknown as Record<string, unknown>).nonExistentTag;
      expect(unknown).toBeUndefined();
    });

    it("returns a callable function for a known operation in a tag", () => {
      const client = new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      const getHealth = client.api.platform.getHealth;
      expect(typeof getHealth).toBe("function");
    });

    it("returns undefined for an unknown operation within a tag", () => {
      const client = new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      const unknown = (client.api.platform as Record<string, unknown>).nonExistentMethod;
      expect(unknown).toBeUndefined();
    });

    it("calls fetch with the correct method and path for a tag operation", async () => {
      const client = new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      await client.api.platform.getHealth();

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.example.com/v1/health");
      expect(init.method).toBe("GET");
      expect(init.headers.Authorization).toBe("Bearer tok");
    });

    it("passes pathParams correctly via a tag operation", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ id: "proj-1", name: "Test" }));
      const client = new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      await client.api.projects.getProject({
        pathParams: { project_id: "proj-1" },
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.example.com/v1/projects/proj-1");
    });

    it("passes queryParams correctly via a tag operation", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ items: [] }));
      const client = new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      await client.api.projects.listProjects({
        queryParams: { org_id: "org-1" },
      });

      const [url] = mockFetch.mock.calls[0];
      const parsed = new URL(url);
      expect(parsed.searchParams.get("org_id")).toBe("org-1");
    });

    it("passes body correctly via a tag operation", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ id: "proj-new" }, 201));
      const client = new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      const body = {
        name: "New Project",
        org_id: "org-1",
        database: { host: "db.example.com", port: 5432, name: "app", username: "u", password: "p" },
      };
      await client.api.projects.createProject({ body });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify(body));
      expect(init.headers["Content-Type"]).toBe("application/json");
    });
  });

  // ---------------------------------------------------------------------------
  // api.request() — route-based access
  // ---------------------------------------------------------------------------
  describe("api.request()", () => {
    it("is a function on the api proxy", () => {
      const client = new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      expect(typeof client.api.request).toBe("function");
    });

    it("calls fetch with correct method and path for a known route", async () => {
      const client = new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      await client.api.request("GET /v1/health");

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.example.com/v1/health");
      expect(init.method).toBe("GET");
    });

    it("throws for an unknown route", async () => {
      const client = new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      await expect(
        // Cast to bypass type checking for the test
        client.api.request("GET /v1/unknown" as never),
      ).rejects.toThrow("Unknown route: GET /v1/unknown");
    });

    it("substitutes path parameters in request()", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ id: "proj-1" }));
      const client = new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      await client.api.request("GET /v1/projects/{project_id}", {
        pathParams: { project_id: "proj-1" },
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.example.com/v1/projects/proj-1");
    });

    it("passes body in request()", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ id: "proj-new" }, 201));
      const client = new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      const body = {
        name: "P1",
        org_id: "org-1",
        database: { host: "db.example.com", port: 5432, name: "app", username: "u", password: "p" },
      };
      await client.api.request("POST /v1/projects", { body });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.body).toBe(JSON.stringify(body));
    });
  });

  // ---------------------------------------------------------------------------
  // Token resolution
  // ---------------------------------------------------------------------------
  describe("token resolution", () => {
    it("resolves a static string token", async () => {
      const client = new PgBeamClient({
        token: "static-token",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      await client.api.platform.getHealth();

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers.Authorization).toBe("Bearer static-token");
    });

    it("resolves an async token function", async () => {
      const tokenFn = vi.fn(async () => "async-token");
      const client = new PgBeamClient({
        token: tokenFn,
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      await client.api.platform.getHealth();

      expect(tokenFn).toHaveBeenCalledOnce();
      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers.Authorization).toBe("Bearer async-token");
    });

    it("calls the token function on every request", async () => {
      let callCount = 0;
      const tokenFn = async () => `token-${++callCount}`;
      const client = new PgBeamClient({
        token: tokenFn,
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      await client.api.platform.getHealth();
      await client.api.platform.getHealth();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [, init1] = mockFetch.mock.calls[0];
      const [, init2] = mockFetch.mock.calls[1];
      expect(init1.headers.Authorization).toBe("Bearer token-1");
      expect(init2.headers.Authorization).toBe("Bearer token-2");
    });

    it("omits auth header when token resolves to null", async () => {
      const client = new PgBeamClient({
        token: null,
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      await client.api.platform.getHealth();

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers).not.toHaveProperty("Authorization");
    });

    it("omits auth header when async token function returns null", async () => {
      const client = new PgBeamClient({
        token: async () => null,
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      await client.api.platform.getHealth();

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers).not.toHaveProperty("Authorization");
    });

    it("bounds a token function that never settles by the per-request timeout", async () => {
      // A lazy token is a network call of its own: the dashboard's resolves a
      // JWT from the auth endpoint, and the admin app's does the same. An
      // endpoint that accepts that request and never answers used to leave the
      // whole call outstanding with nothing to stop it, because `timeoutMs`,
      // the retry budget and the `NetworkError.timedOut` signal callers branch
      // on all live past this await. Without the bound this test does not fail,
      // it hangs.
      vi.useFakeTimers();
      try {
        const client = new PgBeamClient({
          token: () => new Promise<string | null>(() => {}),
          baseUrl: "https://api.example.com",
          fetch: mockFetch,
          timeoutMs: 3_000,
        });

        const began = Date.now();
        const settled = client.api.platform.getHealth().then(
          () => ({ ok: true }) as const,
          (error: unknown) => ({ ok: false, error, elapsedMs: Date.now() - began }) as const,
        );
        await vi.advanceTimersByTimeAsync(600_000);
        const result = await settled;

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toBeInstanceOf(NetworkError);
        expect((result.error as NetworkError).timedOut).toBe(true);
        expect(result.elapsedMs).toBe(3_000);
        expect(mockFetch).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Custom fetch and onResponse
  // ---------------------------------------------------------------------------
  describe("custom fetch and onResponse", () => {
    it("uses the custom fetch implementation", async () => {
      const customFetch = vi.fn().mockResolvedValue(jsonResponse({ custom: true }));
      const client = new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: customFetch,
      });

      await client.api.platform.getHealth();

      expect(customFetch).toHaveBeenCalledOnce();
    });

    it("calls onResponse hook", async () => {
      const onResponse = vi.fn();
      const client = new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
        onResponse,
      });

      await client.api.platform.getHealth();

      expect(onResponse).toHaveBeenCalledOnce();
    });

    it("passes onResponse to request() calls as well", async () => {
      const onResponse = vi.fn();
      const client = new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
        onResponse,
      });

      await client.api.request("GET /v1/health");

      expect(onResponse).toHaveBeenCalledOnce();
    });
  });

  // ---------------------------------------------------------------------------
  // Idempotency-Key under the client's default retry config
  // ---------------------------------------------------------------------------
  describe("Idempotency-Key", () => {
    function unavailable(): Response {
      return {
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        headers: new Headers({ "content-type": "application/json", "Retry-After": "0" }),
        json: () => Promise.resolve({}),
        text: () => Promise.resolve("{}"),
      } as unknown as Response;
    }

    it("omits the key on every scanText attempt", async () => {
      mockFetch
        .mockResolvedValueOnce(unavailable())
        .mockResolvedValueOnce(jsonResponse({ action: "allow" }));
      const client = new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      await client.api.platform.scanText({ body: { text: "hello" } });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      for (const [, init] of mockFetch.mock.calls) {
        expect(init.headers).not.toHaveProperty("Idempotency-Key");
      }
    });

    it("omits the key on scanText reached through request()", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ action: "allow" }));
      const client = new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      await client.api.request("POST /v1/scan/text", { body: { text: "hello" } });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers).not.toHaveProperty("Idempotency-Key");
    });

    it("reuses one key across retries of another POST", async () => {
      mockFetch
        .mockResolvedValueOnce(unavailable())
        .mockResolvedValueOnce(jsonResponse({ id: "proj-new" }, 201));
      const client = new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      await client.api.projects.createProject({
        body: {
          name: "New Project",
          org_id: "org-1",
          database: {
            host: "db.example.com",
            port: 5432,
            name: "app",
            username: "app",
            password: "pw",
          },
        },
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [[, first], [, second]] = mockFetch.mock.calls;
      expect(first.headers["Idempotency-Key"]).toBeTruthy();
      expect(second.headers["Idempotency-Key"]).toBe(first.headers["Idempotency-Key"]);
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE returns undefined
  // ---------------------------------------------------------------------------
  describe("204 No Content responses", () => {
    it("returns undefined for a DELETE that returns 204", async () => {
      mockFetch.mockResolvedValue(emptyResponse(204));
      const client = new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });

      const result = await client.api.projects.deleteProject({
        pathParams: { project_id: "proj-1" },
      });

      expect(result).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Conditional requests
  // ---------------------------------------------------------------------------
  describe("conditional requests", () => {
    const dbPath = { project_id: "prj_1", database_id: "db_1" };

    function client(retry?: { maxRetries: number; initialDelayMs?: number }) {
      return new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
        retry: retry ?? { maxRetries: 3, initialDelayMs: 1 },
      });
    }

    it("sends If-Match on a PATCH alongside the client's own headers", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ id: "db_1" }));

      await client().api.databases.updateDatabase({
        pathParams: dbPath,
        body: { name: "renamed" },
        headers: { "If-Match": '"v1"' },
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.method).toBe("PATCH");
      expect(init.headers["If-Match"]).toBe('"v1"');
      expect(init.headers.Authorization).toBe("Bearer tok");
      expect(init.headers["Content-Type"]).toBe("application/json");
      expect(init.headers["Idempotency-Key"]).toBeTruthy();
    });

    it("surfaces a 412 as an ApiError with the problem code, without retrying", async () => {
      mockFetch.mockResolvedValue(
        jsonResponse(
          {
            type: "https://pgbeam.com/errors/precondition-failed",
            title: "Precondition Failed",
            status: 412,
            code: "PRECONDITION_FAILED",
            detail: "The resource changed since it was read.",
          },
          412,
        ),
      );

      const err = await client()
        .api.databases.updateDatabase({
          pathParams: dbPath,
          body: { name: "renamed" },
          headers: { "If-Match": '"stale"' },
        })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(412);
      expect((err as ApiError).code).toBe("PRECONDITION_FAILED");
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("reports a 304 for If-None-Match as isNotModified and does not retry it", async () => {
      mockFetch.mockResolvedValue(emptyResponse(304));

      const err = await client()
        .api.databases.getDatabase({
          pathParams: dbPath,
          headers: { "If-None-Match": '"v1"' },
        })
        .catch((e: unknown) => e);

      expect(isNotModified(err)).toBe(true);
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch.mock.calls[0][1].headers["If-None-Match"]).toBe('"v1"');
      expect(isNotModified(new ApiError(404, "Not Found", null))).toBe(false);
    });

    it("hands the per-call hook the response after the client-level hook", async () => {
      const order: string[] = [];
      mockFetch.mockResolvedValue({
        ...jsonResponse({ id: "db_1" }),
        headers: new Headers({ "content-type": "application/json", ETag: '"v2"' }),
      } as Response);
      const c = new PgBeamClient({
        token: "tok",
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
        onResponse: () => {
          order.push("client");
        },
      });

      let etag: string | null = null;
      await c.api.databases.getDatabase({
        pathParams: dbPath,
        onResponse: (res) => {
          order.push("call");
          etag = res.headers.get("ETag");
        },
      });

      expect(order).toEqual(["client", "call"]);
      expect(etag).toBe('"v2"');
    });

    it("refuses a caller-supplied Authorization header instead of sending it", async () => {
      await expect(
        client().api.request("GET /v1/projects/{project_id}/databases/{database_id}", {
          pathParams: dbPath,
          headers: { authorization: "Bearer someone-else" } as never,
        }),
      ).rejects.toThrow(TypeError);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("uses a caller-supplied Idempotency-Key in place of the generated one", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({}, 503))
        .mockResolvedValueOnce(jsonResponse({ id: "db_1" }));

      await client().api.databases.updateDatabase({
        pathParams: dbPath,
        body: { name: "renamed" },
        headers: { "idempotency-key": "mine" } as never,
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      for (const [, init] of mockFetch.mock.calls) {
        expect(init.headers["idempotency-key"]).toBe("mine");
        expect(init.headers["Idempotency-Key"]).toBeUndefined();
      }
    });
  });
});
