const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createServer } = require('../server');

test('serve a interface e os recursos estáticos', async t => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refer-event-public-'));
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<h1>Eventos</h1>');
  const server = createServer({ config: {}, publicDir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(publicDir, { recursive: true, force: true });
  });

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Eventos/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('reports missing service configuration without exposing upstream credentials', async t => {
  const server = createServer({ config: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/teams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ titulo: 'Teste' })
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /TEAMS_FLOW_URL/);
});

test('rejects malformed JSON before contacting external services', async t => {
  const server = createServer({ config: { TEAMS_FLOW_URL: 'https://example.invalid' } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/teams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid'
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /JSON válido/);
});

test('does not claim to send attachments until Teams flow support is enabled', async t => {
  const server = createServer({ config: { TEAMS_FLOW_URL: 'https://example.invalid' } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/teams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attachments: [{ name: 'documento.pdf' }] })
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /ainda não está configurado/);
});

test('forwards Teams requests through the server without requiring browser credentials', async t => {
  let forwardedPayload;
  const upstream = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      forwardedPayload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      response.writeHead(202, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ accepted: true }));
    });
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamAddress = upstream.address();
  const server = createServer({
    config: {
      TEAMS_FLOW_URL: `http://127.0.0.1:${upstreamAddress.port}/flow`,
      TEAMS_ATTACHMENTS_ENABLED: 'true'
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await Promise.all([
      new Promise(resolve => server.close(resolve)),
      new Promise(resolve => upstream.close(resolve))
    ]);
  });

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/teams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      titulo: 'Evento de teste local',
      descricaoContentType: 'HTML',
      attachments: [{
        name: 'imagem.png',
        contentType: 'image/png',
        contentBytes: 'aW1hZ2V0ZXN0',
        isInline: true,
        contentId: 'teams-inline-image-1@refer.local'
      }]
    })
  });
  assert.equal(response.status, 202);
  assert.deepEqual(forwardedPayload, {
    titulo: 'Evento de teste local',
    descricaoContentType: 'HTML',
    attachments: [{
      name: 'imagem.png',
      contentType: 'image/png',
      contentBytes: 'aW1hZ2V0ZXN0',
      isInline: true,
      contentId: 'teams-inline-image-1@refer.local'
    }]
  });
  assert.deepEqual(await response.json(), { accepted: true });
});

test('does not expose files outside the public directory', async t => {
  const server = createServer({ config: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/.env`);
  assert.equal(response.status, 404);
});
