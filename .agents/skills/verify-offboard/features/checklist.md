# Checklist automático

The template board organizes named steps by team and week. HR can edit them, drag them between cells, undo changes, and save a browser-local model.

## Sub-features

- `edit-step` creates, renames, and removes a step.
- `drag-step` supports pointer drag and keyboard pick up and drop.
- `undo` restores the preceding draft state.
- `save-model` restores the saved model in another tab of the same browser context.

## How to get to it (user POV)

- Click **Checklist automático** in the sidebar or open `/checklist-automatico`.
- Click any card to edit it. Click **Nova etapa** in the intended cell to create one.

## Driving it with Playwright

Preconditions: new context with the built-in model and the `Bloquear acessos` card in TI on the day of offboarding.

- Run `scripts/checklist.mjs` through the launcher in [SKILL.md](../SKILL.md). It uses the sidebar, moves `Bloquear acessos` with Space, ArrowRight, Space, saves, and checks the new placement under TI / Primeira semana in a second tab.
- For a pointer check, drag the card named `Editar etapa: Bloquear acessos` from its body to `[data-checklist-cell="cell:Gestão:d0"]`. Verify the card is in Gestão and no edit dialog opened. Use `Desfazer` and verify the TI placement returns.
- Create a step with `Nova etapa: TI, Primeira semana` and the title `Teste de etapa`. Click the resulting card. Change `Nome da etapa`, click `Salvar`, then reopen and confirm deletion through `Excluir` and `Excluir etapa`. Verify the renamed card disappears and returns after undo.

## Gotchas

- Enter opens editing. Space starts or finishes keyboard drag and Escape cancels it. Arrows change the target cell; Page Up and Page Down adjust order within a cell.
- Unsaved edits are tab-local. Saved models are local to that browser origin. Prove persistence with a second tab in the same context.
