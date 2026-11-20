# Bens e coleta

The inventory shows offboarding equipment, its current return status, and instructions for collection.

## Sub-features

- `inventory` shows equipment, asset tag, person, and return status.
- `status-filter` filters the inventory and survives reload.
- `collection-guide` explains the return workflow.

## How to get to it (user POV)

- Use **Bens e coleta** in the sidebar or open `/bens-e-coleta`.

## Driving it with Playwright

Preconditions: fresh context with built-in inventory.

- Open `/bens-e-coleta`. Locate the table named `Amostra do inventário` and verify asset `AUR-0412` is present.
- In the `Status da devolução` combobox select `Recebido`. Verify `AUR-0398` is present and `AUR-0412` is absent. Check `status=received` in the URL and verify the filter survives reload. Restore `Todos os status` and verify both tags are present.
- Check the `Como a coleta funciona` heading and the collection instructions below it.

## Gotchas

- Use asset tags as row identities. Model names repeat.
- This view shows sample equipment and instructions. It does not schedule a pickup.
