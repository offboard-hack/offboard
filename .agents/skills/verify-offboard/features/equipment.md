# Bens e coleta

The inventory shows offboarding equipment, its current return status, and instructions for collection.

## Sub-features

- `inventory` shows equipment, asset tag, person, and return status.
- `status-filter` filters the inventory and survives reload.
- `shipments` shows tracking codes from cases and loads carrier updates separately.
- `collection-guide` explains the return workflow.

## How to get to it (user POV)

- Use **Bens e coleta** in the sidebar or open `/bens-e-coleta`.

## Driving it with Playwright

Preconditions: fresh authenticated context with Offboarding read access and seeded cases.

- Open `/bens-e-coleta`. Locate the table named `Inventário de bens` and verify asset `AUR-0412` is present.
- In the `Status da devolução` combobox select `Recebido`. Verify `AUR-0398` is present and `AUR-0412` is absent. Check `status=received` in the URL and verify the filter survives reload. Restore `Todos os status` and verify both tags are present.
- Check `Rastreio dos envios` for the seeded code `BR123456789BR`. Carrier statuses can vary.
- Check the `Como a coleta funciona` heading and the collection instructions below it.

## Gotchas

- Use asset tags as row identities. Model names repeat.
- The inventory is sample data. Use the collection section to verify the instructions.

For the connected return flow, add a different asset and a return date to a
disposable case under **Área do colaborador**. Use the authenticated employee
session to book a return. Verify the slot and address in **Bens e coleta** as HR,
confirm receipt, and reload the employee equipment screen to verify the receipt.
