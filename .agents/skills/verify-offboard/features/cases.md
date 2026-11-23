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

Preconditions: fresh context with Marina Lopes in the case list.

- Fill the searchbox named `Buscar desligamentos por nome` with `Marina`. Confirm Marina Lopes and the absence of Rafael Mendes. Search for `ZZ Verificação` and confirm `Nenhum desligamento corresponde aos filtros.`; then clear.
- Click a non-link cell in the Marina Lopes row. Verify the case URL and heading. Return and activate the `Marina Lopes` link with Enter to exercise the second entry point.
- In the case, open the `Status das tarefas` combobox. Select the option whose name starts with `Concluídas`. Check the checklist shows only `Concluída` badges and that the selection survives reload.
- In the list, open the `Desligamento` button and submit `Criar desligamento` with blank fields. Check `Informe o nome.`. Fill `Nome` with `Caso Verificação` and `Cargo` with `Analista`. Select `Marketing` in the `Área` combobox and an enabled day through `Escolha a data`. Submit, verify the `Caso Verificação` heading, then return through the sidebar and search for it in the list.

## Gotchas

- Creation persists through the API. Reopen the case in a fresh authenticated tab to verify it.
- Case details have a different checklist from the template at `/checklist-automatico`.
