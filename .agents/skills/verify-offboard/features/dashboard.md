# Painel

The dashboard summarizes offboarding and unfinished tasks, with filters for the queue and links to case details.

## Sub-features

- `summary` shows Desligamentos, Progresso das tarefas, and Pendências por área.
- `queue-filter` projects the selected team and deadline into the URL and filters the queue.
- `open-case` opens a case from the queue.

## How to get to it (user POV)

- Open `/painel` or use **Painel** in the sidebar.

## Driving it with Playwright

Preconditions: fresh context, seeded cases, passed doctor.

- Open `/painel`. Check regions named `Desligamentos`, `Progresso das tarefas`, and `Pendências por área`.
- In the `Área responsável` combobox select `TI`. Check the URL contains `area=TI` and that the selected value and queue survive reload. Use the `Prazo do desligamento` group to select `Todos`; restore the area to `Todas as áreas` for a baseline comparison.
- Click the queue link whose accessible name starts with `Marina Lopes`. Verify the case URL from the Marina Lopes link and the `Marina Lopes` heading.

## Gotchas

- Date buckets depend on today's workspace date. Verify the filter and resulting membership using the observed date instead of hard-coding overdue counts.
- The dashboard has no import control. For CSV use the Desligamentos toolbar or the dedicated route in [CSV review](csv-review.md).
