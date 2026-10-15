# Agendamento e publicação de eventos

Aplicação interna para criar eventos no Teams/Calendário e publicá-los no WordPress.
A interface fica em `public/`; o servidor Node.js serve os arquivos e encaminha as
chamadas para os serviços externos sem enviar credenciais ao navegador.

## Requisitos

- Node.js 20.6 ou superior.
- Acesso de rede aos serviços Power Automate e WordPress usados pela organização.

## Configuração

1. Copie `.env.example` para `.env`.
2. Preencha `TEAMS_FLOW_URL`, `WORDPRESS_USERNAME` e `WORDPRESS_APP_PASSWORD` com as
   configurações válidas da organização. Mantenha o arquivo `.env` privado.
3. Ajuste `WORDPRESS_URL` se o ambiente WordPress for diferente.
4. Instale e inicie a aplicação:

   ```powershell
   npm start
   ```

Não são necessários pacotes npm externos.

## Acesso pela rede local

- No computador que hospeda a aplicação, abra `http://localhost:3000`.
- Para localizar o endereço de rede do computador, execute `ipconfig` e use o
  endereço IPv4 da interface conectada à rede corporativa.
- As outras pessoas acessam `http://<IPv4-do-computador>:3000`.
- Se o Windows Firewall bloquear o acesso, permita a porta TCP 3000 somente na
  rede privada/corporativa, conforme as regras de TI.
- O computador e o processo `npm start` precisam permanecer ligados.
- A aplicação foi pensada para uso dentro da rede confiável da organização; não
  exponha a porta diretamente à internet.

## Organização

```text
.
├── public/
│   ├── css/styles.css
│   ├── js/app.js
│   └── index.html
├── test/
├── .env.example
├── package.json
└── server.js
```

## Testes

```powershell
npm test
```

## Descrições e anexos do Teams/Calendário

- `descricao` contém somente o conteúdo HTML da descrição do Teams/Calendário.
- `descricaoContentType` informa ao fluxo que a descrição usa HTML.
- `attachments` contém os documentos anexados e as imagens inseridas:
  - `name`: nome do arquivo;
  - `contentType`: tipo MIME;
  - `contentBytes`: conteúdo do arquivo em Base64;
  - `isInline`: `true` para imagens exibidas no corpo e `false` para documentos;
  - `contentId`: identificador das imagens inline, correspondente ao `cid:` usado em `descricao`.
- A descrição do anúncio WordPress é preenchida separadamente e enviada somente como
  conteúdo WordPress; os anexos não são publicados nele.

O fluxo Power Automate precisa incluir `descricaoContentType` e `attachments` no
esquema do gatilho. Depois de criar o evento, deve adicionar cada item de
`attachments` como anexo do mesmo evento, preservando `contentType` e, para
imagens, `isInline` e `contentId`. O corpo do evento precisa ser interpretado como
HTML para que as imagens inline apareçam.

Até o fluxo ser atualizado para processar esses campos, os anexos ainda não serão
adicionados ao evento, mesmo que o formulário os envie corretamente. Valide o
fluxo em ambiente de teste antes de publicar eventos reais. Por segurança, o
servidor rejeita envios com anexos enquanto `TEAMS_ATTACHMENTS_ENABLED` não estiver
definido como `true` no `.env`; habilite-o somente depois de atualizar e testar o
fluxo.
