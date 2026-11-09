# Cadastro integrado, auditoria e autenticação

## Estado desta entrega

Implementados na aplicação: escolha de palestrantes no evento, modal reutilizando o cadastro,
condições por participação, campos de origem/validação, consulta de logs e integração de login
via biblioteca oficial MSAL. Não foram alterados fluxos ou listas reais do Microsoft 365.
Não foram criados eventos, convites ou palestrantes reais durante os testes.

Os históricos mantêm suas rotas e colunas. Os novos campos e o vínculo no envio estão
protegidos por duas capacidades independentes, inicialmente desativadas:

- EVENT_SPEAKERS_ENABLED=false
- SPEAKER_METADATA_ENABLED=false

Sem essas capacidades, o cadastro básico existente continua disponível; o envio com os
novos campos é bloqueado explicitamente, antes de chamar o fluxo.

## Experiência do usuário

No cadastro de eventos, “Este evento possui palestrantes?” abre a busca por pessoas já
cadastradas e o cadastro rápido. Aceita até 20 palestrantes, sem repetir IDs.
Cada participação tem modalidade (presencial, online ou híbrida) e condições (gratuita,
remunerada ou a combinar). Para remunerada, utiliza faixas, não dados bancários.
O e-mail do palestrante não é automaticamente adicionado aos convidados.

Salvar no modal cria um cadastro independente e o seleciona no rascunho do evento.
Cancelar o evento não elimina esse cadastro. Antes da criação do evento, o vínculo
existe somente no rascunho do navegador; recarregar a página perde esse rascunho.

Os dados de origem/validação ficam na pessoa. Modalidade e custo ficam na participação.
A fonte do contato usa opções curtas: indicação interna, site profissional, evento anterior
ou contato direto. Área responsável: GABIN/Comunicação, GERIC ou GEPES.
A seleção não oferece pessoas arquivadas. Inclusão vem de Created do SharePoint; última
validação é atualizada somente quando alguém confirma a revisão. A edição sinaliza revisão
pendente para registros sem validação ou com mais de um ano.

Não há eliminação automática. Retenção, arquivamento restrito e eliminação devem seguir
a tabela de temporalidade aprovada pela organização.

## SharePoint: alterações necessárias

Preservar os nomes internos existentes e mapear explicitamente os campos da aplicação.
Não excluir colunas ou migrar valores históricos sem revisão.

Lista Palestrantes:

| Campo da API | Sugestão de coluna | Tipo/observação |
|---|---|---|
| fonteDoContato | FonteDoContato | Escolha: INDICACAO_INTERNA, SITE_PROFISSIONAL, EVENTO_ANTERIOR, CONTATO_DIRETO |
| areaResponsavel | AreaResponsavel | Escolha: GABIN_COMUNICACAO, GERIC, GEPES |
| situacaoCadastro | SituacaoCadastro | Escolha: ATIVO, REVISAO_PENDENTE, ARQUIVADO |
| dataInclusao | Created existente | Retornar data de criação; não sobrescrever |
| dataValidacao | DataValidacao | Data/hora, opcional |
| validadoPorId / validadoPorEmail | ValidadoPorId / ValidadoPorEmail | Derivar de auditContext autenticado ao validar |

Os campos anteriores (nome etc.) continuam iguais. O fluxo deve devolver os novos campos
no list; sem esse retorno a interface não pode apresentar a data/situação atual.
Em update com validarAgora=false, preservar a data e o responsável da última validação.
Arquivar deve impedir novas seleções sem apagar as participações históricas; o controle
de acesso aos registros arquivados também precisa ser aplicado no fluxo, não só na tela.

Lista Participacoes:

| Campo | Coluna sugerida | Tipo |
|---|---|---|
| speakerId | Palestrante | Lookup existente |
| eventId | Evento | Lookup existente |
| modalidade | Modalidade | PRESENCIAL, ONLINE, HIBRIDA |
| remuneracao | Remuneracao | GRATUITA, REMUNERADA, A_COMBINAR |
| faixaDeValor | FaixaDeValor | ATE_500, DE_501_A_1000, DE_1001_A_3000, ACIMA_3000; vazio se não remunerada |

