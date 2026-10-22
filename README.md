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
4. Para habilitar cadastros de palestrantes e histórico de eventos, configure
   `MANAGEMENT_FLOW_URL` com o endereço de um fluxo único ou configure separadamente
   `SPEAKERS_FLOW_URL`, `PARTICIPATIONS_FLOW_URL` e `EVENTS_FLOW_URL`. Não publique
   esses endereços no repositório.
5. Instale e inicie a aplicação:

   ```powershell
   npm start
   ```

Não são necessários pacotes npm externos.

## Cadastros de palestrantes e histórico do calendário

A interface mantém o conteúdo visual antigo de “Em desenvolvimento” em
`#developmentPageTemplate` como modelo reutilizável. As telas de palestrantes,
eventos e históricos usam componentes próprios e mantêm o padrão visual da intranet.

As listas SharePoint usadas pelos fluxos devem estar no site
`https://refer.sharepoint.com/sites/DocumentosdeEventos`:

- `Palestrantes`: `Title`/Nome, `NomeProfissional`, `AreaDeAtuacao`,
  `NumeroTelefone`, `Email`, `Instituicao` e `Localidade`.
- `Eventos Palestrantes`: `Title`/Titulo, `DataApresentacao`,
  `IndicacaoGratuidade`, `FaixaDeValor`, `FonteDeContato`, `StatusValidacao`,
  `AreaResponsavel`, `Modalidade`, `DataHoraInicio`, `DataHoraFim`, `Local`,
  `OutlookEventId`, `CalendarioOrganizador` e `LinkEvento`.
- `Participacoes`: Lookup `Palestrante` para `Palestrantes` e Lookup `Evento`
  para `Eventos Palestrantes`.

O aplicativo pode chamar um único fluxo ou três fluxos independentes do Power
Automate. Todos devem usar gatilho HTTP POST, validar a operação, usar o conector
SharePoint conectado à conta autorizada e responder com JSON. Com `MANAGEMENT_FLOW_URL`,
o servidor acrescenta `resource` ao corpo (`speakers`, `participations` ou `events`);
o fluxo único deve encaminhar primeiro por `resource` e depois por `action`.

- `SPEAKERS_FLOW_URL` (`/api/speakers`): recebe `{ "action": "list" }`;
  `{ "action": "create", "item": { ...campos do palestrante } }`;
  `{ "action": "update", "id": "...", "item": { ... } }`; ou
  `{ "action": "delete", "id": "..." }`. Listas e gravações respondem
  `{ "items": [...] }` ou, em create/update, `{ "id": "ID SharePoint" }`.
- `PARTICIPATIONS_FLOW_URL` (`/api/participations`): recebe
  `{ "action": "list" }` e responde `{ "items": [{ "speakerId": "...",
  "eventId": "...", "eventTitle": "..." }] }`. Para salvar os vínculos recebe
  `{ "action": "replaceForSpeaker", "speakerId": "...", "eventIds": ["..."] }`;
  o fluxo deve substituir as linhas de participação desse palestrante e responder
  `{ "success": true }`.
- `EVENTS_FLOW_URL` (`/api/managed-events`): recebe `{ "action": "list" }` e
  responde `{ "items": [...] }`; `{ "action": "sync" }` importa/atualiza o histórico
  do calendário da Infra; `update` recebe `id` e `item`; `delete` recebe `id` e
  `outlookEventId`. O fluxo deve sincronizar SharePoint e Outlook e responder JSON.
  Cada evento retornado deve incluir `id`, `title`, `start`, `end`, `location`,
  `organizer`, `outlookEventId` e `organizerIsInfra` booleano. O frontend só exibe
  editar/apagar quando `organizerIsInfra` for `true`.

No modo de fluxo único, `resource` distingue operações cujo `action` se repete,
como `list`. Exemplos: `{ "resource": "speakers", "action": "list" }`,
`{ "resource": "participations", "action": "list" }` e
`{ "resource": "events", "action": "list" }`. Os três grupos acima mantêm seus
contratos de entrada e resposta.

**Segurança da edição de eventos:** o fluxo deve buscar o item SharePoint pelo ID,
confirmar que `CalendarioOrganizador`/organizador é `infra@refer.com.br` e só então
chamar Outlook **Update event (V4)** ou **Delete event (V2)** com o ID do evento.
Não confie apenas no booleano enviado pelo navegador. Eventos de terceiros devem
permanecer somente para consulta. A atualização do calendário e da lista deve falhar
explicitamente se qualquer lado falhar; não retorne sucesso parcial.

