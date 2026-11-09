const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createEventsWatcher } = require('./events-watcher');
const {createAuth} = require('./auth');
const {createAudit} = require('./audit');
const crypto = require('node:crypto');

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const MAX_REQUEST_BYTES = 100 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
const MANAGEMENT_FLOWS = new Map([
  ['/api/speakers', { configName: 'SPEAKERS_FLOW_URL', resource: 'speakers', actions: ['list', 'create', 'update', 'delete'] }],
  ['/api/participations', { configName: 'PARTICIPATIONS_FLOW_URL', resource: 'participations', actions: ['list', 'replaceForSpeaker'] }],
  ['/api/managed-events', { configName: 'EVENTS_FLOW_URL', resource: 'events', actions: ['list', 'sync', 'create', 'update', 'delete'] }]
]);

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml']
]);

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function getMissingConfiguration(config, names) {
  return names.filter(name => !config[name]);
}

async function readRequestBody(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_REQUEST_BYTES) {
      const error = new Error('O conteúdo enviado excede o limite de 100 MB.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function proxyRequest(response, targetUrl, options, tracking) {
  try {
    const upstream = await fetch(targetUrl, {
      ...options,
      signal: AbortSignal.timeout(120_000)
    });
    const body = Buffer.from(await upstream.arrayBuffer());

    if (body.length > MAX_RESPONSE_BYTES) {
      sendJson(response, 502, { message: 'A resposta do serviço externo excede o limite permitido.' });
      return;
    }

    if (tracking) {
      let result; try { result = JSON.parse(body.toString('utf8')); } catch {}
      const linked = !tracking.expectSpeakers || result?.participationsSaved === true;
      tracking.audit.write({...tracking.entry,recordId:tracking.entry.recordId || result?.eventId || result?.id,
        status:upstream.status,outcome:upstream.ok && linked ? 'success' : upstream.ok ? 'partial' : 'failed'});
      if(upstream.ok && !linked) {
        sendJson(response,502,{message:'O calendário pode ter sido criado, mas o fluxo não confirmou os vínculos. Consulte o histórico antes de reenviar.',partial:true,requestId:tracking.entry.requestId});return;
      }
    }
    response.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    response.end(body);
  } catch (error) {
    if(tracking) { try {tracking.audit.write({...tracking.entry,outcome:'unknown',status:502});} catch {} }
    const message = error.name === 'TimeoutError'
      ? 'O serviço externo demorou demais para responder.'
      : 'Não foi possível conectar ao serviço externo.';
    sendJson(response, 502, { message });
  }
}

function createServer(options = {}) {
  const config = options.config || process.env;
  const publicDir = options.publicDir || PUBLIC_DIR;
  const auth = createAuth(config, options.authClient);
  const audit = createAudit(config);
  if(config.NODE_ENV === 'production' && !audit.enabled) throw new Error('Configure AUDIT_LOG_DIR em produção.');
  async function forward(request,response,url,proxyOptions) {
    const resource = new URL(request.url,'http://localhost').pathname;
    let payload={}; try {payload=JSON.parse(String(proxyOptions.body || '{}'));}catch{}
    const action = payload.action || (request.method === 'POST' ? 'create' : 'list');
    const mutation = !['list'].includes(action) && request.method === 'POST';
    const requestId=crypto.randomUUID();
    const entry={requestId,actor:request.actor,resource,action,
      recordId:payload.id,fields:Object.keys(payload.item || {}),outcome:'started',status:0};
    const metadata={actorId:request.actor.id,actorEmail:request.actor.email,authenticated:request.actor.authenticated,requestId};
    if(mutation && resource !== '/api/wordpress/events') {
      proxyOptions.body=JSON.stringify({...payload,auditContext:metadata});
    }
    if(mutation) {
      try {audit.write(entry);}catch {sendJson(response,503,{message:'Não foi possível iniciar o registro de auditoria. Nenhuma operação foi enviada.'});return;}
    }
    response.setHeader('X-Request-Id',requestId);
    await proxyRequest(response,url,proxyOptions,mutation?{audit,entry,expectSpeakers:resource==='/api/teams' && payload.speakerParticipations?.length>0}:null);
  }

  // Criado aqui (e não no topo do arquivo) porque o .env só é carregado em startServer().
  // Mesma regra de escolha do fluxo usada na rota /api/managed-events abaixo.
  const unifiedFlow = Boolean(config.MANAGEMENT_FLOW_URL);
    const eventsWatcher = createEventsWatcher({
    flowUrl: unifiedFlow ? config.MANAGEMENT_FLOW_URL : config.EVENTS_FLOW_URL,
    includeResource: unifiedFlow,
    intervalMs: Number(config.EVENTS_WATCH_INTERVAL_MS) || 30000,
    debug: config.EVENTS_WATCH_DEBUG === 'true'
  });

  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; frame-src data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"
    );

    let requestUrl;
    try {
      requestUrl = new URL(request.url, 'http://localhost');
    } catch {
      sendJson(response, 400, { message: 'Endereço da requisição inválido.' });
      return;
    }

    if(requestUrl.pathname === '/healthz') {sendJson(response,200,{status:'ok'});return;}
    try {if(await auth.handle(request,response,requestUrl)) return;}
    catch {sendJson(response,503,{message:'Não foi possível iniciar a autenticação. Tente novamente.'});return;}
    if(['/api/audit','/api/audit/export'].includes(requestUrl.pathname)) {
      if(request.method !== 'GET'){sendJson(response,405,{message:'Método não permitido.'});return;}
      if(!request.actor.canViewLogs){sendJson(response,403,{message:'Acesso aos logs restrito aos responsáveis autorizados.'});return;}
      try {
        const filters=Object.fromEntries(requestUrl.searchParams);
        if(requestUrl.pathname.endsWith('/export')) await audit.exportCsv(filters,response);
        else sendJson(response,200,await audit.query(filters));
      }
      catch(error){if(response.headersSent)response.destroy();else sendJson(response,error.statusCode || 500,{message:error.statusCode?error.message:'Não foi possível consultar a auditoria.'});}return;
    }

    // Aviso em tempo real: o navegador abre esta conexão e só recebe algo quando o histórico muda.
    if (requestUrl.pathname === '/api/managed-events/stream') {
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        sendJson(response, 405, { message: 'Método não permitido.' });
        return;
      }
      if (!(unifiedFlow || config.EVENTS_FLOW_URL)) {
        sendJson(response, 503, { message: 'Configure MANAGEMENT_FLOW_URL ou EVENTS_FLOW_URL para habilitar esta área.' });
        return;
      }
      eventsWatcher.handleSse(request, response);
      return;
    }

    if (requestUrl.pathname === '/api/teams') {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        sendJson(response, 405, { message: 'Método não permitido.' });
        return;
      }

      const missing = getMissingConfiguration(config, ['TEAMS_FLOW_URL']);
      if (missing.length) {
        sendJson(response, 503, { message: `Configure ${missing.join(', ')} no arquivo .env.` });
        return;
      }

      let body;
      let payload;
      try {
        body = await readRequestBody(request);
        payload = JSON.parse(body.toString('utf8'));
      } catch (error) {
        sendJson(response, error.statusCode || 400, {
          message: error.statusCode ? error.message : 'O corpo enviado não contém JSON válido.'
        });
        return;
      }

      if(!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        sendJson(response,400,{message:'Informe um objeto JSON válido.'});return;
      }
      if(payload.speakerParticipations !== undefined) {
        if(!Array.isArray(payload.speakerParticipations) || payload.speakerParticipations.length>20 ||
          payload.speakerParticipations.some(item=>!item || typeof item.speakerId !== 'string' || !item.speakerId.trim() ||
            !['PRESENCIAL','ONLINE','HIBRIDA'].includes(item.modalidade) || !['GRATUITA','REMUNERADA','A_COMBINAR'].includes(item.remuneracao) ||
            (item.remuneracao==='REMUNERADA' && !['ATE_500','DE_501_A_1000','DE_1001_A_3000','ACIMA_3000'].includes(item.faixaDeValor))) ||
          new Set(payload.speakerParticipations.map(item=>item.speakerId)).size !== payload.speakerParticipations.length) {
          sendJson(response,400,{message:'Informe uma lista válida de palestrantes e condições de participação.'});return;
        }
        if(payload.speakerParticipations.length && config.EVENT_SPEAKERS_ENABLED !== 'true') {
          sendJson(response,503,{message:'A seleção de palestrantes está pronta, mas o fluxo de criação precisa ser atualizado antes do envio com vínculos.'});return;
        }
      }

      if (Array.isArray(payload.attachments) && payload.attachments.length > 0 && config.TEAMS_ATTACHMENTS_ENABLED !== 'true') {
        sendJson(response, 503, {
          message: 'O fluxo do Teams/Calendário ainda não está configurado para processar documentos. Configure o salvamento no SharePoint e os links no evento antes de habilitar TEAMS_ATTACHMENTS_ENABLED.'
        });
        return;
      }

      await forward(request, response, config.TEAMS_FLOW_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      return;
    }

    const managementFlow = MANAGEMENT_FLOWS.get(requestUrl.pathname);
    if (managementFlow) {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        sendJson(response, 405, { message: 'Método não permitido.' });
        return;
      }

      const unifiedManagementFlow = Boolean(config.MANAGEMENT_FLOW_URL);
      const flowUrl = unifiedManagementFlow
        ? config.MANAGEMENT_FLOW_URL
        : config[managementFlow.configName];
      const missing = flowUrl ? [] : [managementFlow.configName];
      if (missing.length) {
        sendJson(response, 503, {
          message: `Configure ${missing.join(', ')} para habilitar esta área.`
        });
        return;
      }

      let body;
      let payload;
      try {
        body = await readRequestBody(request);
        payload = JSON.parse(body.toString('utf8'));
      } catch (error) {
        sendJson(response, error.statusCode || 400, {
          message: error.statusCode ? error.message : 'O corpo enviado não contém JSON válido.'
        });
        return;
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
          !managementFlow.actions.includes(payload.action)) {
        sendJson(response, 400, { message: 'A operação solicitada não é válida para este recurso.' });
        return;
      }

      if (['update', 'delete'].includes(payload.action) && !String(payload.id || '').trim()) {
        sendJson(response, 400, { message: 'Informe o identificador do registro para esta operação.' });
        return;
      }

      if (['create', 'update'].includes(payload.action) &&
          (!payload.item || typeof payload.item !== 'object' || Array.isArray(payload.item))) {
        sendJson(response, 400, { message: 'Informe os dados do registro.' });
        return;
      }

      if (requestUrl.pathname === '/api/speakers' &&
          ['create', 'update'].includes(payload.action) &&
          !String(payload.item.nome || '').trim()) {
        sendJson(response, 400, { message: 'Informe o nome do palestrante.' });
        return;
      }

      if (requestUrl.pathname === '/api/participations' &&
          payload.action === 'replaceForSpeaker' &&
          (!String(payload.speakerId || '').trim() ||
           !Array.isArray(payload.eventIds) ||
           payload.eventIds.some(id => !String(id).trim()))) {
        sendJson(response, 400, { message: 'Informe o palestrante e uma lista válida de IDs de eventos.' });
        return;
      }

      if (requestUrl.pathname === '/api/managed-events' &&
          ['update', 'delete'].includes(payload.action) &&
          !(payload.outlookEventId || payload.item?.outlookEventId)) {
        sendJson(response, 400, { message: 'Informe o ID do evento do Outlook para esta operação.' });
        return;
      }

      if(requestUrl.pathname === '/api/speakers' && ['create','update'].includes(payload.action)) {
        const allowed=['nome','nomeProfissional','areaDeAtuacao','numeroTelefone','email','instituicao','localidade',
          'fonteDoContato','areaResponsavel','situacaoCadastro','validarAgora'];
        if(Object.keys(payload.item).some(key=>!allowed.includes(key)) ||
          Object.entries(payload.item).some(([key,value])=>key!=='validarAgora' && (typeof value!=='string'||value.length>255)) ||
          (payload.item.validarAgora !== undefined && typeof payload.item.validarAgora !== 'boolean')) {
          sendJson(response,400,{message:'Campos de palestrante inválidos ou extensos.'});return;
        }
        if(payload.item.areaResponsavel && !['GABIN_COMUNICACAO','GERIC','GEPES'].includes(payload.item.areaResponsavel) ||
           payload.item.situacaoCadastro && !['ATIVO','REVISAO_PENDENTE','ARQUIVADO'].includes(payload.item.situacaoCadastro)) {
          sendJson(response,400,{message:'Área responsável ou situação inválida.'});return;
        }
        const enriched=Object.keys(payload.item).some(key=>['fonteDoContato','areaResponsavel','situacaoCadastro','validarAgora'].includes(key));
        if(enriched && config.SPEAKER_METADATA_ENABLED !== 'true') {
          sendJson(response,503,{message:'Atualize o fluxo e habilite SPEAKER_METADATA_ENABLED para salvar origem e validação.'});return;
        }
        if(config.SPEAKER_METADATA_ENABLED === 'true' && (!payload.item.areaResponsavel || !payload.item.fonteDoContato)) {
          sendJson(response,400,{message:'Informe a fonte do contato e a área responsável pelo cadastro.'});return;
        }
        // Datas de inclusão são geradas pelo SharePoint; validação somente com confirmação explícita.
        if(payload.item.validarAgora) payload.item.dataValidacao=new Date().toISOString();
      }

      const forwardedBody = unifiedManagementFlow
        ? JSON.stringify({ ...payload, resource: managementFlow.resource })
        : JSON.stringify(payload);
      await forward(request, response, flowUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: forwardedBody
      });
      return;
    }

    if (requestUrl.pathname === '/api/wordpress/events') {
      if (!['GET', 'POST'].includes(request.method)) {
        response.setHeader('Allow', 'GET, POST');
        sendJson(response, 405, { message: 'Método não permitido.' });
        return;
      }

      const required = ['WORDPRESS_URL', 'WORDPRESS_USERNAME', 'WORDPRESS_APP_PASSWORD'];
      const missing = getMissingConfiguration(config, required);
      if (missing.length) {
        sendJson(response, 503, { message: `Configure ${missing.join(', ')} no arquivo .env.` });
        return;
      }

      let targetUrl;
      try {
        targetUrl = new URL(config.WORDPRESS_URL);
        if (!['http:', 'https:'].includes(targetUrl.protocol)) throw new Error('Protocolo inválido.');
        if (request.method === 'GET') {
          const perPage = Number(requestUrl.searchParams.get('per_page') || '50');
          if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
            sendJson(response, 400, { message: 'O parâmetro per_page deve ser um inteiro entre 1 e 100.' });
            return;
          }
          targetUrl.searchParams.set('per_page', String(perPage));
        }
      } catch {
        sendJson(response, 500, { message: 'WORDPRESS_URL deve ser uma URL HTTP ou HTTPS válida.' });
        return;
      }

      const credentials = Buffer
        .from(`${config.WORDPRESS_USERNAME}:${config.WORDPRESS_APP_PASSWORD}`)
        .toString('base64');
      const proxyOptions = {
        method: request.method,
        headers: { Authorization: `Basic ${credentials}` }
      };

      if (request.method === 'POST') {
        let body;
        try {
          body = await readRequestBody(request);
          JSON.parse(body.toString('utf8'));
        } catch (error) {
          sendJson(response, error.statusCode || 400, {
            message: error.statusCode ? error.message : 'O corpo enviado não contém JSON válido.'
          });
          return;
        }
        proxyOptions.headers['Content-Type'] = request.headers['content-type'] || 'application/json';
        proxyOptions.body = body;
      }

      await forward(request, response, targetUrl, proxyOptions);
      return;
    }

    const pathname = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(pathname);
    } catch {
      sendJson(response, 400, { message: 'Caminho inválido.' });
      return;
    }

    const filePath = path.resolve(publicDir, `.${decodedPath}`);
    const relativePath = path.relative(publicDir, filePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      sendJson(response, 404, { message: 'Página não encontrada.' });
      return;
    }

    fs.stat(filePath, (error, stats) => {
      if (error || !stats.isFile()) {
        sendJson(response, 404, { message: 'Página não encontrada.' });
        return;
      }

      response.writeHead(200, {
        'Content-Type': MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
        'Cache-Control': path.extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=3600'
      });
      fs.createReadStream(filePath).pipe(response);
    });
  });
}

function startServer() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT deve ser um número entre 1 e 65535.');
  }

  const host = process.env.HOST || '0.0.0.0';
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`Aplicação disponível em http://localhost:${port}`);
    console.log(`Acesso pela rede: http://<IP-do-computador>:${port}`);
    console.log('Mantenha este terminal e o computador ligados enquanto a aplicação estiver em uso.');
  });
}

if (require.main === module) {
  try {
    startServer();
  } catch (error) {
    console.error(`Não foi possível iniciar a aplicação: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { createServer };
