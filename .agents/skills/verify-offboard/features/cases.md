# Desligamentos

HR can look up employees, inspect a case's task progress, and create a case in the current portal session.

## Sub-features

- `list-search` filters the list by person name, including the empty state.
- `open-case` opens details by clicking a row or activating its person link.
- `task-filter` filters the case checklist by completion status.
- `new-case` validates and creates a case from the list toolbar.

## How to get to it (user POV)

- Use **Desligamentos** in the sidebar or open `/desligamentos`.
- Click a row or use the person's link. Use the seeded Marina Lopes link to obtain the generated case URL.
- Use **Desligamento** in the toolbar to open the creation dialog.

## Driving it with Playwright

Preconditions: fresh authenticated context with seeded cases. Use an admin or RH member and a disposable database for creation.

- Confirm Marina Lopes and Rafael Mendes are visible. Fill the searchbox named `Buscar desligamentos por nome` with `Marina`. Confirm Marina Lopes and the absence of Rafael Mendes. Search for `ZZ Verificação` and confirm `Nenhum desligamento corresponde aos filtros.`; then clear.
- Click a non-link cell in the Marina Lopes row. Verify the case URL and heading. Return and activate the `Marina Lopes` link with Enter to exercise the second entry point.
- In the case, open the `Status das tarefas` combobox. Select the option whose name starts with `Concluídas`. Check the checklist shows at least one task and only `Concluída` badges. Confirm `tasks=done` and the filtered results survive reload.
- In the list, open the `Desligamento` button and submit `Criar desligamento` with blank fields. Check `Informe o nome.`. Within `Novo desligamento`, fill `Nome` with a unique test name and `Cargo` with `Analista`. Select `Marketing` in `Área` and choose an enabled day with the `Data de encerramento Escolha a data` button. Submit, verify the new case heading, then return through the sidebar and search for the case in the list.

## Gotchas

- Creation persists through the API. Reopen the case in a fresh authenticated tab to verify it.
- Case details have a different checklist from the template at `/checklist-automatico`.
