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