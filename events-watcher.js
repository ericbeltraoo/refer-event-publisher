'use strict';
const crypto = require('node:crypto');

/**
 * Vigia o histórico de eventos no servidor e avisa os navegadores (SSE)
 * somente quando algo mudou. Sem pacotes externos.
 */
function createEventsWatcher({
  flowUrl,
  intervalMs = 30000,
  includeResource = true,   // true com MANAGEMENT_FLOW_URL; false com EVENTS_FLOW_URL
  heartbeatMs = 25000,
  debug = false
} = {}) {
  const clients = new Set();
  let timer = null;
  let heartbeat = null;
  let lastHash = null;
  let polling = false;
  const log = (...args) => {
    if (debug) console.log('[events-watcher]', new Date().toLocaleTimeString('pt-BR'), ...args);
  };

  function hashOf(items) {
    return crypto.createHash('sha1').update(JSON.stringify(items)).digest('hex');
  }

  async function poll() {
    if (!flowUrl || polling || clients.size === 0) return;
    polling = true;
    try {
      const body = includeResource
        ? { resource: 'events', action: 'list' }
        : { action: 'list' };
      const response = await fetch(flowUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const items = Array.isArray(data.items) ? data.items : [];
      const hash = hashOf(items);
      const changed = lastHash !== null && hash !== lastHash;
      log(`consulta ok: ${items.length} evento(s), ${clients.size} tela(s) aberta(s), ` +
        (lastHash === null ? 'referência inicial' : changed ? 'MUDOU -> avisando as telas' : 'sem mudança'));
      if (changed) broadcast('events-changed', { at: Date.now() });
      lastHash = hash; // a primeira leitura só grava a referência
    } catch (error) {
      console.warn('[events-watcher] falha ao consultar o fluxo:', error.message);
    } finally {
      polling = false;
    }
  }

  function broadcast(event, payload) {
    const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) res.write(message);
  }

  function ensureRunning() {
    if (!timer) timer = setInterval(poll, intervalMs);
    if (!heartbeat) heartbeat = setInterval(() => {
      for (const res of clients) res.write(': ping\n\n');
    }, heartbeatMs);
  }

  function stopIfIdle() {
    if (clients.size) return;
    clearInterval(timer); clearInterval(heartbeat);
    timer = heartbeat = null;
    lastHash = null; // ao voltar alguém, recria a referência
  }

  function handleSse(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 5000\n\n');
    res.write('event: ready\ndata: {}\n\n');
    clients.add(res);
    log(`tela conectada (${clients.size} aberta(s))`);
    ensureRunning();
    if (lastHash === null) poll(); // referência inicial
    req.on('close', () => {
      clients.delete(res);
      log(`tela desconectada (${clients.size} aberta(s))`);
      stopIfIdle();
    });
  }

  return { handleSse, poll, get clientCount() { return clients.size; } };
}

module.exports = { createEventsWatcher };
