---
name: verify-offboard
description: Verify Offboard's HR portal in a real browser. Use for end-to-end checks of dashboard filters, offboarding cases, CSV review, checklist templates, and equipment returns. Launches an isolated local session and captures evidence with Playwright.
---

# Verify Offboard

Start with the [feature map](features/README.md). Protected workflows require
an authenticated session and a seeded development database. Use the API's
[local setup](../../../apps/api/README.md) to start both listeners and sign
in with a member permitted to exercise the workflow.

## Launch an authenticated workflow

Use an existing loopback development server and an authenticated Playwright
storage-state file for that origin. Keep the state file outside the checkout.
It carries the session cookie. The checklist driver saves changes to the model,
so point it at a disposable development database and browser context.

```sh
verify_tools=$(mktemp -d /tmp/offboard-verify-tools.XXXXXX)
npm install --prefix "$verify_tools" --no-save --package-lock=false playwright@1.65.1
"$verify_tools/node_modules/.bin/playwright" install chromium
export OFFBOARD_PLAYWRIGHT_DIR="$verify_tools"
export OFFBOARD_VERIFY_URL=http://127.0.0.1:5173
export OFFBOARD_VERIFY_STORAGE_STATE=/absolute/path/outside/repo/storage-state.json

proof_root=$(mktemp -d /tmp/offboard-verification-proof.XXXXXX)
.agents/skills/verify-offboard/scripts/run.py "$proof_root/checklist" .agents/skills/verify-offboard/scripts/checklist.mjs
```

Obtain the storage state with Playwright's `--save-storage` option after signing
in. Use the same host name in the browser and `OFFBOARD_VERIFY_URL`. The runner
leaves an existing server running and writes the browser driver's evidence to
the named directory.

For public-flow checks, omit `OFFBOARD_VERIFY_URL` and use a driver that does not
require authentication. The runner starts isolated API and web listeners on
loopback, connects the web proxy to its API port, verifies health and CORS, and
checks that anonymous portal requests redirect to sign-in. The API still
requires the development environment from its README.

## Drive

Use the exact routes, labels, and end states in the [feature map](features/README.md). The checklist driver is executable and can be run with the launch command above. For another recipe, write a disposable `.mjs` driver outside the checkout and use the same runner.

```sh
"$verify_skill/scripts/run.py" "$proof_root/another-feature" /absolute/path/to/drive.mjs
```

Copy the Playwright loader and tracing setup from `scripts/checklist.mjs`. The runner supplies `OFFBOARD_VERIFY_URL` and `OFFBOARD_VERIFY_EVIDENCE`. Open a fresh browser context and use accessible names or existing data attributes. Use the normal routes, controls, and file picker. Keep actions in the run's local origins.

## Evidence

Write browser action logs, screenshots of the starting and resulting state, an ARIA snapshot, and a Playwright trace into the evidence directory. For a mutation, verify the observable result from a second view when the behavior supports one. Case creation persists through the API, so open the created case in a fresh authenticated tab. The checklist model layout is stored in the browser and action configs sync through the API. Verify the model in another tab of the same browser context, and confirm action changes with the authenticated API when applicable. To prove CSV preview creates no case, return to the list and search for the fixture you uploaded. A failed or unreachable entry point needs the attempted action and the concrete failure in `drive.log`.

The isolated runner writes `web.log`, `api.log`, `drive.log`, and `cleanup.json`. With an existing server it writes `drive.log` and the driver artifacts. Inspect the files after cleanup. Open the recorded trace with:

```sh
"$verify_tools/node_modules/.bin/playwright" show-trace "$proof_root/checklist/checklist-trace.zip"
```

## Cleanup

The runner closes its process groups on success, failure, and ordinary interruption. The bundled driver closes Chromium in a `finally` block. For isolated runs, check that `cleanup.json` reports an empty `listeners_remaining` object. Remove disposable drivers and the temporary npm prefix after the last run. Keep the evidence directory and the installed Chromium cache. Existing app instances and open browser tabs belong to the user.
