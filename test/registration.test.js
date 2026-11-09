const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {createServer}=require('../server');
const {createAudit}=require('../audit');
const {authorizeAccount,createAuth}=require('../auth');
const tenant='11111111-1111-1111-1111-111111111111';
const clientId='22222222-2222-2222-2222-222222222222';
const authConfig={AUTH_MODE:'entra',ENTRA_TENANT_ID:tenant,ENTRA_CLIENT_ID:clientId,
  ENTRA_CLIENT_SECRET:'test-only',ENTRA_REDIRECT_URI:'http://localhost:3000/auth/redirect'};
async function serve(t,config,authClient) {
  const server=createServer({config,authClient});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return 'http://127.0.0.1:'+server.address().port;
}
test('produção falha fechada sem Entra e configuração incompleta',()=>{
  assert.throws(()=>createAuth({NODE_ENV:'production'}),/Produção exige/);
  assert.throws(()=>createAuth({AUTH_MODE:'entra'}),/Configuração ausente/);
  assert.throws(()=>createAuth({...authConfig,ENTRA_REDIRECT_URI:'http://172.16.1.94:3000/auth/redirect'}),/HTTPS/);
});
test('identidade exige tenant, domínio exato e restrição opcional de usuários',()=>{
  const claims={tid:tenant,oid:'person-id',preferred_username:'pessoa@refer.com.br',name:'Pessoa'};
  assert.equal(authorizeAccount(claims,authConfig).authenticated,true);
  assert.throws(()=>authorizeAccount({...claims,tid:'other'},authConfig),/autorizada/);
  assert.throws(()=>authorizeAccount({...claims,preferred_username:'pessoa@refer.com.br.evil.test'},authConfig),/autorizada/);
  assert.throws(()=>authorizeAccount(claims,{...authConfig,AUTH_ALLOWED_USERS:'outra@refer.com.br'}),/autorizada/);
});
test('sem sessão bloqueia interface, recursos, consultas e mutações',async t=>{
  const base=await serve(t,authConfig,{});
  for(const route of ['/','/js/app.js','/api/speakers','/api/managed-events/stream','/api/audit']) {
    assert.equal((await fetch(base+route)).status,401);
  }
  assert.equal((await fetch(base+'/api/speakers',{method:'POST',body:'{}'})).status,401);
});
test('login vincula state, nonce e PKCE; sessão autoriza APIs e exige origem para POST',async t=>{
  let authRequest,codeRequest;
  const mock={
    async getAuthCodeUrl(request){authRequest=request;return 'https://login.microsoftonline.com/example';},
    async acquireTokenByCode(request){codeRequest=request;return {idTokenClaims:{
      tid:tenant,oid:'user-1',preferred_username:'user@refer.com.br',nonce:authRequest.nonce,
      aud:clientId,iss:'https://login.microsoftonline.com/'+tenant+'/v2.0',exp:Math.floor(Date.now()/1000)+3600
    }};}
  };
  const base=await serve(t,authConfig,mock);
  const login=await fetch(base+'/auth/login',{redirect:'manual'});
  assert.equal(login.status,302);assert.equal(authRequest.codeChallengeMethod,'S256');
  const pendingCookie=login.headers.get('set-cookie').split(';')[0];
  const invalid=await fetch(base+'/auth/redirect?state=bad&code=test',{headers:{cookie:pendingCookie}});
  assert.equal(invalid.status,400);
  const callback=await fetch(base+'/auth/redirect?state='+authRequest.state+'&code=test',{headers:{cookie:pendingCookie},redirect:'manual'});
  assert.equal(callback.status,302);assert.ok(codeRequest.codeVerifier);assert.equal(codeRequest.nonce,authRequest.nonce);
  const sessionCookie=callback.headers.get('set-cookie').split(';')[0];
  assert.notEqual(sessionCookie,pendingCookie);
  const session=await fetch(base+'/api/session',{headers:{cookie:sessionCookie}});
  assert.equal((await session.json()).user.email,'user@refer.com.br');
  assert.equal((await fetch(base+'/api/speakers',{method:'POST',headers:{cookie:sessionCookie},body:'{}'})).status,403);
  const logout=await fetch(base+'/auth/logout',{method:'POST',headers:{cookie:sessionCookie,origin:'http://localhost:3000'}});
  assert.equal(logout.status,200);
  assert.equal((await fetch(base+'/api/session',{headers:{cookie:sessionCookie}})).status,401);
});
test('nonce incorreto é rejeitado e não cria sessão autenticada',async t=>{
  let state;
  const base=await serve(t,authConfig,{getAuthCodeUrl:async request=>{state=request.state;return 'https://login.microsoftonline.com/example';},
    acquireTokenByCode:async()=>({idTokenClaims:{nonce:'wrong'}})});
  const start=await fetch(base+'/auth/login',{redirect:'manual'});
  const result=await fetch(base+'/auth/redirect?code=test&state='+state,{headers:{cookie:start.headers.get('set-cookie').split(';')[0]},redirect:'manual'});
  assert.equal(result.status,403);
});
test('vínculos não são enviados sem capacidade configurada',async t=>{
  const base=await serve(t,{TEAMS_FLOW_URL:'https://example.invalid'});
  const response=await fetch(base+'/api/teams',{method:'POST',body:JSON.stringify({speakerParticipations:[
    {speakerId:'1',modalidade:'ONLINE',remuneracao:'A_COMBINAR'}
  ]})});
  assert.equal(response.status,503);
  assert.equal((await fetch(base+'/api/teams',{method:'POST',body:'null'})).status,400);
});
test('resposta sem confirmação dos vínculos é parcial, não sucesso',async t=>{
  let forwarded;
  const upstream=http.createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;forwarded=JSON.parse(text);res.end(JSON.stringify({eventId:'99'}));});
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>upstream.close(resolve)));
  const base=await serve(t,{TEAMS_FLOW_URL:'http://127.0.0.1:'+upstream.address().port,EVENT_SPEAKERS_ENABLED:'true'});
  const response=await fetch(base+'/api/teams',{method:'POST',body:JSON.stringify({auditContext:{actorId:'forged'},speakerParticipations:[
    {speakerId:'1',modalidade:'ONLINE',remuneracao:'GRATUITA'}
  ]})});
  assert.equal(response.status,502);assert.equal((await response.json()).partial,true);
  assert.equal(forwarded.auditContext.actorId,null);
});
test('metadados não são ignorados pelo fluxo antigo; datas não vêm do cliente',async t=>{
  const base=await serve(t,{MANAGEMENT_FLOW_URL:'https://example.invalid'});
  const post=item=>fetch(base+'/api/speakers',{method:'POST',body:JSON.stringify({action:'create',item})});
  assert.equal((await post({nome:'Teste',areaResponsavel:'GEPES'})).status,503);
  assert.equal((await post({nome:'Teste',dataValidacao:'1999-01-01'})).status,400);
  assert.equal((await post({nome:'Teste',dadosBancarios:'sensitive'})).status,400);
});
test('auditoria guarda somente metadados e protege a consulta',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'audit-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const audit=createAudit({AUDIT_LOG_DIR:dir});
  audit.write({actor:{id:'1',email:'admin@refer.com.br',authenticated:true},action:'update',resource:'/api/speakers',recordId:'42',
    fields:['instituicao'],outcome:'success',body:{secret:'DO-NOT-STORE'},url:'https://secret.invalid?sig=DO-NOT-STORE'});
  const {items:rows}=await audit.query({});assert.equal(rows.length,1);
  assert.equal(JSON.stringify(rows).includes('DO-NOT-STORE'),false);
  const base=await serve(t,{AUDIT_LOG_DIR:dir});
  assert.equal((await fetch(base+'/api/audit')).status,403);
  assert.equal((await audit.query({from:'2020-01-01',to:'2099-01-01'})).total,1);
  await assert.rejects(audit.query({from:'2026-02-30'}),/válido/);
});
