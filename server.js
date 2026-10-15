const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const MAX_REQUEST_BYTES = 100 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;

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

async function proxyRequest(response, targetUrl, options) {
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

    response.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    response.end(body);
  } catch (error) {
    const message = error.name === 'TimeoutError'
      ? 'O serviço externo demorou demais para responder.'
      : 'Não foi possível conectar ao serviço externo.';
    sendJson(response, 502, { message });
  }
}

function createServer(options = {}) {
  const config = options.config || process.env;
  const publicDir = options.publicDir || PUBLIC_DIR;

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

      if (Array.isArray(payload.attachments) && payload.attachments.length > 0 && config.TEAMS_ATTACHMENTS_ENABLED !== 'true') {
        sendJson(response, 503, {
          message: 'O fluxo do Teams/Calendário ainda não está configurado para anexar arquivos. Atualize o fluxo e habilite TEAMS_ATTACHMENTS_ENABLED.'
        });
        return;
      }

      await proxyRequest(response, config.TEAMS_FLOW_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
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

      await proxyRequest(response, targetUrl, proxyOptions);
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
