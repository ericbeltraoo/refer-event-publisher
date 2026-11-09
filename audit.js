const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
async function* reverseLines(filename) {
  const handle=await fs.promises.open(filename,'r');
  try {
    let position=(await handle.stat()).size,carry='';
    while(position>0) {
      const length=Math.min(65536,position);position-=length;
      const buffer=Buffer.alloc(length);await handle.read(buffer,0,length,position);
      const lines=(buffer.toString('latin1')+carry).split('\n');carry=lines.shift();
      for(let i=lines.length-1;i>=0;i--)if(lines[i].trim())yield Buffer.from(lines[i],'latin1').toString('utf8');
    }
    if(carry.trim())yield Buffer.from(carry,'latin1').toString('utf8');
  }finally{await handle.close();}
}
function invalid(message){const error=new Error(message);error.statusCode=400;throw error;}
function normalize(input={}) {
  const valid=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  const from=input.from||'',to=input.to||'';
  if(from&&!valid(from)||to&&!valid(to)||from&&to&&from>to)invalid('Informe um intervalo de datas válido.');
  const page=Number(input.page==null||input.page===''?1:input.page),pageSize=Number(input.pageSize==null||input.pageSize===''?50:input.pageSize);
  if(!Number.isSafeInteger(page)||page<1||![25,50,100].includes(pageSize))invalid('Paginação inválida.');
  const snapshot=input.snapshot||new Date().toISOString();
  if(Number.isNaN(Date.parse(snapshot))||Date.parse(snapshot)>Date.now()+60000)invalid('Referência de consulta inválida.');
  for(const key of ['user','action','resource','outcome','recordId','requestId'])if(String(input[key]||'').length>200)invalid('Filtro muito extenso.');
  return {...input,from,to,page,pageSize,snapshot};
}
function csv(value){let text=String(value??'');if(/^\s*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
function createAudit(config) {
  const dir=config.AUDIT_LOG_DIR;if(dir)fs.mkdirSync(dir,{recursive:true,mode:0o700});
  async function* matching(filters) {
    if(!dir)return;
    const files=(await fs.promises.readdir(dir)).filter(file=>/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)&&(!filters.from||file.slice(0,10)>=filters.from)&&(!filters.to||file.slice(0,10)<=filters.to)).sort().reverse();
    for(const file of files)for await(const line of reverseLines(path.join(dir,file))) {
      let row;try{row=JSON.parse(line);}catch{yield {corrupt:true};continue;}
      if(!row||typeof row!=='object'||typeof row.timestamp!=='string'||Number.isNaN(Date.parse(row.timestamp))){yield {corrupt:true};continue;}
      if(Date.parse(row.timestamp)>Date.parse(filters.snapshot))continue;
      if(filters.user&&!String(row.actor?.email||'').toLowerCase().includes(filters.user.toLowerCase()))continue;
      if(filters.action&&row.action!==filters.action||filters.resource&&row.resource!==filters.resource||filters.outcome&&row.outcome!==filters.outcome)continue;
      if(filters.recordId&&!String(row.recordId||'').includes(filters.recordId)||filters.requestId&&!String(row.requestId||'').includes(filters.requestId))continue;
      yield {row};
    }
  }
  return {
    enabled:Boolean(dir),
    write(entry) {
      if(!dir)return;const timestamp=new Date().toISOString();
      const clean={id:crypto.randomUUID(),timestamp,requestId:entry.requestId,
        actor:{id:entry.actor?.id||null,email:entry.actor?.email||null,authenticated:entry.actor?.authenticated===true},
        resource:entry.resource,action:entry.action,recordId:String(entry.recordId||'').slice(0,100),
        fields:Array.isArray(entry.fields)?entry.fields.filter(value=>/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/.test(value)).slice(0,30):[],outcome:entry.outcome,status:entry.status};
      fs.appendFileSync(path.join(dir,timestamp.slice(0,10)+'.jsonl'),JSON.stringify(clean)+'\n',{mode:0o600});
    },
    async query(input) {
      const filters=normalize(input),items=[],summary={started:0,success:0,failed:0,partial:0,unknown:0};let total=0,corruptLines=0;
      const offset=(filters.page-1)*filters.pageSize;
      for await(const result of matching(filters)) {
        if(result.corrupt){corruptLines++;continue;}
        if(total>=offset&&items.length<filters.pageSize)items.push(result.row);
        total++;if(Object.hasOwn(summary,result.row.outcome))summary[result.row.outcome]++;
      }
      return {enabled:Boolean(dir),items,total,page:filters.page,pageSize:filters.pageSize,pages:Math.max(1,Math.ceil(total/filters.pageSize)),summary,snapshot:filters.snapshot,corruptLines};
    },
    async exportCsv(input,response) {
      const filters=normalize(input);
      response.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="auditoria.csv"','Cache-Control':'no-store'});
      async function write(text){
        if(response.destroyed)throw new Error('Exportação cancelada.');
        if(!response.write(text))await new Promise((resolve,reject)=>{
          const cleanup=()=>{response.off('drain',drain);response.off('close',close);response.off('error',fail);};
          const drain=()=>{cleanup();resolve();};
          const close=()=>{cleanup();reject(new Error('Exportação cancelada.'));};
          const fail=error=>{cleanup();reject(error);};
          response.once('drain',drain);response.once('close',close);response.once('error',fail);
        });
      }
      await write('\uFEFF'+['Data UTC','Usuário','ID do usuário','Autenticado','Recurso','Operação','ID do registro','Campos','Resultado','Status HTTP','Correlação','ID da auditoria'].map(csv).join(';')+'\r\n');
      for await(const result of matching(filters)) {
        if(result.corrupt)continue;const row=result.row;
        await write([row.timestamp,row.actor?.email,row.actor?.id,row.actor?.authenticated===true?'Sim':'Não',row.resource,row.action,row.recordId,(Array.isArray(row.fields)?row.fields:[]).join(', '),row.outcome,row.status,row.requestId,row.id].map(csv).join(';')+'\r\n');
      }
      response.end();
    }
  };
}
module.exports={createAudit};
