# Offboard frontend

## Feature slices

- Keep composition, the shell, and TanStack Router setup in `apps/web/src/app`.
- Keep each workflow in its own directory under `apps/web/src/features`. Colocate its screens, workflow state, feature styles, and fixtures used only by that slice.
- Put domain types and data shared by multiple features in `apps/web/src/entities`. Keep general UI primitives and StyleX tokens in `apps/web/src/shared/ui`.
- Features can depend on `entities` and `shared`. Compose workflows and wire routes in `app`. Cross-feature data should move through a shared domain model or explicit inputs.
- Use TanStack Query for server state, TanStack Router for shareable navigation and filters, TanStack Table for tabular state, and XState for multi-step workflows. Keep person-name searches local to the page.

## Components and visual system

- Use Base UI primitives from `@base-ui/react` whenever there is a matching interactive component. Use `Select` for choosing a value, `Menu` for actions, `Combobox` for searchable choices, and `Drawer` or `Dialog` for modal surfaces. Prefer the existing shared implementation when one exists.
- Use Base UI for buttons, inputs, toggles, switches, and progress. Keep semantic links, tables, landmarks, and native file picking where their platform behavior fits the task.
- Use StyleX for styling and extend the shared purple, semantic color, elevation, and motion tokens before introducing new values. Keep visual layout and copy specific to the workflow.
- Use Base UI state attributes for input and overlay transitions. Keep motion brief and interruptible, honor reduced-motion preferences, and give every gesture an equivalent visible control or keyboard path.
- Verify changed workflows in the browser at desktop and narrow mobile sizes. Exercise focus, keyboard and touch input, and relevant empty, error, and pending states. Run `npm run lint`, `npm run format:check`, and `npm run build -w @offboard/web`.
