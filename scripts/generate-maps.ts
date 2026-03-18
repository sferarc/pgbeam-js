/**
 * Reads the OpenAPI spec and generates:
 * - operationsByTag / operationsByPath runtime maps
 * - ApiOperations type interface (for tag-based proxy)
 * - RequestMap type interface (for .request() access)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const specPath = resolve(__dirname, "../../../../backend/openapi/bundles/public.yaml");
const outPath = resolve(__dirname, "../src/generated/operations-map.gen.ts");

interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: { type?: string; default?: unknown };
}

interface Operation {
  operationId: string;
  tags?: string[];
  parameters?: (Parameter | { $ref: string })[];
  requestBody?: unknown;
  responses?: Record<string, unknown>;
}

interface PathItem {
  parameters?: (Parameter | { $ref: string })[];
  get?: Operation;
  post?: Operation;
  put?: Operation;
  patch?: Operation;
  delete?: Operation;
}

function pascalCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function camelCase(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

interface OpInfo {
  operationId: string;
  method: string;
  path: string;
  tag: string;
  hasPathParams: boolean;
  hasQueryParams: boolean;
  hasRequiredQueryParams: boolean;
  hasBody: boolean;
  is204: boolean;
  pascalId: string;
  suffix: string; // 'Query' or 'Mutation'
}

function collectOperations(spec: {
  paths: Record<string, PathItem>;
  components?: { parameters?: Record<string, Parameter> };
}): OpInfo[] {
  const ops: OpInfo[] = [];
  const compParams = spec.components?.parameters ?? {};

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    const pathLevelParams = (pathItem.parameters ?? []).map((p) => {
      if ("$ref" in p) {
        const refName = p.$ref.split("/").pop();
        if (!refName || !compParams[refName]) {
          throw new Error(`Reference ${p.$ref} not found in components.parameters`);
        }

        return compParams[refName];
      }

      return p;
    });

    for (const method of ["get", "post", "put", "patch", "delete"] as const) {
      const op = pathItem[method];
      if (!op?.operationId) continue;

      const allParams = [
        ...pathLevelParams,
        ...(op.parameters ?? []).map((p) => {
          if ("$ref" in p) {
            const refName = p.$ref.split("/").pop();
            if (!refName || !compParams[refName]) {
              throw new Error(`Reference ${p.$ref} not found in components.parameters`);
            }

            return compParams[refName];
          }

          return p;
        }),
      ];

      const hasPathParams = allParams.some((p) => p?.in === "path");
      const queryParams = allParams.filter((p) => p?.in === "query");
      const hasQueryParams = queryParams.length > 0;
      const hasRequiredQueryParams = queryParams.some((p) => p?.required);
      const hasBody = !!op.requestBody;
      const responses = op.responses ?? {};
      const is204 = "204" in responses && !("200" in responses) && !("201" in responses);
      const tag = camelCase(op.tags?.[0] ?? "default");
      const suffix = method === "get" ? "Query" : "Mutation";

      ops.push({
        operationId: op.operationId,
        method: method.toUpperCase(),
        path,
        tag,
        hasPathParams,
        hasQueryParams,
        hasRequiredQueryParams,
        hasBody,
        is204,
        pascalId: pascalCase(op.operationId),
        suffix,
      });
    }
  }

  return ops;
}

function buildImports(ops: OpInfo[]): string {
  const imports: string[] = [];

  for (const op of ops) {
    const types: string[] = [];
    if (op.hasPathParams) types.push(`${op.pascalId}PathParams`);
    if (op.hasQueryParams) types.push(`${op.pascalId}QueryParams`);
    if (op.hasBody) types.push(`${op.pascalId}MutationRequest`);
    if (!op.is204) {
      if (op.suffix === "Query") {
        types.push(`${op.pascalId}QueryResponse`);
      } else {
        types.push(`${op.pascalId}MutationResponse`);
      }
    }
    if (types.length > 0) {
      imports.push(`import type { ${types.join(", ")} } from "./types/${op.pascalId}";`);
    }
  }

  return imports.join("\n");
}

function buildOperationsByTag(ops: OpInfo[]): string {
  const byTag = new Map<string, OpInfo[]>();
  for (const op of ops) {
    if (!byTag.has(op.tag)) byTag.set(op.tag, []);
    byTag.get(op.tag)?.push(op);
  }

  const entries: string[] = [];
  for (const [tag, tagOps] of byTag) {
    const opEntries = tagOps.map(
      (op) => `    ${op.operationId}: { method: "${op.method}", path: "${op.path}" }`,
    );
    entries.push(`  ${tag}: {\n${opEntries.join(",\n")},\n  }`);
  }

  return `export const operationsByTag = {\n${entries.join(",\n")},\n} as const;`;
}

function buildOperationsByPath(ops: OpInfo[]): string {
  const entries = ops.map(
    (op) =>
      `  "${op.method} ${op.path}": { method: "${op.method}", path: "${op.path}", operationId: "${op.operationId}" }`,
  );
  return `export const operationsByPath = {\n${entries.join(",\n")},\n} as const;`;
}

function buildParamsType(op: OpInfo): string {
  const parts: string[] = [];
  if (op.hasPathParams) parts.push(`pathParams: ${op.pascalId}PathParams`);
  if (op.hasQueryParams) {
    const opt = op.hasRequiredQueryParams ? "" : "?";
    parts.push(`queryParams${opt}: ${op.pascalId}QueryParams`);
  }
  if (op.hasBody) parts.push(`body: ${op.pascalId}MutationRequest`);
  if (parts.length === 0) return "void";
  return `{ ${parts.join("; ")} }`;
}

function buildResponseType(op: OpInfo): string {
  if (op.is204) return "void";
  return op.suffix === "Query" ? `${op.pascalId}QueryResponse` : `${op.pascalId}MutationResponse`;
}

function buildApiOperations(ops: OpInfo[]): string {
  const byTag = new Map<string, OpInfo[]>();
  for (const op of ops) {
    if (!byTag.has(op.tag)) byTag.set(op.tag, []);
    byTag.get(op.tag)?.push(op);
  }

  const tagEntries: string[] = [];
  for (const [tag, tagOps] of byTag) {
    const methodEntries = tagOps.map((op) => {
      const params = buildParamsType(op);
      const response = buildResponseType(op);
      const paramArg = params === "void" ? "" : `params: ${params}`;
      return `    ${op.operationId}(${paramArg}): Promise<${response}>;`;
    });
    tagEntries.push(`  ${tag}: {\n${methodEntries.join("\n")}\n  };`);
  }

  return `export interface ApiOperations {\n${tagEntries.join("\n")}\n}`;
}

function buildRequestMap(ops: OpInfo[]): string {
  const entries = ops.map((op) => {
    const params = buildParamsType(op);
    const response = buildResponseType(op);
    const paramsField = params === "void" ? "params?: undefined" : `params: ${params}`;
    return `  "${op.method} ${op.path}": { ${paramsField}; response: ${response} };`;
  });
  return `export interface RequestMap {\n${entries.join("\n")}\n}`;
}

// Main
const specContent = readFileSync(specPath, "utf-8");
const spec = yaml.load(specContent) as {
  paths: Record<string, PathItem>;
  components?: { parameters?: Record<string, Parameter> };
};

const ops = collectOperations(spec);

const output = `/**
 * Generated by scripts/generate-maps.ts — do not edit manually.
 * Run: pnpm --filter pgbeam generate
 */

${buildImports(ops)}

${buildOperationsByTag(ops)}

${buildOperationsByPath(ops)}

${buildApiOperations(ops)}

${buildRequestMap(ops)}

export type ApiTag = keyof ApiOperations;
export type Route = keyof RequestMap;
`;

writeFileSync(outPath, output, "utf-8");
console.log(`Generated ${outPath}`);
