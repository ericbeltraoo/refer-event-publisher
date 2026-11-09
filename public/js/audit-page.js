(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const actions={create:'Inclusão',update:'Alteração',delete:'Exclusão',sync:'Sincronização',replaceForSpeaker:'Atualização de participações'};
  const outcomes={started:'Iniciada',success:'Concluída',failed:'Falhou',partial:'Parcial',unknown:'Indeterminada'};
  const resources={'/api/speakers':'Palestrantes','/api/managed-events':'Eventos','/api/participations':'Participações','/api/teams':'Calendário/Teams','/api/wordpress/events':'Publicação no site'};
  const fieldNames={nome:'Nome',nomeProfissional:'Nome profissional',areaDeAtuacao:'Área de atuação',numeroTelefone:'Telefone',email:'E-mail',instituicao:'Instituição',localidade:'Localidade',fonteDoContato:'Fonte do contato',areaResponsavel:'Área responsável',situacaoCadastro:'Situação',validarAgora:'Confirmação da revisão',dataValidacao:'Data de validação'};
  let page=1,pages=1,snapshot='',activeFilters={},requestNumber=0,controller;
  const text=(tag,value,className)=>{const node=document.createElement(tag);node.textContent=value??'—';if(className)node.className=className;return node;};
  function params() {
    const result=new URLSearchParams(activeFilters);
    result.set('page',String(page));result.set('pageSize',$('auditPageSize').value);
    if(snapshot)result.set('snapshot',snapshot);return result;
  }
  function clearRows(message) {
    const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=7;
    cell.append(text('p',message,'audit-empty'));row.append(cell);$('auditRows').replaceChildren(row);
  }
  function details(item) {
    const panel=document.createElement('details');panel.className='audit-record-details';
    panel.append(text('summary','Ver detalhes'));
    const values=[
      ['Identificador da auditoria',item.id],['Correlação da operação',item.requestId],
      ['Identificador do usuário',item.actor?.id],['Identidade autenticada',item.actor?.authenticated?'Sim':'Não — desenvolvimento'],
      ['Data e hora em UTC',item.timestamp],['Resultado',outcomes[item.outcome]||item.outcome],
      ['Status HTTP',item.status||'Operação iniciada'],['Campos envolvidos',(item.fields||[]).map(key=>fieldNames[key]||key).join(', ')||'Não informado']
    ];
    const list=document.createElement('dl');
    for(const [name,value] of values)list.append(text('dt',name),text('dd',value||'—'));
    panel.append(list);return panel;
  }
  async function load(reset=false) {
    if(reset){page=1;snapshot='';activeFilters=Object.fromEntries(new FormData($('auditFilter')));}
    controller?.abort();controller=new AbortController();const number=++requestNumber;
    $('auditFeedback').textContent='Consultando registros de auditoria…';$('auditFeedback').classList.remove('is-error');
    $('auditPrevious').disabled=true;$('auditNext').disabled=true;$('exportAudit').setAttribute('aria-disabled','true');
    try {
      const response=await fetch('/api/audit?'+params(),{signal:controller.signal});
      const data=await response.json();
      if(!response.ok)throw new Error(data.message||'Não foi possível consultar a auditoria.');
      if(number!==requestNumber)return;
      snapshot=data.snapshot;pages=data.pages;
      if(page>pages){page=pages;return load();}
      $('auditTotal').textContent=data.total.toLocaleString('pt-BR');
      $('auditSuccess').textContent=data.summary.success.toLocaleString('pt-BR');
      $('auditProblems').textContent=(data.summary.failed+data.summary.partial).toLocaleString('pt-BR');
      $('auditPending').textContent=(data.summary.started+data.summary.unknown).toLocaleString('pt-BR');
      $('auditRows').replaceChildren();
      for(const item of data.items) {
        const row=document.createElement('tr'),when=new Date(item.timestamp);
        for(const value of [when.toLocaleString('pt-BR'),item.actor?.authenticated?item.actor.email:'Não autenticado (desenvolvimento)',
          resources[item.resource]||item.resource,actions[item.action]||item.action,item.recordId||'—'])row.append(text('td',value));
        const status=document.createElement('td');
        status.append(text('span',outcomes[item.outcome]||item.outcome,'audit-badge audit-badge--'+(Object.hasOwn(outcomes,item.outcome)?item.outcome:'unknown')));row.append(status);
        const extra=document.createElement('td');extra.append(details(item));row.append(extra);$('auditRows').append(row);
      }
      if(!data.items.length)clearRows(data.enabled?'Nenhum registro encontrado para estes filtros.':'A auditoria não está habilitada neste ambiente.');
      const first=data.total?(page-1)*data.pageSize+1:0,last=Math.min(page*data.pageSize,data.total);
      $('auditFeedback').textContent='Exibindo '+first+'–'+last+' de '+data.total.toLocaleString('pt-BR')+' registros. Consulta em '+new Date(snapshot).toLocaleString('pt-BR')+'.'+
        (data.corruptLines?' Atenção: '+data.corruptLines+' linha(s) inválida(s) no armazenamento; solicite verificação à TI.':'');
      $('auditPageInfo').textContent='Página '+page+' de '+pages;
      $('auditPrevious').disabled=page<=1;$('auditNext').disabled=page>=pages;
      $('exportAudit').href='/api/audit/export?'+params();$('exportAudit').removeAttribute('aria-disabled');
    }catch(error) {
      if(error.name==='AbortError'||number!==requestNumber)return;
      clearRows('Não foi possível carregar os registros.');$('auditFeedback').textContent=error.message;$('auditFeedback').classList.add('is-error');
      for(const id of ['auditTotal','auditSuccess','auditProblems','auditPending'])$(id).textContent='—';
    }
  }
  $('auditFilter').addEventListener('submit',event=>{event.preventDefault();load(true);});
  $('clearAuditFilters').addEventListener('click',()=>{$('auditFilter').reset();load(true);});
  $('refreshAudit').addEventListener('click',()=>load(true));
  $('auditPageSize').addEventListener('change',()=>{page=1;load();});
  $('auditPrevious').addEventListener('click',()=>{if(page>1){page--;load();}});
  $('auditNext').addEventListener('click',()=>{if(page<pages){page++;load();}});
  $('exportAudit').addEventListener('click',event=>{if($('exportAudit').getAttribute('aria-disabled')==='true')event.preventDefault();});
  window.auditPage={open:()=>load(true)};
  if(location.hash==='#/logs')load(true);
})();