Para importar histórico, use **Get calendar view of events (V3)** na caixa da Infra,
paginação e janelas de tempo dentro dos limites do conector. Faça upsert pelo
`OutlookEventId` para evitar duplicatas, e identifique o organizador real antes de
marcar `organizerIsInfra`. O conector não representa necessariamente um histórico
ilimitado: importe o período disponível e trate limites/erros no fluxo.

O formulário existente `/api/teams` continua sendo independente e não é alterado por
esses fluxos de gerenciamento. Até que `MANAGEMENT_FLOW_URL` ou `EVENTS_FLOW_URL`
esteja configurada e o fluxo de sincronização tenha sido validado, o histórico
novo não estará conectado ao Outlook.

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

## Executar com Docker na máquina corporativa

O desenvolvimento local continua usando `npm start`. Na máquina corporativa,
execute o mesmo projeto em Docker Compose; não é necessário alternar os modos
com uma variável `USE_DOCKER` no `.env`, pois o ambiente é determinado pelo
comando usado para iniciar a aplicação.

1. Instale Docker Engine com o plugin Compose na máquina corporativa e disponibilize
   nela o projeto (por exemplo, clonando este repositório).
2. Configure `TEAMS_FLOW_URL`, `WORDPRESS_URL`, `WORDPRESS_USERNAME` e
   `WORDPRESS_APP_PASSWORD` como variáveis de ambiente da Stack no Portainer. Para
   habilitar cadastros/histórico, configure `MANAGEMENT_FLOW_URL` para um fluxo único
   ou `SPEAKERS_FLOW_URL`, `PARTICIPATIONS_FLOW_URL` e `EVENTS_FLOW_URL` para fluxos
   separados. Se
   usar o terminal em vez do Portainer, crie um `.env` privado nessa pasta com
   esses valores, usando `.env.example` como modelo. Não coloque credenciais no
   repositório nem na imagem Docker. `TEAMS_ATTACHMENTS_ENABLED` é opcional e
   assume `false` se não for definida.
3. No Portainer, implante a Stack pelo Git usando `compose.yaml` e cadastre as
   variáveis de ambiente na configuração da Stack. No terminal, na pasta do
   projeto, inicie ou atualize o serviço:

   ```sh
   docker compose up -d --build
   ```

4. A aplicação escuta na porta `3000` do host. Se `172.16.1.141` estiver
   configurado como endereço fixo/reservado dessa máquina, os usuários da rede
   corporativa acessam `http://172.16.1.141:3000`.
5. Libere a porta TCP 3000 apenas na rede corporativa conforme as regras de TI.
   Não exponha a aplicação diretamente à internet.
6. Para verificar o serviço e acompanhar erros:

   ```sh
   docker compose ps
   docker compose logs -f refer-event-publisher
   ```

   Para parar o serviço:

   ```sh
   docker compose down
   ```

As variáveis `HOST=0.0.0.0` e `PORT=3000` já são aplicadas ao container pelo
Compose. O mesmo `.env.example` serve de modelo para execução local e Docker;
use um `.env` separado em cada máquina e não copie credenciais para a imagem.

## Organização

```text
.
├── public/
│   ├── css/styles.css
│   ├── js/app.js
│   └── index.html
├── test/
├── compose.yaml
├── Dockerfile
├── .env.example
├── package.json
└── server.js
```

## Testes

```powershell
npm test
```

## Descrições e anexos do Teams/Calendário

- Na revisão do formulário, **Criar no Calendário & Publicar no Site** cria o
  evento no Calendário/Teams e publica o anúncio no WordPress. **Somente criar no
  Calendário/Teams** cria o evento sem consultar nem publicar no WordPress; nesse
  modo, a descrição do anúncio WordPress não é obrigatória.
- `descricao` contém somente o conteúdo HTML da descrição do Teams/Calendário.
- `descricaoContentType` informa ao fluxo que a descrição usa HTML.
- Imagens inseridas na descrição são serializadas como Data URI (`data:image/...;base64,...`)
  diretamente no HTML de `descricao`. No fluxo, mapeie `descricao` para o campo
  **Body** de **Create event (V4)** e teste a renderização no cliente Teams/Outlook
  utilizado pela organização. Alguns clientes ou conectores podem sanitizar ou
  limitar imagens Data URI; esse método não cria um anexo separado.
