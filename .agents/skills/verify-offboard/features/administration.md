# Administração e equipe

The portal exposes team permissions, integration settings, and plan data to admins.

## Driving it with Playwright

Use an authenticated admin context with the seeded database.

- Open **Equipe** at `/equipe`. Check the **Equipe e permissões** heading and the invited account in the **Equipe RH e permissões** table.
- Open **Integrações** at `/integracoes`. Search for **Slack** in **Buscar sistema** and check the matching integration. Replace the search with `ZZ Verificação` and check **Nenhum sistema corresponde à busca e aos filtros.**
- Open **Planos e gastos** at `/planos-e-gastos`. Check the **Beneficiários** and **Consumo de novembro** tables and the **Faturas e histórico** heading. Search for `ZZ Verificação` in **Buscar beneficiários por nome** and check **Nenhum beneficiário encontrado.**

The plan tables use sample data. Use a disposable database before changing team access or integration settings.
