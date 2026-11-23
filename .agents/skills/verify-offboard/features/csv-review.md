# Importar desligamentos

The CSV flow checks a file, shows a review of its rows, and creates offboarding cases when you confirm a valid review.

## Sub-features

- `template` downloads a sample CSV.
- `validation` reports invalid rows and blocks completion while they remain.
- `import` creates the cases from valid rows and refreshes the case list.

## How to get to it (user POV)

- Open **Desligamentos** and click **Importar** to open the **Importar desligamentos** dialog.
- Open `/desligamentos/importar` directly for the **Cadastro em massa** page.

## Driving it with Playwright

Preconditions: fresh authenticated admin or RH context, a disposable database, and a unique test name for each entry point. Repeat the review recipe via both entry points. Scope locators to the dialog in the list and to main content on the direct route.

- Capture the download from `Baixar modelo CSV` and verify its header contains `nome,departamento`.
- Use the `Escolher arquivo` button and Playwright's file chooser to supply a buffer named `verify.csv` with MIME type `text/csv` and content `nome,departamento\nCSV Verificação,Marketing\nDepartamento ausente,\n`.
- Wait for the upload to open `Revise a planilha` automatically. Check `1 com erro` and a disabled `Concluir revisão`. Capture the file chooser from `Trocar planilha` and supply only the valid row.
- Review the valid file and verify `CSV Verificação` in the table. Click `Concluir revisão` and verify `Prévia concluída`. In a fresh authenticated tab, search the case list for the test name. Open the imported case and verify its heading.

## Gotchas

- Both entry points create cases. The UI still labels the success state `Prévia concluída` and describes the review as non-persistent. Use the case list to verify the write.
- Matching filenames are insufficient evidence. Verify an actual row, error state, or download content.
