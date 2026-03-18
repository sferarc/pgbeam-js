import { describe, expect, it } from "vitest";
import { operationsByPath, operationsByTag } from "./operations";

// ---------------------------------------------------------------------------
// operationsByTag
// ---------------------------------------------------------------------------
describe("operationsByTag", () => {
  it("exports an object with known tag keys", () => {
    expect(operationsByTag).toBeDefined();
    expect(typeof operationsByTag).toBe("object");
  });

  it("contains the expected top-level tags", () => {
    const tags = Object.keys(operationsByTag);
    expect(tags).toContain("account");
    expect(tags).toContain("analytics");
    expect(tags).toContain("projects");
    expect(tags).toContain("databases");
    expect(tags).toContain("platform");
  });

  it("each tag maps to an object of operations", () => {
    for (const [_tag, ops] of Object.entries(operationsByTag)) {
      expect(typeof ops).toBe("object");
      expect(Object.keys(ops).length).toBeGreaterThan(0);
    }
  });

  it("each operation has method and path properties", () => {
    for (const [, ops] of Object.entries(operationsByTag)) {
      for (const [, op] of Object.entries(ops)) {
        expect(op).toHaveProperty("method");
        expect(op).toHaveProperty("path");
        expect(typeof op.method).toBe("string");
        expect(typeof op.path).toBe("string");
      }
    }
  });

  it("operation methods are valid HTTP methods", () => {
    const validMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
    for (const [, ops] of Object.entries(operationsByTag)) {
      for (const [, op] of Object.entries(ops)) {
        expect(validMethods).toContain(op.method);
      }
    }
  });

  it("operation paths start with /v1/", () => {
    for (const [, ops] of Object.entries(operationsByTag)) {
      for (const [, op] of Object.entries(ops)) {
        expect(op.path).toMatch(/^\/v1\//);
      }
    }
  });

  // Spot-check specific operations
  it("projects tag contains getProject operation", () => {
    expect(operationsByTag.projects.getProject).toEqual({
      method: "GET",
      path: "/v1/projects/{project_id}",
    });
  });

  it("platform tag contains getHealth operation", () => {
    expect(operationsByTag.platform.getHealth).toEqual({
      method: "GET",
      path: "/v1/health",
    });
  });

  it("databases tag contains listDatabases operation", () => {
    expect(operationsByTag.databases.listDatabases).toEqual({
      method: "GET",
      path: "/v1/projects/{project_id}/databases",
    });
  });
});

// ---------------------------------------------------------------------------
// operationsByPath
// ---------------------------------------------------------------------------
describe("operationsByPath", () => {
  it("exports an object with route string keys", () => {
    expect(operationsByPath).toBeDefined();
    expect(typeof operationsByPath).toBe("object");
  });

  it("has entries that match 'METHOD /path' format", () => {
    for (const key of Object.keys(operationsByPath)) {
      expect(key).toMatch(/^(GET|POST|PUT|PATCH|DELETE) \/v1\//);
    }
  });

  it("each entry has method, path, and operationId properties", () => {
    for (const [, entry] of Object.entries(operationsByPath)) {
      expect(entry).toHaveProperty("method");
      expect(entry).toHaveProperty("path");
      expect(entry).toHaveProperty("operationId");
      expect(typeof entry.method).toBe("string");
      expect(typeof entry.path).toBe("string");
      expect(typeof entry.operationId).toBe("string");
    }
  });

  it("route key matches the method and path of its entry", () => {
    for (const [route, entry] of Object.entries(operationsByPath)) {
      expect(route).toBe(`${entry.method} ${entry.path}`);
    }
  });

  // Spot-check specific routes
  it("contains the GET /v1/health route", () => {
    const route = operationsByPath["GET /v1/health"];
    expect(route).toBeDefined();
    expect(route.method).toBe("GET");
    expect(route.path).toBe("/v1/health");
    expect(route.operationId).toBe("getHealth");
  });

  it("contains the GET /v1/projects route", () => {
    const route = operationsByPath["GET /v1/projects"];
    expect(route).toBeDefined();
    expect(route.operationId).toBe("listProjects");
  });

  it("contains the POST /v1/projects route", () => {
    const route = operationsByPath["POST /v1/projects"];
    expect(route).toBeDefined();
    expect(route.operationId).toBe("createProject");
  });

  it("contains the DELETE /v1/projects/{project_id} route", () => {
    const route = operationsByPath["DELETE /v1/projects/{project_id}"];
    expect(route).toBeDefined();
    expect(route.operationId).toBe("deleteProject");
  });
});

// ---------------------------------------------------------------------------
// Cross-check: tag ops and path ops are consistent
// ---------------------------------------------------------------------------
describe("tag-path consistency", () => {
  it("every tag operation has a matching entry in operationsByPath", () => {
    for (const [, ops] of Object.entries(operationsByTag)) {
      for (const [opName, op] of Object.entries(ops)) {
        const routeKey = `${op.method} ${op.path}`;
        const pathEntry = operationsByPath[routeKey as keyof typeof operationsByPath];
        expect(pathEntry).toBeDefined();
        expect(pathEntry.operationId).toBe(opName);
      }
    }
  });
});
