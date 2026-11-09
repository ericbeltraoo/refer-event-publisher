const crypto = require('node:crypto');

const random = () => crypto.randomBytes(32).toString('base64url');
const list = value => String(value || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
function authorizeAccount(claims, config) {
  const email = String(claims.preferred_username || claims.email || '').toLowerCase();
  if (claims.tid !== config.ENTRA_TENANT_ID || !claims.oid ||
      email.split('@').length !== 2 || email.split('@')[1] !== (config.AUTH_EMAIL_DOMAIN || 'refer.com.br').toLowerCase()) {
    throw new Error('Conta não autorizada.');
  }
  const allowed = list(config.AUTH_ALLOWED_USERS);
  if (allowed.length && !allowed.includes(email)) throw new Error('Conta não autorizada.');
  return { id: claims.oid, name: String(claims.name || email), email, authenticated: true,
    canViewLogs: list(config.AUDIT_ADMIN_EMAILS).includes(email) };
}

function createAuth(config, injectedClient) {
  const mode = config.AUTH_MODE || 'disabled';
  if (!['disabled', 'entra'].includes(mode)) throw new Error('AUTH_MODE inválido.');
  if (config.NODE_ENV === 'production' && mode !== 'entra') {
    throw new Error('Produção exige AUTH_MODE=entra.');
  }
  const sessions = new Map();
  let redirect, client;
  if (mode === 'entra') {
    for (const key of ['ENTRA_TENANT_ID','ENTRA_CLIENT_ID','ENTRA_CLIENT_SECRET','ENTRA_REDIRECT_URI']) {
      if (!config[key]) throw new Error('Configuração ausente: ' + key);
    }
    if (!/^[0-9a-f-]{36}$/i.test(config.ENTRA_TENANT_ID)) throw new Error('ENTRA_TENANT_ID inválido.');
    redirect = new URL(config.ENTRA_REDIRECT_URI);
    if (redirect.pathname !== '/auth/redirect' || redirect.search || redirect.hash ||
        (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && redirect.hostname === 'localhost' && config.NODE_ENV !== 'production'))) {
      throw new Error('ENTRA_REDIRECT_URI deve usar HTTPS e /auth/redirect; HTTP localhost somente no desenvolvimento.');
    }
    client = injectedClient || new (require('@azure/msal-node').ConfidentialClientApplication)({
      auth: { clientId: config.ENTRA_CLIENT_ID, clientSecret: config.ENTRA_CLIENT_SECRET,
        authority: 'https://login.microsoftonline.com/' + config.ENTRA_TENANT_ID },
      system: { loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} } }
    });
  }
  const cookieName = redirect?.protocol === 'https:' ? '__Host-refer-session' : 'refer-session';
  const cookie = (res, id, maxAge) => res.setHeader('Set-Cookie',
    cookieName + '=' + id + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (redirect?.protocol === 'https:' ? '; Secure' : ''));
  const sid = req => String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  const reply = (res, status, message) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify({message})); };
  const move = (res, location) => { res.writeHead(302, {Location:location,'Cache-Control':'no-store'}); res.end(); };
  const loginHtml = '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Entrar — Gestão de Eventos</title><body style="font:16px system-ui;background:#f2f6fc;display:grid;place-items:center;min-height:95vh"><main style="background:white;padding:48px;border-radius:16px;max-width:420px"><h1>Gestão de Eventos</h1><p>Entre com sua conta corporativa para consultar e gerenciar os registros.</p><a href="/auth/login">Entrar com a conta da Fundação</a></main></body></html>';
  return {
    mode,
    async handle(req, res, url) {
      res.setHeader('Cache-Control', 'no-store');
      // Expira também estados abandonados e limita o uso de memória.
      for (const [key,value] of sessions) if (value.expires <= Date.now()) sessions.delete(key);
      const id = sid(req), session = sessions.get(id);
      const local = ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
      req.actor = session?.user || {id:null,name:'Usuário não autenticado',email:null,authenticated:false,canViewLogs:local && config.LOCAL_AUDIT_VIEW === 'true'};
      if (url.pathname === '/auth/login' && mode === 'entra') {
        if (req.method !== 'GET') { reply(res,405,'Método não permitido.'); return true; }
        if (sessions.size >= 5000) {reply(res,503,'Tente novamente mais tarde.');return true;}
        const loginId = random(), state = random(), nonce = random(), verifier = random();
        const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
        const location = await client.getAuthCodeUrl({scopes:['openid','profile','email'],
          redirectUri:redirect.href,state,nonce,codeChallenge:challenge,codeChallengeMethod:'S256',responseMode:'query'});
        if (id) sessions.delete(id);
        sessions.set(loginId,{state,nonce,verifier,expires:Date.now()+300000});
        cookie(res,loginId,300); move(res,location); return true;
      }
      if (url.pathname === '/auth/redirect' && mode === 'entra') {
        if (req.method !== 'GET' || !session?.state || session.state !== url.searchParams.get('state')) {
          reply(res,400,'Sessão de login inválida ou expirada. Inicie o login novamente.');return true;
        }
        sessions.delete(id);
        cookie(res,'',0);
        if (!url.searchParams.get('code') || url.searchParams.has('error')) {reply(res,401,'Login não concluído.');return true;}
        try {
          const result = await client.acquireTokenByCode({code:url.searchParams.get('code'),
            scopes:['openid','profile','email'],redirectUri:redirect.href,codeVerifier:session.verifier,nonce:session.nonce});
          const claims = result.idTokenClaims;
          if (!claims || claims.nonce !== session.nonce || claims.aud !== config.ENTRA_CLIENT_ID ||
              claims.iss !== 'https://login.microsoftonline.com/' + config.ENTRA_TENANT_ID + '/v2.0' ||
              !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) throw new Error('Token inválido.');
          const user = authorizeAccount(claims,config);
          const newId = random(), expires = Math.min(Date.now()+8*3600000,claims.exp*1000);
          if (result.account && client.getTokenCache) await client.getTokenCache().removeAccount(result.account);
          sessions.set(newId,{user,expires});
          cookie(res,newId,Math.max(1,Math.floor((expires-Date.now())/1000)));
          move(res,'/'); return true;
        } catch { reply(res,403,'Não foi possível autorizar esta conta. Verifique as permissões com a TI.');return true; }
      }
      if (mode === 'entra' && !session?.user) {
        if (url.pathname.startsWith('/api/') || url.pathname === '/auth/logout') reply(res,401,'Entre com sua conta corporativa.');
        else {res.writeHead(401,{'Content-Type':'text/html; charset=utf-8'});res.end(loginHtml);}
        return true;
      }
      if (mode === 'entra' && !['GET','HEAD'].includes(req.method) &&
          req.headers.origin !== redirect.origin) {
        reply(res,403,'Origem da solicitação não autorizada.');return true;
      }
      if (url.pathname === '/auth/logout') {
        if(req.method !== 'POST'){reply(res,405,'Use POST para sair.');return true;}
        if(id) sessions.delete(id); cookie(res,'',0); reply(res,200,'Sessão encerrada.');return true;
      }
      if (url.pathname === '/api/session') {
        if(req.method !== 'GET'){reply(res,405,'Método não permitido.');return true;}
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({mode,user:req.actor,capabilities:{
          eventSpeakers:config.EVENT_SPEAKERS_ENABLED === 'true',
          speakerMetadata:config.SPEAKER_METADATA_ENABLED === 'true'
        }})); return true;
      }
      return false;
    }
  };
}
module.exports = {createAuth,authorizeAccount};
