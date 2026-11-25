# Offboard para iOS e Android

A jornada da pessoa desligada roda no Expo e usa o mesmo backend da área do colaborador na web. O aplicativo inclui consentimento, acompanhamento da saída, agendamento da devolução de equipamentos, feedback, vagas, candidaturas, entrevistas e currículo.

## Abrir a demonstração

No diretório raiz do monorepo, instale as dependências e inicie o Expo.

```sh
npm install
npm run start -w @offboard/mobile
```

Abra o QR code no Expo Go compatível com o SDK 58. Para abrir no navegador, rode `npm run web -w @offboard/mobile`. Selecione **Entrar na demonstração**.

## Entrar na área do colaborador

Inicie a API, a web e o PostgreSQL conforme o [guia da API](../api/README.md).
No portal do RH, abra um desligamento e configure o e-mail da pessoa em
**Área do colaborador**. Na web, a pessoa acessa `/colaborador/entrar`.

Para usar a mesma API no simulador iOS:

```sh
EXPO_PUBLIC_AUTH_URL=http://localhost:5173 npm run start -w @offboard/mobile -- --localhost
```

No emulador Android, encaminhe a porta do host e use a mesma origem:

```sh
adb reverse tcp:5173 tcp:5173
EXPO_PUBLIC_AUTH_URL=http://localhost:5173 npm run start -w @offboard/mobile -- --localhost
```

A URL deve ser a origem que encaminha as rotas `/api` e corresponde à
configuração pública do Better Auth. Em produção, use a origem HTTPS. Sem
`EXPO_PUBLIC_AUTH_URL`, o app abre a demonstração com dados locais.
O login real envia um código por e-mail e as alterações feitas no app ou na
web ficam vinculadas à mesma conta.

## Gerar os bundles

```sh
npm run build -w @offboard/mobile
```

O Expo salva os bundles de iOS, Android e web em `apps/mobile/dist`.
