# pgbeam

TypeScript SDK for the [PgBeam](https://pgbeam.com) API — globally distributed PostgreSQL proxy platform with connection pooling and query caching.

## Install

```bash
npm install pgbeam
```

## Usage

```ts
import { PgBeamClient } from "pgbeam";

const client = new PgBeamClient({
  token: "your-api-token",
  baseUrl: "https://api.pgbeam.com",
});

// Tag-based access
const projects = await client.api.projects.listProjects({
  queryParams: { org_id: "org_123" },
});

// Route-based access
const project = await client.api.request("GET /v1/projects/{project_id}", {
  pathParams: { project_id: "proj_123" },
});
```

## Error handling

```ts
import { PgBeamClient, ApiError } from "pgbeam";

try {
  await client.api.projects.getProject({
    pathParams: { project_id: "proj_123" },
  });
} catch (err) {
  if (err instanceof ApiError) {
    console.error(err.status, err.message);
  }
}
```

## Operations map

The `pgbeam/operations` export provides route and tag metadata for building tooling on top of the SDK:

```ts
import { operationsByTag, operationsByPath } from "pgbeam/operations";
```

## Documentation

Full API reference at [pgbeam.com/docs/ts-sdk](https://pgbeam.com/docs/ts-sdk).

## Contributing

Issues and pull requests are welcome here. An issue is the right place to start for a bug, a wrong doc, or a missing capability; say what you ran, what happened, what you expected, and which version you were on.

To build and test it locally:

```bash
npm install
npm run build
npm test
```

Do not open a public issue for a suspected security vulnerability. Email security@pgbeam.com, or report it privately from this repository's Security tab.

## License

Apache 2.0 — see [LICENSE](LICENSE).
