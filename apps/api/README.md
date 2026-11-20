# Offboard API

From the repository root, run `npm install` and `npm run dev` to start
TanStack Start and the Elysia API together. To start only the API, run
`npm run dev -w @offboard/api`.

The health endpoint is available at
`http://127.0.0.1:3001/api/health`. It returns `{"status":"ok"}`.

| Environment variable | Default                 |
| -------------------- | ----------------------- |
| `API_HOST`           | `127.0.0.1`             |
| `API_PORT`           | `3001`                  |
| `WEB_ORIGIN`         | `http://localhost:5173` |

Set `WEB_ORIGIN` to the web app's origin when it differs from the default.
For a production build, run `npm run build -w @offboard/api` followed by
`npm run start -w @offboard/api`.

## Local PostgreSQL

From the repository root, start the local database with `docker compose up -d postgres`.
The development connection URL is `postgresql://offboard:offboard@127.0.0.1:5432/offboard`.
The API currently exposes its HTTP health endpoint independently of the database.

## Shared Eden client

The web workspace declares `@offboard/api-client` for future API calls.
The current screens use local fixtures. Pass the API origin to the client factory.
Pass the origin without the `/api` prefix, which Eden infers from the routes.

```ts
import { createApiClient } from "@offboard/api-client";

const client = createApiClient("http://127.0.0.1:3001");
const { data, error } = await client.api.health.get();
```

The shared package consumes the Elysia contract through a type-only export.
The listener runs through the API workspace's server entry point. Keep Elysia
versions aligned across the API and client as described in the
[Eden installation guide](https://elysiajs.com/eden/installation).
