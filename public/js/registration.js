(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const capabilities = window.registrationCapabilities = {eventSpeakers:false,speakerMetadata:false};
  const selected = new Map();
  const actionNames={create:'Inclusão',update:'Alteração',delete:'Exclusão',sync:'Sincronização',replaceForSpeaker:'Atualização de participações'};
  const outcomeNames={started:'Iniciada',success:'Concluída',failed:'Falhou',partial:'Parcial',unknown:'Indeterminada'};
  const resourceNames={'/api/speakers':'Palestrantes','/api/teams':'Calendário/Teams','/api/managed-events':'Eventos','/api/participations':'Participações','/api/wordpress/events':'Publicação no site'};
  const fieldNames={nome:'Nome',nomeProfissional:'Nome profissional',areaDeAtuacao:'Área de atuação',numeroTelefone:'Telefone',email:'E-mail',instituicao:'Instituição',localidade:'Localidade',fonteDoContato:'Fonte do contato',areaResponsavel:'Área responsável',situacaoCadastro:'Situação',validarAgora:'Confirmação de validação',dataValidacao:'Data de validação'};
  let records = [], loading = false;
  const errorText = (node,error) => {node.textContent=error.message;node.classList.add('is-error');};
  const message = $('eventSpeakersFeedback');
  const field = (label,control) => {const node=document.createElement('label');node.append(document.createTextNode(label),control);return node;};
  function select(options,value,onChange) {
    const node=document.createElement('select');
    for(const [key,text] of options) {const option=document.createElement('option');option.value=key;option.textContent=text;node.append(option);}
    node.value=value;node.addEventListener('change',()=>onChange(node.value));return node;
  }
  function review() {
    let section=$('speakerReview');
    if(!section) {section=document.createElement('section');section.id='speakerReview';section.className='speaker-review';$('reviewTitle').parentElement.append(section);}
    section.replaceChildren();
    const heading=document.createElement('h3');heading.textContent='Palestrantes';section.append(heading);
    const text=document.createElement('p');
    text.textContent=$('eventHasSpeakers').value!=='yes'?'Evento sem palestrantes.':
      [...selected.values()].map(item=>item.speaker.nome+(item.remuneracao==='GRATUITA'?' — participação gratuita':item.remuneracao==='REMUNERADA'?' — participação remunerada':' — condições a combinar')).join('; ') || 'Nenhum palestrante selecionado.';
    section.append(text);
  }
  function draw() {
    const target=$('selectedEventSpeakers');target.replaceChildren();
    for(const [id,item] of selected) {
      const card=document.createElement('div');card.className='selected-speaker-card';
      const title=document.createElement('strong');title.textContent=item.speaker.nome;card.append(title);
      const remove=document.createElement('button');remove.type='button';remove.className='management-action-button';
      remove.textContent='Remover';remove.setAttribute('aria-label','Remover '+item.speaker.nome);
      remove.addEventListener('click',()=>{selected.delete(id);draw();populate();});card.append(remove);
      const conditions=document.createElement('div');conditions.className='participation-fields';
      conditions.append(field('Modalidade',select([['PRESENCIAL','Presencial'],['ONLINE','Online'],['HIBRIDA','Híbrida']],item.modalidade,value=>{item.modalidade=value;review();})));
      conditions.append(field('Condições de participação',select([['A_COMBINAR','A combinar'],['GRATUITA','Gratuita'],['REMUNERADA','Remunerada']],item.remuneracao,value=>{item.remuneracao=value;item.faixaDeValor='';draw();})));
      if(item.remuneracao==='REMUNERADA')conditions.append(field('Faixa de valor',select([['','Selecione'],['ATE_500','Até R$ 500'],['DE_501_A_1000','R$ 501 a R$ 1.000'],['DE_1001_A_3000','R$ 1.001 a R$ 3.000'],['ACIMA_3000','Acima de R$ 3.000']],item.faixaDeValor,value=>{item.faixaDeValor=value;review();})));
      card.append(conditions);target.append(card);
    }
    review();
  }
  function populate() {
    const query=$('speakerSearch').value.trim().toLocaleLowerCase('pt-BR');
    const picker=$('eventSpeakerPicker');picker.replaceChildren(new Option('Selecione',''));
    for(const speaker of records) {
      if(speaker.situacaoCadastro==='ARQUIVADO' || selected.has(String(speaker.id)))continue;
      if(query && !(speaker.nome+' '+(speaker.areaDeAtuacao||'')).toLocaleLowerCase('pt-BR').includes(query))continue;
      picker.append(new Option(speaker.nome+(speaker.areaDeAtuacao?' — '+speaker.areaDeAtuacao:''),String(speaker.id)));
    }
  }
  function add(speaker) {
    if(selected.size>=20){showToast('Selecione no máximo 20 palestrantes.','error');return;}
    selected.set(String(speaker.id),{speaker,modalidade:'ONLINE',remuneracao:'A_COMBINAR',faixaDeValor:''});draw();populate();
  }
  async function load() {
    if(loading)return;loading=true;message.textContent='Carregando palestrantes…';message.classList.remove('is-error');
    try {
      const result=await requestManagementFlow('/api/speakers',{action:'list'});
      records=(Array.isArray(result.items)?result.items:[]).filter(item=>item && item.id && item.nome);
      populate();
      message.textContent=capabilities.eventSpeakers?'Selecione um ou mais palestrantes.':
        'Preparação disponível. O envio com vínculos será liberado após a atualização do Power Automate.';
    }catch(error){errorText(message,error);}finally{loading=false;}
  }
  $('eventHasSpeakers').addEventListener('change',()=>{
    const active=$('eventHasSpeakers').value==='yes';$('eventSpeakerOptions').hidden=!active;
    if(active)load();review();
  });
  $('speakerSearch').addEventListener('input',populate);
  $('addEventSpeaker').addEventListener('click',()=>{
    const speaker=records.find(item=>String(item.id)===$('eventSpeakerPicker').value);
    if(!speaker){showToast('Selecione um palestrante.','error');return;}add(speaker);
  });
  window.eventSpeakers={
    serialize() {
      if($('eventHasSpeakers').value!=='yes')return [];
      if(!selected.size)throw new Error('Adicione pelo menos um palestrante ou selecione “Não”.');
      return [...selected].map(([speakerId,item])=>{
        if(item.remuneracao==='REMUNERADA'&&!item.faixaDeValor)throw new Error('Selecione a faixa de valor de '+item.speaker.nome+'.');
        return {speakerId,modalidade:item.modalidade,remuneracao:item.remuneracao,faixaDeValor:item.faixaDeValor};
      });
    }
  };
  $('wizardNext').addEventListener('click',review);
  const quick=$('speakerQuickDialog'),panel=$('speakerFormPanel'),home=panel.parentElement,anchor=panel.nextSibling;
  let returnFocus;
  function closeQuick() {
    if(!window.speakerDialogContext.active)return;
    home.insertBefore(panel,anchor);$('speakerEventsField').hidden=false;
    window.speakerDialogContext.active=false;
    if(quick.open)quick.close();clearSpeakerForm();returnFocus?.focus();
  }
  window.speakerDialogContext={active:false,saved(speaker){
    records.push(speaker);
    if(speaker.situacaoCadastro!=='ARQUIVADO')add(speaker);
    closeQuick();
    showToast(speaker.situacaoCadastro==='ARQUIVADO'?'Cadastro arquivado salvo. Ele não foi selecionado para o evento.':
      'Palestrante cadastrado e selecionado. O vínculo será concluído ao criar o evento.','success');
  }};
  $('newEventSpeaker').addEventListener('click',()=>{
    returnFocus=document.activeElement;clearSpeakerForm();window.speakerDialogContext.active=true;
    $('speakerEventsField').hidden=true;$('speakerQuickBody').append(panel);quick.showModal();$('speakerName').focus();
  });
  $('closeSpeakerQuick').addEventListener('click',closeQuick);
  quick.addEventListener('cancel',event=>{event.preventDefault();closeQuick();});
  quick.addEventListener('close',closeQuick);
  function selectValue(id,value) {
    const node=$(id);if(value && ![...node.options].some(option=>option.value===value))node.append(new Option('Valor existente: '+value,value));
    node.value=value || (id==='speakerStatus'?'ATIVO':'');
  }
  window.speakerExtras={
    serialize() {
      const item={};
      if(capabilities.speakerMetadata || $('speakerSource').value || $('speakerOwnerArea').value ||
         $('speakerStatus').value!=='ATIVO' || $('speakerValidateNow').checked) {
        Object.assign(item,{fonteDoContato:$('speakerSource').value,areaResponsavel:$('speakerOwnerArea').value,
          situacaoCadastro:$('speakerStatus').value,validarAgora:$('speakerValidateNow').checked});
      }
      return item;
    },
    validate() {
      const hasExtras=Object.keys(this.serialize()).length>0;
      if(hasExtras&&!capabilities.speakerMetadata){showToast('Os novos campos precisam ser habilitados no fluxo antes de salvar.','error');return false;}
      if(capabilities.speakerMetadata && (!$('speakerOwnerArea').value || !$('speakerSource').value)){
        showToast('Informe a fonte do contato e a área responsável pelo cadastro.','error');return false;
      }
      return true;
    },
    hydrate(speaker) {
      selectValue('speakerSource',speaker.fonteDoContato || speaker.fonteDeContato);
      selectValue('speakerOwnerArea',speaker.areaResponsavel);
      selectValue('speakerStatus',speaker.situacaoCadastro);
      $('speakerValidateNow').checked=false;
      const date=value=>{const parsed=new Date(value);return !value || Number.isNaN(parsed.getTime())?'Não informada':parsed.toLocaleDateString('pt-BR');};
      $('speakerValidationDates').textContent='Inclusão: '+date(speaker.dataInclusao || speaker.created)+' • Última validação: '+date(speaker.dataValidacao);
      const last=new Date(speaker.dataValidacao);const threshold=new Date();threshold.setFullYear(threshold.getFullYear()-1);
      if(!speaker.dataValidacao || last<threshold)$('speakerValidationDates').textContent+=' • Revisão pendente.';
    },
    reset() {$('speakerValidationDates').textContent='Data de inclusão e última validação serão registradas pelo servidor/SharePoint.';}
  };
  fetch('/api/session').then(async response=>{
    if(!response.ok)throw new Error('Não foi possível verificar a sessão.');
    const result=await response.json();Object.assign(capabilities,result.capabilities);
    $('openAuditLogs').hidden=!result.user.canViewLogs;
    const account=document.querySelector('.topbar-account');
    const label=document.createElement('span');label.className='session-label';
    label.textContent=result.user.authenticated?result.user.name:'Desenvolvimento • sem autenticação';account.replaceChildren(label);
    if(result.user.authenticated) {
      const logout=document.createElement('button');logout.type='button';logout.className='management-action-button';logout.textContent='Sair';
      logout.addEventListener('click',async()=>{const response=await fetch('/auth/logout',{method:'POST'});if(response.ok)location.assign('/');else showToast('Não foi possível encerrar a sessão.','error');});account.append(logout);
    }
    $('speakerMetadataNotice').textContent=capabilities.speakerMetadata?'Registre somente informações profissionais úteis ao contato e à seleção.':
      'Campos adicionais em preparação: não serão enviados até o fluxo de gerenciamento ser atualizado.';
    if($('eventHasSpeakers').value==='yes')load();
  }).catch(error=>showToast(error.message,'error'));
})();