- `attachments` contém somente os documentos anexados:
  - `name`: nome do arquivo;
  - `contentType`: tipo MIME;
  - `contentBytes`: conteúdo do arquivo em Base64;
  - `isInline`: `false`.
- A descrição do anúncio WordPress é preenchida separadamente e enviada somente como
  conteúdo WordPress; os anexos não são publicados nele.

### Aviso de conflito de agenda

A aplicação pode mostrar, depois do envio, uma janela com os e-mails dos convidados
que já tinham compromisso sobreposto ao horário do evento. Para isso, o fluxo precisa
consultar a disponibilidade dos participantes antes de criar o evento e terminar com
uma ação **Response** que retorne JSON neste formato:

```json
{
  "conflitos": ["pessoa1@refer.com.br", "pessoa2@refer.com.br"]
}
```

`conflitos` deve ser uma matriz de endereços de e-mail; use uma matriz vazia quando
nenhum convidado estiver ocupado. A verificação depende de a conexão/ação escolhida
no Power Automate ter permissão para ler a disponibilidade dos calendários. Sem
essa consulta e a resposta JSON, a aplicação não tem como saber se há conflitos.
O aviso não cancela nem desfaz o evento já criado.

### Documentos sem Graph: SharePoint e links no evento

A ação **Create event (V4)** não salva documentos como anexos do evento. O caminho
sem Graph é armazenar cada documento em uma biblioteca do SharePoint e acrescentar
à descrição do evento um link para cada arquivo. Configure o fluxo Power Automate
que recebe o POST da aplicação nesta ordem:

1. Confirme que o esquema do gatilho inclui `descricao`, `attachments` e as
   propriedades dos anexos (`name`, `contentType`, `contentBytes` e `isInline`).
   `attachments` é uma matriz; cada `contentBytes` contém o Base64 do arquivo.
2. Antes do loop, inicialize uma variável do tipo **String**, por exemplo
   `LinksDocumentosHtml`, com valor vazio.
3. Crie um **Apply to each** sobre `attachments`. Dentro dele:
   - Use SharePoint **Create file**. Selecione o site e a pasta da biblioteca de
     destino; use `name` como nome e, em **File Content**, a expressão
     `base64ToBinary(items('Apply_to_each')?['contentBytes'])`. Se o fluxo usar
     outro nome interno para a ação de loop, ajuste `Apply_to_each` na expressão.
   - Use SharePoint **Get file properties** com o `ItemId` retornado por **Create
     file**. Não crie um link de compartilhamento público: use o campo **Link to
     item**, para manter as permissões da biblioteca.
   - Use **Append to string variable** para acrescentar um link HTML à variável,
     usando **Link to item** como endereço e um rótulo fixo como “Abrir ou baixar
     documento”, por exemplo `<p><a href="[Link to item]">Abrir ou baixar
     documento</a></p>`. Insira **Link to item** como conteúdo dinâmico do fluxo;
     um rótulo fixo evita interpretar caracteres do nome do arquivo como HTML.
4. Depois que o loop terminar, execute **Create event (V4)**. No **Body**, use a
   expressão `concat(triggerBody()?['descricao'], variables('LinksDocumentosHtml'))`.
   Mantenha o conteúdo como HTML. Assim, a descrição preserva o texto e as imagens
   Data URI, e os documentos aparecem como links para abrir ou baixar.
5. Confirme que os participantes do evento já têm permissão para acessar a pasta
   escolhida no SharePoint. **Link to item** não concede acesso; não use links
   anônimos para contornar permissões. Se os documentos precisarem de acesso
   diferente, alinhe as permissões com a equipe responsável pelo SharePoint.
6. Evite falha por nomes repetidos: configure a criação do arquivo para renomear
   conflitos ou acrescente um prefixo único ao nome no fluxo. Teste com um arquivo
   pequeno antes de usar documentos importantes.

O loop deve terminar antes de **Create event**: se o salvamento de um documento
falhar, o fluxo não deve criar um evento que pareça completo, mas não tenha todos
os links. Depois de salvar e testar o fluxo no Power Automate, defina
`TEAMS_ATTACHMENTS_ENABLED=true` no `.env` e reinicie a aplicação. Enquanto essa
proteção estiver desativada, o servidor responde HTTP 503 para envios com
documentos; imagens Data URI na descrição não dependem dessa configuração.