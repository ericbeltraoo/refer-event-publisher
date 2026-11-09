const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createAudit}=require('../audit');
const {createServer}=require('../server');
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'audit-page-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('consulta todo arquivo acima de 4 MiB, pagina além de 500 e preserva UTF-8',async t=>{
  const dir=temp(t),audit=createAudit({AUDIT_LOG_DIR:dir});
  const timestamp='2026-01-01T12:00:00.000Z';
  const rows=Array.from({length:3200},(_,index)=>JSON.stringify({id:String(index),timestamp,recordId:String(index),
    actor:{email:'pessoa@refer.com.br',authenticated:true},resource:'/api/speakers',action:'update',fields:Array(30).fill('Área de atuação — confirmação de validação de cadastro profissional'),outcome:'success',requestId:'op-'+index}));
  fs.writeFileSync(path.join(dir,'2026-01-01.jsonl'),rows.join('\n')+'\n');
  assert.ok(fs.statSync(path.join(dir,'2026-01-01.jsonl')).size>4*1024*1024);
  const first=await audit.query({pageSize:100});
  assert.equal(first.total,3200);assert.equal(first.pages,32);assert.equal(first.items[0].id,'3199');
  const last=await audit.query({page:32,pageSize:100,snapshot:first.snapshot});
  assert.equal(last.items.at(-1).id,'0');assert.match(last.items[0].fields[0],/Área de atuação/);
  const filtered=await audit.query({recordId:'3199',requestId:'op-3199',resource:'/api/speakers',action:'update',outcome:'success',user:'PESSOA@REFER'});
  assert.equal(filtered.total,1);assert.equal(filtered.summary.success,1);
  const snapshot=first.snapshot;
  fs.appendFileSync(path.join(dir,'2026-01-01.jsonl'),JSON.stringify({id:'new',timestamp:'2090-01-01T00:00:00Z'})+'\n');
  assert.equal((await audit.query({snapshot})).total,3200);
});
test('datas sem corte de 31 dias; parâmetros inválidos rejeitados; corrupção sinalizada',async t=>{
  const dir=temp(t),audit=createAudit({AUDIT_LOG_DIR:dir});
  fs.writeFileSync(path.join(dir,'2020-01-01.jsonl'),JSON.stringify({id:'old',timestamp:'2020-01-01T12:00:00Z',actor:{},outcome:'failed'})+'\nnot-json\n');
  const result=await audit.query({from:'2019-01-01',to:'2026-12-31'});
  assert.equal(result.total,1);assert.equal(result.corruptLines,1);
  await assert.rejects(audit.query({page:0}),/Paginação/);
  await assert.rejects(audit.query({pageSize:999}),/Paginação/);
  await assert.rejects(audit.query({from:'2026-02-30'}),/válido/);
});
test('API restringe consulta/exportação; CSV exporta todos os resultados e neutraliza fórmulas',async t=>{
  const dir=temp(t),audit=createAudit({AUDIT_LOG_DIR:dir});
  for(let index=0;index<125;index++)audit.write({recordId:index,actor:{email:'=formula@refer.com.br',authenticated:true},resource:'/api/speakers',action:'create',outcome:'success',requestId:'test-'+index});
  const server=createServer({config:{AUDIT_LOG_DIR:dir,LOCAL_AUDIT_VIEW:'true'}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const page=await (await fetch(base+'/api/audit?pageSize=25')).json();
  assert.equal(page.items.length,25);assert.equal(page.total,125);
  const response=await fetch(base+'/api/audit/export?pageSize=25&snapshot='+encodeURIComponent(page.snapshot));
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/csv/);
  const csv=await response.text();assert.equal(csv.trim().split('\r\n').length,126);assert.match(csv,/'=formula/);
  assert.equal((await fetch(base+'/api/audit/export?from=bad')).status,400);
  const restricted=createServer({config:{AUDIT_LOG_DIR:dir}});
  await new Promise(resolve=>restricted.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>restricted.close(resolve)));
  assert.equal((await fetch('http://127.0.0.1:'+restricted.address().port+'/api/audit/export')).status,403);
});
