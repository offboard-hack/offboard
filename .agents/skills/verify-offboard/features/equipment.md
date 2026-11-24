# Bens e coleta

The permanent company equipment inventory with status, assignee, return method and tracking, plus Correios shipments and collection instructions.

## Sub-features

- `inventory` shows equipment, asset tag, assignee, status, return method and tracking code.
- `status-filter` filters the inventory and survives reload.
- `search` filters by item name or asset tag.
- `collection-guide` explains the return workflow.

## How to get to it (user POV)

- Use **Bens e coleta** in the sidebar or open `/bens-e-coleta`.

## Driving it with Playwright

Preconditions: fresh context with built-in inventory.

- Open `/bens-e-coleta`. Locate the table named `Inventário de equipamentos` and verify asset `PAT-0412` is present.
- In the `Situação do equipamento` combobox select `Recebido`. Verify `PAT-2210` is present and `PAT-0412` is absent. Check `status=received` in the URL and verify the filter survives reload. Restore `Todas as situações` and verify both tags are present.
- Type `PAT-0412` in `Buscar por item ou patrimônio` and verify only that row remains.
- Check the `Como a coleta funciona` heading and the collection instructions below it.

## Gotchas

- Use asset tags as row identities. Model names repeat.
- Add, status changes and delete are admin-only or admin and RH. Other roles see a read-only table.