Não reutilizar a modalidade ou gratuidade geral de um evento para todas as pessoas.
Preservar os vínculos e valores antigos. O fluxo replaceForSpeaker existente deve preservar
as condições dos vínculos mantidos: apagar e recriar todas as linhas sem transportar esses
campos perderia modalidade/remuneração. Esse ajuste deve preceder a ativação do novo modelo.

## Power Automate: fluxo de gestão

O corpo de create/update em speakers continua action + item; item passa a incluir
fonteDoContato, areaResponsavel, situacaoCadastro e validarAgora.
Quando validarAgora=true, o Node gera dataValidacao. Não aceitar datas arbitrárias do navegador.
Mapear todos os campos e continuar respondendo JSON com id do cadastro.
O servidor exige fonte e área quando SPEAKER_METADATA_ENABLED=true.
Somente habilitar a variável depois de testar create, list e update em uma lista de homologação.

## Power Automate: criação de evento com palestrantes

POST /api/teams mantém os campos atuais e acrescenta:

```json
{
  "speakerParticipations": [
    {
      "speakerId": "42",
      "modalidade": "ONLINE",
      "remuneracao": "GRATUITA",
      "faixaDeValor": ""
    }
  ],
  "auditContext": {
    "actorId": "identificador-Entra",
    "actorEmail": "usuario@refer.com.br",
    "authenticated": true,
    "requestId": "identificador-da-tentativa"
  }
}
```

O servidor sobrescreve auditContext: não confiar em valores enviados pelo navegador.
Esse contexto identifica o solicitante da aplicação, não a conta técnica do conector.

Ordem necessária no fluxo:

1. Validar os palestrantes por ID, situação e campos de participação antes de criar o calendário.
2. Criar o compromisso/reunião e obter o ID real do Outlook.
3. Criar/atualizar o registro em Eventos Palestrantes por OutlookEventId, sem duplicá-lo.
4. Criar os vínculos em Participacoes usando o ID do item SharePoint do evento.
   Não executar replaceForSpeaker com somente o novo evento: isso removeria participações antigas.
5. Responder somente após concluir o calendário, o item e todos os vínculos.

Resposta de sucesso com vínculos:

```json
{
  "eventId": "ID-do-item-SharePoint",
  "outlookEventId": "ID-real-do-Outlook",
  "participationsSaved": true,
  "linkGerado": "link-da-reuniao-se-houver",
  "conflitos": []
}
```

Se não houver palestrantes, a resposta existente pode ser mantida.
Para vínculos selecionados, resposta HTTP 2xx sem participationsSaved=true é tratada como
resultado parcial e a divulgação WordPress é interrompida. Não afirmar sucesso se parte falhou.
Em falhas de rede, o estado é indeterminado: consultar o histórico antes de reenviar.
O fluxo precisa reconciliar/reverter falhas parciais e tratar reenvios sem duplicação antes
de habilitar EVENT_SPEAKERS_ENABLED. A aplicação não implementa transação distribuída entre
Outlook, SharePoint e WordPress. requestId serve para correlação, não é uma garantia de idempotência.

## Login Microsoft / implantação

Configuração via ambiente (nunca versionar o segredo):

```text
AUTH_MODE=entra
ENTRA_TENANT_ID=ID-do-diretorio
ENTRA_CLIENT_ID=ID-do-aplicativo
ENTRA_CLIENT_SECRET=valor-secreto
ENTRA_REDIRECT_URI=https://ENDERECO-DEFINITIVO/auth/redirect
AUTH_EMAIL_DOMAIN=refer.com.br
AUTH_ALLOWED_USERS=
AUDIT_ADMIN_EMAILS=responsavel@refer.com.br
AUDIT_LOG_DIR=/app/data/audit
```

Registro Entra: plataforma Web, somente o tenant da Fundação, código de autorização,
retorno exato /auth/redirect. Não habilitar fluxo implícito ou cliente público.
A TI deve restringir a aplicação empresarial aos usuários/grupos internos aprovados,
exigir atribuição e não atribuir convidados. A aplicação valida tenant, domínio do principal,
ID do usuário e, opcionalmente, uma lista de e-mails autorizados; domínio sozinho não define
a condição de membro/convidado. AUTH_ALLOWED_USERS vazio permite os principais desse domínio
que passaram pelas políticas/atribuições do Entra.

