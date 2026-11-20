# Importar desligamentos

The CSV flow checks a file, shows a review of its rows, and completes a preview without registering offboarding cases.

## Sub-features

- `template` downloads a sample CSV.
- `validation` reports invalid rows and blocks completion while they remain.
- `preview` completes review of a valid file without registering cases.

## How to get to it (user POV)

- Open **Desligamentos** and click **Importar** to open the **Importar desligamentos** dialog.
- Open `/desligamentos/importar` directly for the **Cadastro em massa** page.

## Driving it with Playwright

Preconditions: fresh context and disposable CSV input. Repeat the review recipe via both entry points. Scope locators to the dialog in the list and to main content on the direct route.

- Capture the download from `Baixar modelo CSV` and verify its header contains `nome,departamento`.
- Use the `Escolher arquivo` button and Playwright's file chooser to supply a buffer named `verify.csv` with MIME type `text/csv` and content `nome,departamento\nCSV Verificação,Marketing\nDepartamento ausente,\n`.
- Wait for the upload to open `Revise a planilha` automatically. Check for at least one error and a disabled `Concluir revisão`. Replace the file using `Trocar planilha` and the same content without the invalid row.
- Review the valid file and verify `CSV Verificação` in the table. Click `Concluir revisão` and verify `Prévia concluída`. Return to Desligamentos and search for `CSV Verificação`. Confirm the list has no matching record.

## Gotchas

- The flow is preview-only on both entry points. Finish the review and check the list before reporting the absence of mutations.
- Matching filenames are insufficient evidence. Verify an actual row, error state, or download content.
