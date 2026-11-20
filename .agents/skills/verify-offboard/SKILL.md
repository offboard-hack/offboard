---
name: verify-offboard
description: Verify Offboard's HR portal in a real browser. Use for end-to-end checks of dashboard filters, offboarding cases, CSV review, checklist templates, and equipment returns. Launches an isolated local session and captures evidence with Playwright.
---

# Verify Offboard

Start with the [feature map](features/README.md). The primary surface is the Portuguese HR web portal. The Elysia API currently exposes health only. The portal reads built-in fixtures and opens without credentials. It needs no database or seed command.

## Launch

From the repository root, use the Node and npm versions specified in `package.json`. Run `npm ci` when dependencies are missing or the lockfile changed. The verifier also needs Python 3 and `lsof` on macOS or Linux.

```sh
verify_skill=.agents/skills/verify-offboard
verify_tools=$(mktemp -d /tmp/offboard-verify-tools.XXXXXX)
npm install --prefix "$verify_tools" --no-save --package-lock=false playwright@1.65.1
"$verify_tools/node_modules/.bin/playwright" install chromium
export OFFBOARD_PLAYWRIGHT_DIR="$verify_tools"

proof_root=$(mktemp -d /tmp/offboard-verification-proof.XXXXXX)
"$verify_skill/scripts/run.py" "$proof_root/checklist" "$verify_skill/scripts/checklist.mjs"
```

The runner starts `npm run dev -w @offboard/api` with `API_HOST=127.0.0.1` and a free `API_PORT`. It starts `npm run dev -w @offboard/web -- --host 127.0.0.1 --port <port> --strictPort` on a different free port. Both listen on loopback. The API retains its default CORS origin because its explicit origin validator rejects loopback IPs and the fixture-backed browser flows make no API calls. API health is a separate check from the portal journeys.

Use a new evidence directory for every run. Run against the working checkout so it includes current edits. The launcher and fresh Chromium context isolate ports and user state from any existing Offboard session. Source and Vite caches are shared with processes using the same checkout.

## Doctor

`scripts/run.py` runs a read-only doctor before executing the browser driver. It checks that the listeners belong to its own process groups, verifies the API health payload and default-origin CORS response, then checks that `/desligamentos` renders Marina Lopes from the fixtures. It records the checkout revision and whether the tree has local changes in `doctor.json`. For the local fixtures, wait for the initial network requests to settle before clicking controls. Server-rendered controls may appear before React attaches their handlers. After a failed drive the runner repeats the doctor and tears down the run. Read the logs, correct the cause, and launch in a new evidence directory before retrying.

## Drive

Use the exact routes, labels, and end states in the [feature map](features/README.md). The checklist driver is executable and can be run with the launch command above. For another recipe, write a disposable `.mjs` driver outside the checkout and use the same runner.

```sh
"$verify_skill/scripts/run.py" "$proof_root/another-feature" /absolute/path/to/drive.mjs
```

Copy the Playwright loader and tracing setup from `scripts/checklist.mjs`. The runner supplies `OFFBOARD_VERIFY_URL` and `OFFBOARD_VERIFY_EVIDENCE`. Open a fresh browser context and use accessible names or existing data attributes. Use the normal routes, controls, and file picker. Keep actions in the run's local origins.

## Evidence

Write browser action logs, screenshots of the starting and resulting state, an ARIA snapshot, and a Playwright trace into the evidence directory. For a mutation, verify the observable result from a second view when the behavior supports one. Case creation is in memory, so use in-app navigation to verify it. Checklist saves are browser-local, so reopen the route in a new tab of the same context. To prove CSV preview creates no case, return to the list and search for the fixture you uploaded. A failed or unreachable entry point needs the attempted action and the concrete failure in `drive.log`.

The runner writes `web.log`, `api.log`, `drive.log`, and `cleanup.json` when it reaches the corresponding stages. Inspect the files after cleanup. Open the recorded trace with:

```sh
"$verify_tools/node_modules/.bin/playwright" show-trace "$proof_root/checklist/checklist-trace.zip"
```

## Cleanup

The runner closes its process groups on success, failure, and ordinary interruption. The bundled driver closes Chromium in a `finally` block. Check that `cleanup.json` reports an empty `listeners_remaining` object. Remove disposable drivers and the temporary npm prefix after the last run. Keep the evidence directory and the installed Chromium cache. Existing app instances and open browser tabs belong to the user.