PKCE, state e nonce vinculam o retorno à sessão iniciadora. O segredo não vai ao navegador.
Todas as telas e APIs exigem sessão em modo entra; /healthz é uma exceção sem dados pessoais.
POST exige Origin igual ao endereço externo configurado. Cookies HTTPS são HttpOnly,
Secure, SameSite=Lax. Logout encerra a sessão local, não a sessão Microsoft de outros aplicativos.
Sessão expira no máximo em 8 horas ou na expiração do ID token, o que ocorrer primeiro.

As sessões ficam em memória: usar uma única réplica neste estágio. Reiniciar o container
exige novo login; múltiplas réplicas precisam de armazenamento de sessão compartilhado antes
de escalar. Testes de login foram feitos com respostas simuladas; falta validar o tenant real.

O Compose agora exige variáveis Entra e NODE_ENV=production e não aceita iniciar sem autenticação.
Não atualizar a stack real até a TI fornecer a configuração. A porta 3000 é publicada somente
no loopback do host para um proxy HTTPS no mesmo host. Se o proxy for outro container,
conectá-lo à mesma rede Docker e encaminhar para refer-event-publisher:3000; não publicar
a porta HTTP diretamente na rede. Se o proxy ficar em outra máquina, a TI deve definir
o acesso privado correspondente. O IP HTTP 172.16.1.94:3000 não é o retorno de produção.

## Auditoria

Arquivos JSONL diários em AUDIT_LOG_DIR, fora de public e do Git, persistidos no volume
refer-audit. Cada mutação registra início e resultado, timestamp UTC, requestId, identidade
autenticada, recurso, ação, ID e nomes dos campos. Resultado pode ser success, failed, partial
ou unknown. Não gravar valores de contato, descrições, anexos, tokens ou URLs assinadas.
Falha ao abrir/gravar o início da auditoria bloqueia a chamada externa.
Reinício mantém os arquivos; não apagar o volume ao atualizar a stack.

A página Logs do sistema fica em #/logs. Consulta todo o histórico disponível quando não há datas, sem corte de 31 dias, 500 resultados ou 4 MiB por arquivo. A leitura é feita em blocos, com páginas de 25, 50 ou 100 registros. Há filtros por data UTC, usuário, categoria, operação, resultado, ID do registro e correlação. Os detalhes se expandem na própria tabela.

A exportação CSV inclui todos os resultados dos filtros aplicados, independentemente da página, com neutralização de fórmulas em células de texto. A paginação e a exportação utilizam a referência de tempo da consulta; Atualizar inicia uma nova referência. Os contadores resumem registros de auditoria, não operações distintas: início e resultado podem ser duas entradas com a mesma correlação. Linhas inválidas são sinalizadas; não há recuperação retroativa de ações que nunca foram registradas.

Consultas e exportações percorrem os arquivos do período; para volumes corporativos muito grandes, migrar a trilha para um banco/serviço de auditoria indexado. O armazenamento e a retenção continuam sob responsabilidade da TI.

Somente AUDIT_ADMIN_EMAILS pode consultar via API/tela. LOCAL_AUDIT_VIEW=true permite consulta
sem login somente de loopback em desenvolvimento; não usar como autorização corporativa.

Logs cobrem as operações que passam por este servidor. Alterações diretas em Outlook,
SharePoint ou no Power Automate exigem auditoria própria na origem. Usuários administradores
do host/volume ainda podem alterar os arquivos: esta é uma trilha operacional, não armazenamento
imutável. Definir backup, retenção, acesso e eventual coleta central com a TI.

Em AUTH_MODE=disabled, a interface mostra “Desenvolvimento — sem autenticação” e os logs não
inventam nome ou usuário Windows. NODE_ENV=production rejeita esse modo.

## Validação

npm ci e npm test. Os testes cobrem proteção de rotas, state/nonce/PKCE, domínio e tenant,
logout, origem de mutações, log sem conteúdos sensíveis, bloqueio de capacidades ausentes
e resposta parcial de vínculos. Teste visual com serviços locais simulados, sem gravações reais.
Antes da implantação, testar: conta interna autorizada, conta externa, convidado, conta não
atribuída, usuário sem acesso a logs, criação com palestrante existente/novo, preservação dos
vínculos anteriores, validação/arquivamento, queda parcial do fluxo e reinício do container.
