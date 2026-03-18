import { describe, expect, it } from "vitest";
import type { PgBeamClientOptions } from "./index";
import { ApiError, extractMessage, PgBeamClient } from "./index";

describe("SDK index re-exports", () => {
  it("exports PgBeamClient class", () => {
    expect(PgBeamClient).toBeDefined();
    expect(typeof PgBeamClient).toBe("function");
  });

  it("exports ApiError class", () => {
    expect(ApiError).toBeDefined();
    expect(typeof ApiError).toBe("function");
  });

  it("exports extractMessage function", () => {
    expect(extractMessage).toBeDefined();
    expect(typeof extractMessage).toBe("function");
  });

  it("PgBeamClient can be instantiated", () => {
    const client = new PgBeamClient({
      token: "test-token",
      baseUrl: "https://api.example.com",
    });
    expect(client).toBeInstanceOf(PgBeamClient);
  });

  it("ApiError can be instantiated and has expected properties", () => {
    const error = new ApiError(404, "Not Found", { message: "not found" });
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(404);
    expect(error.statusText).toBe("Not Found");
    expect(error.body).toEqual({ message: "not found" });
  });

  it("extractMessage extracts message from error body", () => {
    const error = new ApiError(400, "Bad Request", {
      message: "invalid input",
    });
    const msg = extractMessage(error);
    expect(msg).toBe("invalid input");
  });

  it("extractMessage handles error without body", () => {
    const error = new ApiError(500, "Internal Server Error", undefined);
    const msg = extractMessage(error);
    expect(typeof msg).toBe("string");
  });

  it("type exports are importable (compile-time check)", () => {
    // These are type-only exports — this test verifies the module
    // can be imported without errors at runtime.
    const opts: PgBeamClientOptions = {
      token: "tok",
      baseUrl: "https://api.example.com",
    };
    expect(opts.token).toBe("tok");
  });
});
