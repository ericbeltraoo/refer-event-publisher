// --- Lógica do Editor Estilo Teams ---
    const dashboardView = document.getElementById('dashboardView');
    const eventView = document.getElementById('eventView');
    const eventCategoryView = document.getElementById('eventCategoryView');
    const eventHistoryView = document.getElementById('eventHistoryView');
    const speakerCategoryView = document.getElementById('speakerCategoryView');
    const speakerFormView = document.getElementById('speakerFormView');
    const speakerHistoryView = document.getElementById('speakerHistoryView');
    let currentView = 'dashboard';
    let previousView = 'dashboard';
    let pendingSpeakerEventIds = [];
    let speakerEditRequested = false;

    const VIEW_ROUTES = {
      dashboard: '#/painel',
      eventCategory: '#/eventos',
      event: '#/eventos/criar',
      eventHistory: '#/eventos/historico',
      speakerCategory: '#/palestrantes',
      speakerForm: '#/palestrantes/cadastro',
      speakerHistory: '#/palestrantes/historico'
    };
    const NAV_GROUPS = {
      eventCategory: ['event', 'eventHistory'],
      speakerCategory: ['speakerForm', 'speakerHistory']
    };

    function viewFromHash() {
      const match = Object.entries(VIEW_ROUTES).find(([, hash]) => hash === location.hash);
      return match ? match[0] : 'dashboard';
    }

    // Troca o endereço (#/...); o evento hashchange abre a tela. Assim F5 e o botão Voltar funcionam.
    function showView(view) {
      if (!VIEW_ROUTES[view]) return;
      if (location.hash === VIEW_ROUTES[view]) renderView(view);
      else location.hash = VIEW_ROUTES[view];
    }

    function renderView(view) {
      const views = {
        dashboard: dashboardView,
        event: eventView,
        eventCategory: eventCategoryView,
        eventHistory: eventHistoryView,
        speakerCategory: speakerCategoryView,
        speakerForm: speakerFormView,
        speakerHistory: speakerHistoryView
      };
      if (!views[view]) return;
      Object.entries(views).forEach(([name, element]) => {
        element.hidden = name !== view;
      });
      document.body.classList.remove('development-page-active');
      document.querySelectorAll('.nav-item').forEach(item => {
        const link = item.dataset.viewLink;
        const isActive = link === view || (NAV_GROUPS[link] || []).includes(view);
        item.classList.toggle('is-active', isActive);
        if (isActive) item.setAttribute('aria-current', 'page');
        else item.removeAttribute('aria-current');
      });
      currentView = view;
      if (view === 'eventHistory') startEventAutoRefresh();
      else stopEventAutoRefresh();
      views[view].querySelector('h1').focus();
      if (view === 'speakerForm') {
        if (!speakerEditRequested) clearSpeakerForm();
        speakerEditRequested = false;
        loadEventChoices(pendingSpeakerEventIds);
        pendingSpeakerEventIds = [];
      } else if (view === 'speakerHistory') {
        loadSpeakers();
        loadEventChoices();
      } else if (view === 'eventHistory') {
        loadManagedEvents();
      }
    }

    document.querySelectorAll('[data-view-link]:not(#eventBackButton)').forEach(link => {
      link.addEventListener('click', event => {
        event.preventDefault();
        const view = link.dataset.viewLink;
        if (view === currentView) return;
        previousView = currentView;
        showView(view);
      });
    });
    window.addEventListener('hashchange', () => renderView(viewFromHash()));
    const speakerForm = document.getElementById('speakerForm');
    const speakerHistoryRows = document.getElementById('speakerHistoryRows');
    const speakerHistoryFeedback = document.getElementById('speakerHistoryFeedback');
    const speakerFormFeedback = document.getElementById('speakerFormFeedback');
    const speakerFormPanel = document.getElementById('speakerFormPanel');
    const speakerHistoryPanel = document.getElementById('speakerHistoryPanel');
    const speakerEventsSelect = document.getElementById('speakerEvents');
    const eventHistoryRows = document.getElementById('eventHistoryRows');
    const eventHistoryFeedback = document.getElementById('eventHistoryFeedback');
    const eventEditDialog = document.getElementById('eventEditDialog');
    let speakerRecords = [];
    let eventRecords = [];
    let participationRecords = [];

    async function requestManagementFlow(endpoint, payload) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error(`Resposta inválida do fluxo (HTTP ${response.status}).`);
      }
      if (!response.ok) {
        throw new Error(result.message || `O fluxo retornou HTTP ${response.status}.`);
      }
      return result;
    }

    function fieldValue(id) {
      return document.getElementById(id).value.trim();
    }

    function setButtonLoading(button, loading, loadingText = 'Carregando...') {
      if (!button) return;
      if (loading) {
        button.dataset.originalLabel = button.textContent.trim();
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.classList.add('is-loading');
        button.replaceChildren();
        const spinner = document.createElement('span');
        spinner.className = 'btn-spinner';
        spinner.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.textContent = loadingText;
        button.append(spinner, label);
      } else {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.classList.remove('is-loading');
        button.textContent = button.dataset.originalLabel || button.textContent;
      }
    }

    function showConfirmDialog({ title, highlight = '', message, confirmText = 'Excluir', cancelText = 'Cancelar', onConfirm }) {
      const dialog = document.createElement('dialog');
      dialog.className = 'confirm-dialog';
      dialog.setAttribute('aria-labelledby', 'confirmDialogTitle');
      dialog.setAttribute('aria-describedby', 'confirmDialogMessage');
      dialog.innerHTML = `
        <div class="confirm-dialog__icon" aria-hidden="true">
          <span class="material-symbols-outlined">delete</span>
        </div>
        <h2 class="confirm-dialog__title" id="confirmDialogTitle"></h2>
        <p class="confirm-dialog__highlight"></p>
        <p class="confirm-dialog__message" id="confirmDialogMessage"></p>
        <p class="confirm-dialog__error" role="alert" hidden></p>
        <div class="confirm-dialog__actions">
          <button type="button" class="confirm-dialog__cancel"></button>
          <button type="button" class="confirm-dialog__confirm"></button>
        </div>`;

      const titleEl = dialog.querySelector('.confirm-dialog__title');
      const highlightEl = dialog.querySelector('.confirm-dialog__highlight');
      const messageEl = dialog.querySelector('.confirm-dialog__message');
      const errorEl = dialog.querySelector('.confirm-dialog__error');
      const cancelButton = dialog.querySelector('.confirm-dialog__cancel');
      const confirmButton = dialog.querySelector('.confirm-dialog__confirm');

      titleEl.textContent = title;
      highlightEl.textContent = highlight;
      highlightEl.hidden = !highlight;
      messageEl.textContent = message;
      cancelButton.textContent = cancelText;
      confirmButton.textContent = confirmText;

      const isBusy = () => confirmButton.getAttribute('aria-busy') === 'true';

      cancelButton.addEventListener('click', () => dialog.close());
      dialog.addEventListener('cancel', event => { if (isBusy()) event.preventDefault(); });
      dialog.addEventListener('click', event => { if (event.target === dialog && !isBusy()) dialog.close(); });
      dialog.addEventListener('close', () => dialog.remove());

      confirmButton.addEventListener('click', async () => {
        errorEl.hidden = true;
        setButtonLoading(confirmButton, true, 'Excluindo...');
        cancelButton.disabled = true;
        try {
          await onConfirm();
          dialog.close();
        } catch (error) {
          errorEl.textContent = error.message || 'Não foi possível concluir a exclusão.';
          errorEl.hidden = false;
        } finally {
          if (dialog.isConnected) {
            setButtonLoading(confirmButton, false);
            cancelButton.disabled = false;
          }
        }
      });

      document.body.appendChild(dialog);
      dialog.showModal();
      cancelButton.focus();
    }

    function setSpeakerFeedback(message, isError = false) {
      speakerHistoryFeedback.textContent = message;
      speakerHistoryFeedback.classList.toggle('is-error', isError);
    }

    function setSpeakerFormFeedback(message, isError = false) {
      speakerFormFeedback.textContent = message;
      speakerFormFeedback.classList.toggle('is-error', isError);
    }

    function speakerEventIds(speaker) {
      if (Array.isArray(speaker.eventIds)) return speaker.eventIds.map(String);
      return participationRecords
        .filter(row => String(row.speakerId) === String(speaker.id))
        .map(row => String(row.eventId));
    }

    function renderSpeakerRows() {
      speakerHistoryRows.replaceChildren();
      for (const speaker of speakerRecords) {
        const row = document.createElement('tr');
        const eventsCell = document.createElement('td');
        const linkedEvents = participationRecords
          .filter(item => String(item.speakerId) === String(speaker.id))
          .map(item => item.eventTitle || eventRecords.find(event => String(event.id) === String(item.eventId))?.title)
          .filter(Boolean);
        const eventsFromSpeaker = Array.isArray(speaker.events) ? speaker.events.map(item => item.title || item) : [];
        const eventNames = [...new Set([...linkedEvents, ...eventsFromSpeaker])];
        [
          speaker.nome || '',
          speaker.nomeProfissional || '',
          speaker.areaDeAtuacao || '',
          speaker.numeroTelefone || '',
          speaker.email || '',
          speaker.instituicao || '',
          speaker.localidade || ''
        ].forEach(value => {
          const cell = document.createElement('td');
          cell.textContent = value;
          row.appendChild(cell);
        });
        eventsCell.textContent = eventNames.length ? eventNames.join(', ') : 'Nenhum evento vinculado';
        row.appendChild(eventsCell);
        const actions = document.createElement('td');
        actions.className = 'management-row-actions';
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'management-action-button';
        editButton.textContent = 'Editar';
        editButton.addEventListener('click', () => editSpeaker(speaker));
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'management-action-button is-danger';
        deleteButton.textContent = 'Apagar';
        deleteButton.addEventListener('click', () => deleteSpeaker(speaker));
        actions.append(editButton, deleteButton);
        row.appendChild(actions);
        speakerHistoryRows.appendChild(row);
      }
    }

    async function loadSpeakers() {
      setSpeakerFeedback('Carregando palestrantes...');
      try {
        const [speakerResponse, participationResponse] = await Promise.all([
          requestManagementFlow('/api/speakers', { action: 'list' }),
          requestManagementFlow('/api/participations', { action: 'list' })
        ]);
        speakerRecords = Array.isArray(speakerResponse.items) ? speakerResponse.items : [];
        participationRecords = Array.isArray(participationResponse.items) ? participationResponse.items : [];
        renderSpeakerRows();
        setSpeakerFeedback(`${speakerRecords.length} palestrante(s) carregado(s).`);
        setSpeakerFormFeedback('');
      } catch (error) {
        setSpeakerFeedback(error.message, true);
      }
    }

    async function loadEventChoices(selectedIds = []) {
      try {
        const result = await requestManagementFlow('/api/managed-events', { action: 'list' });
        eventRecords = Array.isArray(result.items) ? result.items : [];
        const selected = new Set(selectedIds.map(String));
        speakerEventsSelect.replaceChildren();
        for (const record of eventRecords) {
          const option = document.createElement('option');
          option.value = String(record.id);
          option.textContent = record.title || record.titulo || '(Evento sem título)';
          option.selected = selected.has(option.value);
          speakerEventsSelect.appendChild(option);
        }
        if (!eventRecords.length) {
          const option = document.createElement('option');
          option.disabled = true;
          option.textContent = 'Nenhum evento disponível no histórico';
          speakerEventsSelect.appendChild(option);
        }
      } catch (error) {
        speakerEventsSelect.replaceChildren();
        const option = document.createElement('option');
        option.disabled = true;
        option.textContent = 'Não foi possível carregar os eventos';
        speakerEventsSelect.appendChild(option);
        setSpeakerFormFeedback(error.message, true);
      }
    }

    function clearSpeakerForm() {
      speakerForm.reset();
      document.getElementById('speakerRecordId').value = '';
      document.getElementById('speakerSaveButton').textContent = 'Salvar palestrante';
      document.getElementById('speakerCancelEdit').hidden = true;
      for (const option of speakerEventsSelect.options) option.selected = false;
    }

    function editSpeaker(speaker) {
      document.getElementById('speakerRecordId').value = speaker.id;
      document.getElementById('speakerName').value = speaker.nome || '';
      document.getElementById('speakerProfessionalName').value = speaker.nomeProfissional || '';
      document.getElementById('speakerArea').value = speaker.areaDeAtuacao || '';
      document.getElementById('speakerPhone').value = speaker.numeroTelefone || '';
      document.getElementById('speakerEmail').value = speaker.email || '';
      document.getElementById('speakerInstitution').value = speaker.instituicao || '';
      document.getElementById('speakerLocation').value = speaker.localidade || '';
      document.getElementById('speakerSaveButton').textContent = 'Atualizar palestrante';
      document.getElementById('speakerCancelEdit').hidden = false;
      //showSpeakerTab('form');
      //loadEventChoices(speakerEventIds(speaker));
      //document.getElementById('speakerName').focus();
      pendingSpeakerEventIds = speakerEventIds(speaker);
      speakerEditRequested = true;
      showView('speakerForm');
    }

    async function deleteSpeaker(speaker) {
      if (!window.confirm(`Apagar o cadastro de ${speaker.nome || 'palestrante'}? Os vínculos com eventos também serão removidos.`)) return;
      try {
        await requestManagementFlow('/api/speakers', { action: 'delete', id: String(speaker.id) });
        await loadSpeakers();
        showToast('Cadastro de palestrante apagado.', 'success');
      } catch (error) {
        setSpeakerFeedback(error.message, true);
        showToast(error.message, 'error');
      }
    }

    speakerForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!speakerForm.reportValidity()) return;
      const id = fieldValue('speakerRecordId');
      const item = {
        nome: fieldValue('speakerName'),
        nomeProfissional: fieldValue('speakerProfessionalName'),
        areaDeAtuacao: fieldValue('speakerArea'),
        numeroTelefone: fieldValue('speakerPhone'),
        email: fieldValue('speakerEmail'),
        instituicao: fieldValue('speakerInstitution'),
        localidade: fieldValue('speakerLocation')
      };
      const eventIds = Array.from(speakerEventsSelect.selectedOptions).map(option => option.value);
      const saveButton = document.getElementById('speakerSaveButton');
      const cancelButton = document.getElementById('speakerCancelEdit');
      setButtonLoading(saveButton, true);
      cancelButton.disabled = true;
      try {
        const saved = await requestManagementFlow('/api/speakers', {
          action: id ? 'update' : 'create',
          ...(id ? { id } : {}),
          item
        });
        const speakerId = String(saved.id || id || saved.item?.id || '');
        if (!speakerId) throw new Error('O fluxo salvou o palestrante, mas não retornou o ID necessário para vincular eventos.');
        await requestManagementFlow('/api/participations', {
          action: 'replaceForSpeaker',
          speakerId,
          eventIds
        });
        await Promise.all([loadSpeakers(), loadEventChoices()]);
        clearSpeakerForm();
        setSpeakerFormFeedback('');
        showToast('Cadastro de palestrante salvo.', 'success');
        if (id) showView('speakerHistory');
      } catch (error) {
        setSpeakerFormFeedback(error.message, true);
        setSpeakerFeedback(error.message, true);
        showToast(error.message, 'error');
      } finally {
        setButtonLoading(saveButton, false);
        saveButton.textContent = document.getElementById('speakerRecordId').value
          ? 'Atualizar palestrante'
          : 'Salvar palestrante';
        cancelButton.disabled = false;
      }
    });



    document.getElementById('speakerCancelEdit').addEventListener('click', () => {
      clearSpeakerForm();
      showView('speakerHistory');
    });
    document.getElementById('refreshSpeakers').addEventListener('click', loadSpeakers);

    function eventDateTime(event) {
      const start = event.start || event.dataHoraInicio || '';
      const end = event.end || event.dataHoraFim || '';
      if (!start) return event.dataApresentacao || '';
      const format = value => {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('pt-BR', {
          dateStyle: 'short',
          timeStyle: 'short'
        }).format(date);
      };
      return end ? `${format(start)} – ${format(end)}` : format(start);
    }

    function canManageCalendarEvent(record) {
      return Boolean(record.id && record.outlookEventId && record.organizerIsInfra === true);
    }

    function renderEventRows() {
      eventHistoryRows.replaceChildren();
      for (const record of eventRecords) {
        const row = document.createElement('tr');
        [record.title || record.titulo || '', eventDateTime(record), record.location || record.local || '', record.organizer || record.calendarioOrganizador || ''].forEach(value => {
          const cell = document.createElement('td');
          cell.textContent = value;
          row.appendChild(cell);
        });
        const actions = document.createElement('td');
        actions.className = 'management-row-actions';
        if (canManageCalendarEvent(record)) {
          const editButton = document.createElement('button');
          editButton.type = 'button';
          editButton.className = 'management-action-button';
          editButton.textContent = 'Editar';
          editButton.addEventListener('click', () => openEventEdit(record));
          const deleteButton = document.createElement('button');
          deleteButton.type = 'button';
          deleteButton.className = 'management-action-button is-danger';
          deleteButton.textContent = 'Apagar';
          deleteButton.addEventListener('click', () => deleteManagedEvent(record));
          actions.append(editButton, deleteButton);
        } else {
          actions.textContent = 'Somente consulta';
        }
        row.appendChild(actions);
        eventHistoryRows.appendChild(row);
      }
    }

    async function loadManagedEvents(sync = false) {
      eventHistoryFeedback.textContent = sync ? 'Sincronizando histórico do calendário...' : 'Carregando eventos...';
      eventHistoryFeedback.classList.remove('is-error');
      try {
        if (sync) {
          await requestManagementFlow('/api/managed-events', { action: 'sync' });
        }
        const result = await requestManagementFlow('/api/managed-events', { action: 'list' });
        eventRecords = Array.isArray(result.items) ? result.items : [];
        renderEventRows();
        eventHistoryFeedback.textContent = `${eventRecords.length} evento(s) no histórico.`;
        await loadEventChoices();
      } catch (error) {
        eventHistoryFeedback.textContent = error.message;
        eventHistoryFeedback.classList.add('is-error');
      }
    }

        let eventStream = null;
    let eventStreamOpenedOnce = false;
    let eventRefreshPending = false;
    let eventRefreshInFlight = false;

    async function refreshManagedEventsSilently() {
      const confirmOpen = document.querySelector('.confirm-dialog[open]');
      if (currentView !== 'eventHistory') return;
      if (eventEditDialog.open || confirmOpen) { eventRefreshPending = true; return; }
      if (eventRefreshInFlight) return;
      eventRefreshInFlight = true;
      eventRefreshPending = false;
      try {
        const result = await requestManagementFlow('/api/managed-events', { action: 'list' });
        const items = Array.isArray(result.items) ? result.items : [];
        if (JSON.stringify(items) !== JSON.stringify(eventRecords)) {
          eventRecords = items;
          renderEventRows();
          eventHistoryFeedback.textContent = `${eventRecords.length} evento(s) no histórico.`;
          eventHistoryFeedback.classList.remove('is-error');
        }
      } catch {
        // Falha silenciosa: o próximo aviso tenta de novo.
      } finally {
        eventRefreshInFlight = false;
      }
    }

    function startEventAutoRefresh() {
      stopEventAutoRefresh();
      eventStreamOpenedOnce = false;
      eventStream = new EventSource('/api/managed-events/stream');
      eventStream.addEventListener('events-changed', refreshManagedEventsSilently);
      eventStream.addEventListener('open', () => {
        if (eventStreamOpenedOnce) refreshManagedEventsSilently();
        eventStreamOpenedOnce = true;
      });
    }

    function stopEventAutoRefresh() {
      if (eventStream) eventStream.close();
      eventStream = null;
    }

    eventEditDialog.addEventListener('close', () => {
      if (eventRefreshPending) refreshManagedEventsSilently();
    });

    function toLocalInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}


    function openEventEdit(record) {
      document.getElementById('eventRecordId').value = record.id;
      document.getElementById('managedEventTitle').value = record.title || record.titulo || '';
      document.getElementById('managedEventDate').value = (record.dataApresentacao || '').slice(0, 10);
      document.getElementById('managedEventStart').value = toLocalInputValue(record.start || record.dataHoraInicio);
      document.getElementById('managedEventEnd').value = toLocalInputValue(record.end || record.dataHoraFim);
      document.getElementById('managedEventLocation').value = record.location || record.local || '';
      document.getElementById('managedEventFree').value = String(Boolean(record.indicacaoGratuidade));
      document.getElementById('managedEventFee').value = record.faixaDeValor ?? '';
      document.getElementById('managedEventContactSource').value = record.fonteDeContato || '';
      document.getElementById('managedEventStatus').value = record.statusValidacao || 'AGUARDANDO_CONFIRMACAO';
      document.getElementById('managedEventArea').value = record.areaResponsavel || 'GERIC';
      document.getElementById('managedEventMode').value = record.modalidade || 'PRESENCIAL';
      eventEditDialog.dataset.outlookEventId = record.outlookEventId;
      eventEditDialog.showModal();
    }

    document.getElementById('closeEventEdit').addEventListener('click', () => eventEditDialog.close());
    document.getElementById('eventEditForm').addEventListener('submit', async event => {
      event.preventDefault();
      const id = fieldValue('eventRecordId');
      const record = eventRecords.find(item => String(item.id) === id);
      if (!record || !canManageCalendarEvent(record)) {
        eventHistoryFeedback.textContent = 'Este item não está identificado como evento organizado pela Infra; não é possível alterá-lo.';
        eventHistoryFeedback.classList.add('is-error');
        eventEditDialog.close();
        return;
      }
      const item = {
        ...record,
        title: fieldValue('managedEventTitle'),
        dataApresentacao: fieldValue('managedEventDate'),
        start: fieldValue('managedEventStart'),
        end: fieldValue('managedEventEnd'),
        location: fieldValue('managedEventLocation'),
        indicacaoGratuidade: document.getElementById('managedEventFree').value === 'true',
        faixaDeValor: document.getElementById('managedEventFee').value
          ? Number(document.getElementById('managedEventFee').value)
          : null,
        fonteDeContato: fieldValue('managedEventContactSource'),
        statusValidacao: document.getElementById('managedEventStatus').value,
        areaResponsavel: document.getElementById('managedEventArea').value,
        modalidade: document.getElementById('managedEventMode').value,
        outlookEventId: record.outlookEventId
      };

      const saveButton = event.currentTarget.querySelector('button[type="submit"]');
      const closeButton = document.getElementById('closeEventEdit');
      setButtonLoading(saveButton, true);
      if (closeButton) closeButton.disabled = true;
      try {
        await requestManagementFlow('/api/managed-events', { action: 'update', id, item });
        eventEditDialog.close();
        await loadManagedEvents();
        showToast('Evento atualizado no calendário e no histórico.', 'success');
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        setButtonLoading(saveButton, false);
        if (closeButton) closeButton.disabled = false;
      }
    });

    eventEditDialog.addEventListener('cancel', event => {
      if (eventEditDialog.querySelector('[aria-busy="true"]')) event.preventDefault();
    });

    function deleteManagedEvent(record) {
      if (!canManageCalendarEvent(record)) return;
      showConfirmDialog({
        title: 'Excluir evento?',
        highlight: record.title || record.titulo || 'Evento sem título',
        message: 'O evento será removido do calendário da Infra e do histórico. Esta ação não pode ser desfeita.',
        confirmText: 'Excluir evento',
        onConfirm: async () => {
          await requestManagementFlow('/api/managed-events', {
            action: 'delete',
            id: String(record.id),
            outlookEventId: record.outlookEventId
          });
          await loadManagedEvents();
          showToast('Evento excluído do calendário e do histórico.', 'success');
        }
      });
    }

    document.getElementById('refreshEvents').addEventListener('click', () => loadManagedEvents(true));

    const wizardForm = document.getElementById('formEvento');
    const wizardPanels = Array.from(document.querySelectorAll('[data-wizard-step]'));
    const wizardStepButtons = Array.from(document.querySelectorAll('[data-step-button]'));
    const wizardPrevious = document.getElementById('wizardPrevious');
    const wizardNext = document.getElementById('wizardNext');
    const wizardSubmit = document.getElementById('btnEnviar');
    const wizardCalendarSubmit = document.getElementById('btnEnviarCalendario');
    const eventBackButton = document.getElementById('eventBackButton');
    const eventPageTitle = document.getElementById('eventPageTitle');
    const eventPageDescription = document.getElementById('eventPageDescription');
    const toastStack = document.getElementById('toastStack');
    const toastTimers = new WeakMap();
    const participantInput = document.getElementById('participantesInput');
    const participantValue = document.getElementById('participantes');
    const participantChips = document.getElementById('participantesChips');
    const eventDateInput = document.getElementById('dataEvento');
    const eventDateButton = document.getElementById('dataEventoButton');
    const eventDateLabel = document.getElementById('dataEventoLabel');
    const eventDateCalendar = document.getElementById('dataEventoCalendar');
    const eventDateDays = document.getElementById('datePickerDays');
    const eventDateMonthLabel = document.getElementById('datePickerMonthLabel');
    let participantEmails = participantValue.value.split(/[;,]/).map(email => email.trim()).filter(Boolean);
    let datePickerMonth = new Date();
    datePickerMonth.setDate(1);
    let currentWizardStep = 1;
    let highestAvailableWizardStep = 1;

    function dateToISO(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    function formatEventDate(value) {
      if (!value) return '';
      const [year, month, day] = value.split('-').map(Number);
      return new Intl.DateTimeFormat('pt-BR').format(new Date(year, month - 1, day));
    }

    function syncEventDateLabel() {
      const formattedDate = formatEventDate(eventDateInput.value);
      eventDateLabel.textContent = formattedDate || 'dd/mm/aaaa';
      eventDateButton.setAttribute(
        'aria-label',
        formattedDate ? `Data do evento: ${formattedDate}` : 'Selecionar data do evento'
      );
      eventDateButton.classList.toggle('has-value', Boolean(eventDateInput.value));
      eventDateButton.removeAttribute('aria-invalid');
    }

    function renderDatePicker() {
      const year = datePickerMonth.getFullYear();
      const month = datePickerMonth.getMonth();
      const todayValue = dateToISO(new Date());
      const selectedValue = eventDateInput.value;
      const firstDay = new Date(year, month, 1);
      const gridStart = new Date(year, month, 1 - ((firstDay.getDay() + 6) % 7));
      const gridEnd = new Date(gridStart);
      gridEnd.setDate(gridEnd.getDate() + 41);
      const selectedDateInGrid = selectedValue && selectedValue >= dateToISO(gridStart) && selectedValue <= dateToISO(gridEnd);
      const todayInGrid = todayValue >= dateToISO(gridStart) && todayValue <= dateToISO(gridEnd);
      const focusValue = selectedDateInGrid ? selectedValue : todayInGrid ? todayValue : dateToISO(firstDay);
      eventDateMonthLabel.textContent = new Intl.DateTimeFormat('pt-BR', {
        month: 'long',
        year: 'numeric'
      }).format(firstDay);
      eventDateDays.replaceChildren();

      for (let index = 0; index < 42; index++) {
        const date = new Date(gridStart);
        date.setDate(gridStart.getDate() + index);
        const dateValue = dateToISO(date);
        const dayButton = document.createElement('button');
        dayButton.type = 'button';
        dayButton.className = 'date-picker-day';
        dayButton.setAttribute('aria-label', new Intl.DateTimeFormat('pt-BR', {
          dateStyle: 'full'
        }).format(date));
        dayButton.setAttribute('aria-pressed', String(dateValue === selectedValue));
        dayButton.tabIndex = dateValue === focusValue ? 0 : -1;
        dayButton.dataset.date = dateValue;
        dayButton.textContent = String(date.getDate());
        if (date.getMonth() !== month) dayButton.classList.add('is-outside-month');
        if (dateValue === todayValue) dayButton.classList.add('is-today');
        if (dateValue === selectedValue) dayButton.classList.add('is-selected');
        eventDateDays.appendChild(dayButton);
      }
    }

    function openDatePicker() {
      if (eventDateInput.value) {
        const [year, month] = eventDateInput.value.split('-').map(Number);
        datePickerMonth = new Date(year, month - 1, 1);
      } else {
        datePickerMonth = new Date();
        datePickerMonth.setDate(1);
      }
      renderDatePicker();
      eventDateCalendar.hidden = false;
      eventDateButton.setAttribute('aria-expanded', 'true');
      const triggerRect = eventDateButton.getBoundingClientRect();
      const calendarHeight = eventDateCalendar.offsetHeight;
      eventDateCalendar.classList.toggle(
        'is-above',
        triggerRect.bottom + calendarHeight > window.innerHeight - 12 && triggerRect.top > calendarHeight + 12
      );
      eventDateCalendar.classList.toggle(
        'is-right-aligned',
        triggerRect.left + eventDateCalendar.offsetWidth > window.innerWidth - 12
      );
      const verticalOverflow = triggerRect.bottom + calendarHeight - (window.innerHeight - 12);
      if (verticalOverflow > 0 && triggerRect.top <= calendarHeight + 12) {
        const availableScroll = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
        if (availableScroll > 0) {
          window.scrollBy({
            top: Math.min(verticalOverflow, availableScroll),
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
          });
        }
      }
      const focusDate = eventDateDays.querySelector('.is-selected') || eventDateDays.querySelector('.is-today');
      (focusDate || eventDateDays.querySelector('[tabindex="0"]'))?.focus({ preventScroll: true });
    }

    function closeDatePicker(restoreFocus = false) {
      eventDateCalendar.hidden = true;
      eventDateButton.setAttribute('aria-expanded', 'false');
      if (restoreFocus) eventDateButton.focus();
    }

    function showToast(message, type = 'info') {
      const toast = document.createElement('div');
      toast.className = `app-toast app-toast--${type}`;
      toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

      const icon = document.createElement('span');
      icon.className = 'material-symbols-outlined app-toast-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = { error: 'error', success: 'check_circle', warning: 'warning', info: 'info' }[type] || 'info';

      const text = document.createElement('p');
      text.textContent = message;

      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'app-toast-close';
      closeButton.setAttribute('aria-label', 'Dispensar notificação');
      closeButton.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">close</span>';
      closeButton.addEventListener('click', () => dismissToast(toast));

      toast.append(icon, text, closeButton);
      toastStack.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add('is-visible'));
      toastTimers.set(toast, window.setTimeout(() => dismissToast(toast), 5500));
    }

    function dismissToast(toast) {
      if (!toast.isConnected || toast.classList.contains('is-leaving')) return;
      window.clearTimeout(toastTimers.get(toast));
      toast.classList.add('is-leaving');
      window.setTimeout(() => toast.remove(), 240);
    }

    function showCalendarConflictDialog(emails) {
      if (!emails.length) return;
      const dialog = document.getElementById('calendarConflictDialog');
      const list = document.getElementById('calendarConflictEmails');
      list.replaceChildren(...emails.map(email => {
        const item = document.createElement('li');
        item.textContent = email;
        return item;
      }));
      dialog.showModal();
    }

    function renderParticipantChips() {
      participantChips.replaceChildren();
      participantEmails.forEach((email, index) => {
        const chip = document.createElement('li');
        chip.className = 'participant-chip';
        const address = document.createElement('span');
        address.textContent = email;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.dataset.removeParticipant = String(index);
        remove.setAttribute('aria-label', `Remover ${email}`);
        remove.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">close</span>';
        chip.append(address, remove);
        participantChips.appendChild(chip);
      });
      participantValue.value = participantEmails.join('; ');
      updateWizardReview();
    }

    function addParticipantEmails(rawValue) {
      const submitted = rawValue.split(/[;,]/).map(email => email.trim()).filter(Boolean);
      if (!submitted.length) return false;
      const invalidEmail = submitted.find(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
      if (invalidEmail) {
        showToast(`"${invalidEmail}" não parece ser um e-mail válido.`, 'error');
        return false;
      }
      const normalizedSubmitted = new Set();
      const duplicateEmail = submitted.find(email => {
        const normalized = email.toLowerCase();
        if (normalizedSubmitted.has(normalized) || participantEmails.some(existing => existing.toLowerCase() === normalized)) return true;
        normalizedSubmitted.add(normalized);
        return false;
      });
      if (duplicateEmail) {
        showToast(`O e-mail "${duplicateEmail}" já foi adicionado.`, 'warning');
        return false;
      }
      participantEmails.push(...submitted);
      renderParticipantChips();
      return true;
    }

    function commitParticipantInput() {
      const typedValue = participantInput.value.trim();
      if (!typedValue) return;
      if (addParticipantEmails(typedValue)) participantInput.value = '';
    }

    function getFieldLabel(field) {
      return wizardForm.querySelector(`label[for="${field.id}"]`)?.textContent.replace('*', '').trim() || 'este campo';
    }

    function showFieldError(field, message) {
      field.setAttribute('aria-invalid', 'true');
      showToast(message, 'error');
      if (field === eventDateInput) {
        eventDateButton.setAttribute('aria-invalid', 'true');
        eventDateButton.focus();
      } else {
        field.focus();
      }
    }

    function setWizardStep(step) {
      if (step > highestAvailableWizardStep || step < 1 || step > wizardPanels.length) return;
      currentWizardStep = step;
      wizardPanels.forEach(panel => {
        panel.hidden = Number(panel.dataset.wizardStep) !== step;
      });
      wizardStepButtons.forEach(button => {
        const buttonStep = Number(button.dataset.stepButton);
        const isActive = buttonStep === step;
        button.disabled = buttonStep > highestAvailableWizardStep;
        button.classList.toggle('is-active', isActive);
        button.classList.toggle('is-complete', buttonStep < step);
        if (isActive) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
      });
      wizardPrevious.hidden = step === 1;
      wizardNext.hidden = step === wizardPanels.length;
      wizardSubmit.hidden = step !== wizardPanels.length;
      wizardCalendarSubmit.hidden = step !== wizardPanels.length;
      const stepCopy = [
        ['Criar evento', 'Preencha as informações do evento para que ele seja divulgado no calendário e no site da Fundação REFER.'],
        ['Publicar evento', 'Configure a descrição do calendário e, se desejar publicar no site, o texto do anúncio.'],
        ['Revisar evento', 'Confira todas as informações antes de publicar. Se algo precisar ser alterado, volte à etapa correspondente.']
      ][step - 1];
      eventPageTitle.textContent = stepCopy[0];
      eventPageDescription.textContent = stepCopy[1];
      eventBackButton.dataset.viewLink = step === 1 ? 'eventCategory' : 'event';
      eventBackButton.querySelector('#eventBackLabel').textContent = step === 1 ? 'Voltar para Cadastro Eventos' : 'Voltar ao evento';
      eventBackButton.querySelector('.material-symbols-outlined').textContent = 'arrow_back';
      document.getElementById('eventSummaryNote').textContent = [
        'As informações de publicação serão definidas na próxima etapa.',
        'As informações preenchidas serão conferidas na etapa de revisão.',
        'Confira os dados antes de criar e publicar o evento.'
      ][step - 1];
      if (step === wizardPanels.length) updateWizardReview();
    }

    function validateWizardStep(step) {
      const panel = wizardPanels.find(item => Number(item.dataset.wizardStep) === step);
      if (step === 1) {
        commitParticipantInput();
        for (const field of panel.querySelectorAll('[required]')) {
          if (!field.value.trim()) {
            showFieldError(field, `Preencha ${getFieldLabel(field).toLowerCase()}.`);
            return false;
          }
          if (!field.validity.valid) {
            showFieldError(field, `Verifique o valor informado em ${getFieldLabel(field).toLowerCase()}.`);
            return false;
          }
        }
        if (!participantEmails.length) {
          showFieldError(participantInput, 'Adicione pelo menos um e-mail válido para os participantes.');
          return false;
        }
        const manualLink = document.getElementById('link');
        if (document.getElementById('toggleLink').checked && manualLink.value && !manualLink.validity.valid) {
          showFieldError(manualLink, 'Informe um link de participação válido.');
          return false;
        }
      }
      if (step === 2) {
        const teamsDescription = document.getElementById('descricaoEditor');
        if (!teamsDescription.innerText.trim()) {
          showToast('Adicione a descrição do evento para o Teams/Calendário.', 'error');
          teamsDescription.focus();
          return false;
        }
      }
      return true;
    }

    function continueWizard() {
      if (!validateWizardStep(currentWizardStep)) return;
      highestAvailableWizardStep = Math.max(highestAvailableWizardStep, currentWizardStep + 1);
      setWizardStep(currentWizardStep + 1);
    }

    function handleWizardSubmit(event) {
      event.preventDefault();
      if (currentWizardStep < wizardPanels.length) {
        continueWizard();
        return;
      }
      publicarEvento(false);
    }

    function updateWizardReview() {
      const dateValue = document.getElementById('dataEvento').value;
      const dateText = dateValue
        ? new Intl.DateTimeFormat('pt-BR').format(new Date(`${dateValue}T12:00:00`))
        : '—';
      const startTime = document.getElementById('horaInicio').value;
      const endTime = document.getElementById('horaTermino').value;
      const dateAndTime = [dateText, [startTime, endTime].filter(Boolean).join(' – ')].filter(value => value !== '—' && value).join(' · ') || '—';
      const reminder = document.getElementById('lembrete');
      const fileNames = Array.from(document.querySelectorAll('#attachments [data-file-name]'))
        .map(file => file.dataset.fileName);
      const imageCount = document.querySelectorAll('#descricaoEditor .te-image-attachment').length;
      const attachmentSummary = [...fileNames, ...(imageCount ? [`${imageCount} ${imageCount === 1 ? 'imagem' : 'imagens'}`] : [])].join(', ') || 'Nenhum anexo';
      const participantSummary = participantEmails.length
        ? `${participantEmails.length} ${participantEmails.length === 1 ? 'convidado' : 'convidados'}`
        : '—';
      const values = {
        titulo: document.getElementById('titulo').value.trim() || '—',
        dataHorario: dateAndTime,
        local: document.getElementById('local').value.trim() || '—',
        organizador: document.getElementById('organizador').value.trim() || '—',
        teams: document.getElementById('isTeamsMeeting').checked ? 'Ativado' : 'Não ativado',
        lembrete: reminder.selectedOptions[0].textContent,
        anexos: attachmentSummary,
        descricaoTeams: document.getElementById('descricaoEditor').innerText.trim() || '—',
        descricaoWordPress: document.getElementById('descricaoWordPress').value.trim() || '—',
        linkManual: document.getElementById('toggleLink').checked ? document.getElementById('link').value.trim() || 'Não informado' : 'Não informado'
      };
      Object.entries(values).forEach(([key, value]) => {
        document.querySelectorAll(`[data-summary-value="${key}"], [data-review-value="${key}"]`)
          .forEach(target => { target.textContent = value; });
      });
      document.querySelector('[data-summary-value="participantes"]').textContent = participantSummary;
      document.querySelector('[data-review-value="participantes"]').textContent = participantEmails.join('; ') || '—';
    }

    participantInput.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ';' || event.key === ',') {
        event.preventDefault();
        commitParticipantInput();
      } else if (event.key === 'Backspace' && !participantInput.value && participantEmails.length) {
        participantEmails.pop();
        renderParticipantChips();
      }
    });
    participantInput.addEventListener('blur', commitParticipantInput);
    participantInput.addEventListener('paste', event => {
      const pastedText = event.clipboardData.getData('text');
      if (!/[;,]/.test(pastedText)) return;
      event.preventDefault();
      addParticipantEmails(pastedText);
    });
    eventDateButton.addEventListener('click', () => {
      if (eventDateCalendar.hidden) openDatePicker();
      else closeDatePicker();
    });
    document.getElementById('datePickerPrevious').addEventListener('click', () => {
      datePickerMonth.setMonth(datePickerMonth.getMonth() - 1);
      renderDatePicker();
      eventDateDays.querySelector('[tabindex="0"]')?.focus({ preventScroll: true });
    });
    document.getElementById('datePickerNext').addEventListener('click', () => {
      datePickerMonth.setMonth(datePickerMonth.getMonth() + 1);
      renderDatePicker();
      eventDateDays.querySelector('[tabindex="0"]')?.focus({ preventScroll: true });
    });
    eventDateDays.addEventListener('click', event => {
      const dayButton = event.target.closest('[data-date]');
      if (!dayButton) return;
      eventDateInput.value = dayButton.dataset.date;
      syncEventDateLabel();
      eventDateInput.dispatchEvent(new Event('input', { bubbles: true }));
      eventDateInput.dispatchEvent(new Event('change', { bubbles: true }));
      closeDatePicker(true);
    });
    document.getElementById('datePickerClear').addEventListener('click', () => {
      eventDateInput.value = '';
      syncEventDateLabel();
      eventDateInput.dispatchEvent(new Event('input', { bubbles: true }));
      eventDateInput.dispatchEvent(new Event('change', { bubbles: true }));
      closeDatePicker(true);
    });
    document.getElementById('datePickerToday').addEventListener('click', () => {
      eventDateInput.value = dateToISO(new Date());
      syncEventDateLabel();
      eventDateInput.dispatchEvent(new Event('input', { bubbles: true }));
      eventDateInput.dispatchEvent(new Event('change', { bubbles: true }));
      closeDatePicker(true);
    });
    eventDateInput.addEventListener('change', syncEventDateLabel);
    eventDateCalendar.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDatePicker(true);
        return;
      }
      const dayButton = event.target.closest('[data-date]');
      if (!dayButton) return;
      const nextDate = new Date(`${dayButton.dataset.date}T12:00:00`);
      const movement = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -7,
        ArrowDown: 7
      }[event.key];
      if (movement) {
        event.preventDefault();
        nextDate.setDate(nextDate.getDate() + movement);
      } else if (event.key === 'PageUp' || event.key === 'PageDown') {
        event.preventDefault();
        const dayOfMonth = nextDate.getDate();
        nextDate.setDate(1);
        nextDate.setMonth(nextDate.getMonth() + (event.key === 'PageUp' ? -1 : 1));
        nextDate.setDate(Math.min(dayOfMonth, new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate()));
      } else {
        return;
      }
      datePickerMonth = new Date(nextDate.getFullYear(), nextDate.getMonth(), 1);
      renderDatePicker();
      eventDateDays.querySelector(`[data-date="${dateToISO(nextDate)}"]`)?.focus({ preventScroll: true });
    });
    document.addEventListener('click', event => {
      if (!eventDateCalendar.hidden && !event.target.closest('.date-picker')) closeDatePicker();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !eventDateCalendar.hidden) closeDatePicker(true);
    });
    participantChips.addEventListener('click', event => {
      const removeButton = event.target.closest('[data-remove-participant]');
      if (!removeButton) return;
      participantEmails.splice(Number(removeButton.dataset.removeParticipant), 1);
      renderParticipantChips();
      participantInput.focus();
    });
    wizardForm.addEventListener('input', event => {
      event.target.removeAttribute('aria-invalid');
      if (event.target === eventDateInput) syncEventDateLabel();
      if (event.target === participantInput) {
        const pending = participantInput.value;
        if (/[;,]$/.test(pending)) commitParticipantInput();
      }
      updateWizardReview();
    });
    wizardForm.addEventListener('change', event => {
      event.target.removeAttribute('aria-invalid');
      updateWizardReview();
    });
    wizardNext.addEventListener('click', continueWizard);
    wizardPrevious.addEventListener('click', () => setWizardStep(currentWizardStep - 1));
    wizardStepButtons.forEach(button => {
      button.addEventListener('click', () => setWizardStep(Number(button.dataset.stepButton)));
    });
    eventBackButton.addEventListener('click', event => {
      event.preventDefault();
      if (currentWizardStep > 1) {
        setWizardStep(1);
        return;
      }
      previousView = currentView;
      showView('eventCategory');
    });
    renderParticipantChips();
    syncEventDateLabel();
    setWizardStep(currentWizardStep);
    updateWizardReview();

    let savedEditorRange = null;
    let pendingFileReads = [];
    let selectedImageAttachment = null;
    let editorInteractionVersion = 0;
    document.addEventListener('pointerdown', () => { editorInteractionVersion++; });
    document.addEventListener('keydown', () => { editorInteractionVersion++; });
    window.addEventListener('wheel', () => { editorInteractionVersion++; }, { passive: true });
    document.addEventListener('selectionchange', () => {
      const editor = document.getElementById('descricaoEditor');
      const selection = window.getSelection();
      if (selection && selection.rangeCount && editor.contains(selection.anchorNode)) {
        savedEditorRange = selection.getRangeAt(0).cloneRange();
      }
    });

    document.getElementById('teamsEditor').addEventListener('mousedown', event => {
      if (event.target.closest('.te-btn, .te-dropdown-item, .te-emoji-item')) event.preventDefault();
    });

    function execCmd(command, value = null) {
      const editor = document.getElementById('descricaoEditor');
      editor.focus();
      const selection = window.getSelection();
      if (selection && savedEditorRange) {
        selection.removeAllRanges();
        selection.addRange(savedEditorRange);
      }
      document.execCommand(command, false, value);
    }

    function setFontSize() {
      const size = prompt('Tamanho da fonte (1 a 7):', '3');
      if (size && /^[1-7]$/.test(size)) execCmd('fontSize', size);
    }

    function chooseColor(command) {
      const picker = document.createElement('input');
      picker.type = 'color';
      picker.value = command === 'foreColor' ? '#242424' : '#ffff00';
      picker.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;';
      picker.addEventListener('input', () => execCmd(command, picker.value));
      picker.addEventListener('change', () => picker.remove(), { once: true });
      picker.addEventListener('cancel', () => picker.remove(), { once: true });
      document.body.appendChild(picker);
      if (picker.showPicker) picker.showPicker();
      else picker.click();
    }

    function addLink() {
      const url = prompt("Cole a URL do link:", "https://");
      if (url) execCmd("createLink", url);
    }

    function toggleFormatBar() {
      const bar = document.getElementById('formatBar');
      const btn = document.getElementById('btnFormatToggle');
      if (bar.style.display === 'flex') {
        bar.style.display = 'none';
        btn.classList.remove('active');
      } else {
        bar.style.display = 'flex';
        btn.classList.add('active');
      }
    }

    function toggleDarkMode() {
      const editor = document.getElementById('teamsEditor');
      const icon = document.getElementById('iconTheme');
      editor.classList.toggle('dark-mode');
      icon.innerText = editor.classList.contains('dark-mode') ? 'light_mode' : 'dark_mode';
    }

    function insertFiles(files) {
      if (!files.length) return;
      Array.from(files).forEach(file => {
        const card = document.createElement('div');
        const extension = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
        card.className = 'te-file-attachment';
        card.contentEditable = 'false';
        card.dataset.extension = extension;
        card.dataset.fileName = file.name;
        card.dataset.mimeType = file.type || 'application/octet-stream';
        if (extension === 'pdf' || file.type === 'application/pdf') {
          card.classList.add('te-file-attachment--pdf');
        }

        const row = document.createElement('div');
        row.className = 'te-file-card';
        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined te-file-icon';
        icon.textContent = extension === 'pdf' ? 'picture_as_pdf' : 'draft';
        const info = document.createElement('div');
        info.className = 'te-file-info';
        const name = document.createElement('div');
        name.className = 'te-file-name';
        name.textContent = file.name;
        const size = document.createElement('div');
        size.className = 'te-file-size';
        size.textContent = formatFileSize(file.size);
        info.append(name, size);

        const menuButton = document.createElement('button');
        menuButton.type = 'button';
        menuButton.className = 'te-file-menu-button';
        menuButton.title = 'Opções do anexo';
        menuButton.setAttribute('aria-label', `Opções de ${file.name}`);
        menuButton.innerHTML = '<span class="material-symbols-outlined">keyboard_arrow_down</span>';
        const menu = document.createElement('div');
        menu.className = 'te-file-menu';
        menu.setAttribute('role', 'menu');
        const previewButton = createFileMenuAction('preview', 'Visualização', 'preview');
        const downloadButton = createFileMenuAction('download', 'Baixar', 'download');
        const removeButton = createFileMenuAction('remove', 'Remover anexo', 'close');
        menu.append(previewButton, downloadButton, removeButton);
        menuButton.addEventListener('click', () => {
          document.querySelectorAll('.te-file-menu.is-open').forEach(openMenu => {
            if (openMenu !== menu) openMenu.classList.remove('is-open');
          });
          menu.classList.toggle('is-open');
        });
        previewButton.addEventListener('click', () => {
          previewFile(card);
          menu.classList.remove('is-open');
        });
        downloadButton.addEventListener('click', event => {
          if (!dataLink.hasAttribute('href')) event.preventDefault();
          menu.classList.remove('is-open');
        });
        removeButton.addEventListener('click', () => {
          if (reader.readyState === FileReader.LOADING) reader.abort();
          card.remove();
          updateAttachmentArea();
        });
        row.append(icon, info, menuButton);

        const progress = document.createElement('div');
        progress.className = 'te-file-progress';
        progress.setAttribute('role', 'progressbar');
        progress.setAttribute('aria-label', `Carregando ${file.name}`);
        progress.setAttribute('aria-valuemin', '0');
        progress.setAttribute('aria-valuemax', '100');
        const progressBar = document.createElement('div');
        progressBar.className = 'te-file-progress-bar';
        progress.appendChild(progressBar);
        const dataLink = document.createElement('a');
        dataLink.className = 'te-file-data';
        dataLink.download = file.name;
        dataLink.hidden = true;
        card.append(row, progress);
        if (card.classList.contains('te-file-attachment--pdf')) {
          const preview = document.createElement('iframe');
          preview.className = 'te-pdf-preview';
          preview.title = `Visualização de ${file.name}`;
          preview.tabIndex = -1;
          preview.hidden = true;
          card.appendChild(preview);
          card._pdfPreview = preview;
        }
        card.append(menu, dataLink);
        document.getElementById('attachments').appendChild(card);
        updateAttachmentArea();

        const reader = new FileReader();
        pendingFileReads.push(readFileIntoNode(reader, file, card, {
          progress,
          progressBar,
          onLoad: data => {
            dataLink.href = data;
            downloadButton.href = data;
            downloadButton.download = file.name;
            downloadButton.removeAttribute('aria-disabled');
            downloadButton.removeAttribute('tabindex');
            if (card._pdfPreview) {
              const scrollPosition = window.scrollY;
              card._pdfPreview.src = `${data}#toolbar=0&navpanes=0&scrollbar=0`;
              card._pdfPreview.hidden = false;
              restoreEditorAfterPdfFocus(card._pdfPreview, scrollPosition);
            }
          },
          action: 'anexar'
        }));
        downloadButton.setAttribute('aria-disabled', 'true');
      });
      document.getElementById('filePicker').value = '';
    }

    function insertImages(files) {
      if (!files.length) return;
      Array.from(files).forEach(file => {
        if (!file.type.startsWith('image/')) return;
        const image = document.createElement('img');
        image.alt = file.name;
        image.draggable = false;
        const attachment = createImageAttachment(image);
        insertNodeAtCursor(attachment);
        const reader = new FileReader();
        pendingFileReads.push(readFileIntoNode(reader, file, attachment, {
          onLoad: data => {
            image.src = data;
            image.addEventListener('load', () => {
              attachment.style.width = `${Math.min(image.naturalWidth, 370, getAvailableImageWidth(attachment))}px`;
            }, { once: true });
          },
          action: 'inserir a imagem'
        }));
      });
      document.getElementById('imagePicker').value = '';
    }

    function readFileIntoNode(reader, file, node, options) {
      return new Promise(resolve => {
        reader.addEventListener('load', () => {
          options.onLoad(reader.result);
          if (options.progress) {
            options.progressBar.style.width = '100%';
            options.progress.setAttribute('aria-valuenow', '100');
            options.progress.hidden = true;
          }
          resolve();
        });
        reader.addEventListener('error', () => {
          node.remove();
          showToast(`Não foi possível ${options.action} "${file.name}".`, 'error');
          resolve();
        });
        reader.addEventListener('abort', resolve);
        if (options.progress) {
          reader.addEventListener('progress', event => {
            if (!event.lengthComputable) return;
            const percentage = Math.round(event.loaded / event.total * 100);
            options.progressBar.style.width = `${percentage}%`;
            options.progress.setAttribute('aria-valuenow', String(percentage));
          });
        }
        reader.readAsDataURL(file);
      });
    }

    function formatFileSize(bytes) {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function updateAttachmentArea() {
      const area = document.getElementById('attachmentArea');
      area.hidden = document.getElementById('attachments').childElementCount === 0;
    }

    function createFileMenuAction(action, label, icon) {
      const button = document.createElement(action === 'download' ? 'a' : 'button');
      if (button instanceof HTMLButtonElement) button.type = 'button';
      button.dataset.action = action;
      button.setAttribute('role', 'menuitem');
      if (action === 'download') {
        button.tabIndex = -1;
        button.setAttribute('aria-disabled', 'true');
      }
      button.innerHTML = `<span class="material-symbols-outlined">${icon}</span><span>${label}</span>`;
      return button;
    }

    function previewFile(card) {
      const dataLink = card.querySelector('.te-file-data');
      if (!dataLink.hasAttribute('href')) return;
      const dialog = document.getElementById('attachmentPreview');
      const name = document.getElementById('attachmentPreviewName');
      const content = document.getElementById('attachmentPreviewContent');
      const mimeType = card.dataset.mimeType;
      name.textContent = card.dataset.fileName;
      content.replaceChildren();

      if (mimeType === 'application/pdf') {
        const frame = document.createElement('iframe');
        frame.className = 'te-preview-frame';
        frame.title = `Visualização de ${card.dataset.fileName}`;
        frame.src = dataLink.href;
        content.appendChild(frame);
      } else if (mimeType.startsWith('image/')) {
        const image = document.createElement('img');
        image.className = 'te-preview-image';
        image.src = dataLink.href;
        image.alt = card.dataset.fileName;
        content.appendChild(image);
      } else {
        const message = document.createElement('div');
        message.className = 'te-preview-message';
        message.textContent = 'A visualização deste tipo de arquivo não está disponível no navegador.';
        const download = document.createElement('a');
        download.className = 'te-preview-download';
        download.href = dataLink.href;
        download.download = dataLink.download;
        download.textContent = 'Baixar arquivo';
        message.append(' ', download);
        content.appendChild(message);
      }

      if (!dialog.open) dialog.showModal();
    }

    function createImageAttachment(image) {
      const attachment = document.createElement('span');
      attachment.className = 'te-image-attachment';
      attachment.contentEditable = 'false';
      attachment.dataset.rotation = '0';
      attachment.appendChild(image);

      const rotateButton = document.createElement('button');
      rotateButton.type = 'button';
      rotateButton.className = 'te-image-rotate';
      rotateButton.title = 'Girar imagem arrastando';
      rotateButton.setAttribute('aria-label', 'Girar imagem');
      rotateButton.innerHTML = '<span class="material-symbols-outlined">rotate_right</span>';
      let rotationGestureMoved = false;
      rotateButton.addEventListener('click', () => {
        if (!rotationGestureMoved) {
          const rotation = Number(attachment.dataset.rotation) + 90;
          attachment.dataset.rotation = String(rotation);
          image.style.transform = `rotate(${rotation}deg)`;
        }
        rotationGestureMoved = false;
      });
      rotateButton.addEventListener('pointerdown', event => {
        event.preventDefault();
        event.stopPropagation();
        rotationGestureMoved = false;
        selectImageAttachment(attachment);
        const bounds = attachment.getBoundingClientRect();
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;
        const startAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI;
        const startRotation = Number(attachment.dataset.rotation);
        rotateButton.setPointerCapture(event.pointerId);
        const rotate = moveEvent => {
          rotationGestureMoved = true;
          const angle = Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX) * 180 / Math.PI;
          const rotation = startRotation + angle - startAngle;
          attachment.dataset.rotation = String(rotation);
          image.style.transform = `rotate(${rotation}deg)`;
        };
        const stopRotate = () => {
          rotateButton.removeEventListener('pointermove', rotate);
          rotateButton.removeEventListener('pointerup', stopRotate);
          rotateButton.removeEventListener('pointercancel', stopRotate);
        };
        rotateButton.addEventListener('pointermove', rotate);
        rotateButton.addEventListener('pointerup', stopRotate);
        rotateButton.addEventListener('pointercancel', stopRotate);
      });
      attachment.appendChild(rotateButton);

      ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(direction => {
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'te-image-handle';
        handle.dataset.direction = direction;
        handle.title = 'Redimensionar imagem';
        handle.setAttribute('aria-label', 'Redimensionar imagem');
        handle.addEventListener('pointerdown', event => {
          event.preventDefault();
          event.stopPropagation();
          selectImageAttachment(attachment);
          const startWidth = attachment.getBoundingClientRect().width;
          const startX = event.clientX;
          const startY = event.clientY;
          const ratio = image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 1;
          handle.setPointerCapture(event.pointerId);
          const resize = moveEvent => {
            const deltaX = moveEvent.clientX - startX;
            const deltaY = moveEvent.clientY - startY;
            const horizontalDelta = direction.includes('e') ? deltaX : direction.includes('w') ? -deltaX : 0;
            const verticalDelta = direction.includes('s') ? deltaY * ratio : direction.includes('n') ? -deltaY * ratio : 0;
            const delta = horizontalDelta && verticalDelta
              ? Math.abs(horizontalDelta) >= Math.abs(verticalDelta) ? horizontalDelta : verticalDelta
              : horizontalDelta || verticalDelta;
            const maxWidth = getAvailableImageWidth(attachment);
            attachment.style.width = `${Math.min(maxWidth, Math.max(Math.min(80, maxWidth), startWidth + delta))}px`;
          };
          const stopResize = () => {
            handle.removeEventListener('pointermove', resize);
            handle.removeEventListener('pointerup', stopResize);
            handle.removeEventListener('pointercancel', stopResize);
          };
          handle.addEventListener('pointermove', resize);
          handle.addEventListener('pointerup', stopResize);
          handle.addEventListener('pointercancel', stopResize);
        });
        attachment.appendChild(handle);
      });

      attachment.addEventListener('click', event => {
        event.stopPropagation();
        selectImageAttachment(attachment);
      });
      attachment.addEventListener('keydown', event => {
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          removeImageAttachment(attachment);
        }
      });
      return attachment;
    }

    function selectImageAttachment(attachment) {
      if (selectedImageAttachment && selectedImageAttachment !== attachment) {
        selectedImageAttachment.classList.remove('is-selected');
      }
      selectedImageAttachment = attachment;
      attachment.classList.add('is-selected');
    }

    function removeImageAttachment(attachment) {
      if (!attachment) return;
      attachment.remove();
      if (selectedImageAttachment === attachment) selectedImageAttachment = null;
    }

    function getAvailableImageWidth(attachment) {
      const editor = attachment.parentElement;
      const style = getComputedStyle(editor);
      return Math.max(0, editor.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    }

    function restoreEditorAfterPdfFocus(preview, scrollPosition) {
      const interactionVersion = editorInteractionVersion;
      [50, 150, 300, 600, 1000].forEach(delay => {
        window.setTimeout(() => {
          if (editorInteractionVersion !== interactionVersion || document.activeElement !== preview) return;
          window.scrollTo(0, scrollPosition);
          const editor = document.getElementById('descricaoEditor');
          editor.focus({ preventScroll: true });
          if (savedEditorRange && editor.contains(savedEditorRange.startContainer)) {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(savedEditorRange);
          }
        }, delay);
      });
    }

    document.addEventListener('keydown', event => {
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedImageAttachment) {
        event.preventDefault();
        removeImageAttachment(selectedImageAttachment);
      }
    });

    document.getElementById('descricaoEditor').addEventListener('click', event => {
      if (!event.target.closest('.te-image-attachment') && selectedImageAttachment) {
        selectedImageAttachment.classList.remove('is-selected');
        selectedImageAttachment = null;
      }
    });

    function getDataUrlContent(dataUrl, fileName) {
      const separator = dataUrl.indexOf(',');
      if (!dataUrl.startsWith('data:') || separator < 0) {
        throw new Error(`O arquivo "${fileName}" ainda não foi carregado. Aguarde o término do carregamento.`);
      }
      return dataUrl.slice(separator + 1);
    }

    function serializeDescription() {
      const copy = document.getElementById('descricaoEditor').cloneNode(true);
      copy.querySelectorAll('.te-image-attachment').forEach(attachment => {
        const image = attachment.querySelector('img');
        const outputImage = document.createElement('img');
        outputImage.src = image.src;
        outputImage.alt = image.alt;
        outputImage.style.width = attachment.style.width || 'auto';
        outputImage.style.maxWidth = '100%';
        const rotation = Number(attachment.dataset.rotation);
        if (rotation) outputImage.style.transform = `rotate(${rotation}deg)`;
        attachment.replaceWith(outputImage);
      });
      return copy.innerHTML.trim();
    }

    function serializeTeamsAttachments() {
      const files = Array.from(document.querySelectorAll('#attachments .te-file-attachment')).map(card => {
        const dataLink = card.querySelector('.te-file-data');
        const fileName = card.dataset.fileName;
        return {
          name: fileName,
          contentType: card.dataset.mimeType || 'application/octet-stream',
          contentBytes: getDataUrlContent(dataLink.href, fileName),
          isInline: false
        };
      });
      return files;
    }

    function serializeWordPressDescription(text) {
      return text
        .trim()
        .split(/\r?\n/)
        .map(line => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
        .map(line => `<p>${line || '<br>'}</p>`)
        .join('');
    }

    function insertNodeAtCursor(node) {
      const editor = document.getElementById('descricaoEditor');
      const selection = window.getSelection();
      const range = savedEditorRange && editor.contains(savedEditorRange.startContainer)
        ? savedEditorRange.cloneRange()
        : selection && selection.rangeCount && editor.contains(selection.anchorNode)
          ? selection.getRangeAt(0)
          : null;
      if (range) {
        range.deleteContents();
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        if (selection) {
          editor.focus({ preventScroll: true });
          selection.removeAllRanges();
          selection.addRange(range);
        }
        savedEditorRange = range.cloneRange();
      } else {
        editor.appendChild(node);
        const range = document.createRange();
        range.setStartAfter(node);
        range.collapse(true);
        editor.focus({ preventScroll: true });
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
        savedEditorRange = range.cloneRange();
      }
    }

    function toggleEmojiMenu() {
      const menu = document.getElementById('emojiMenu');
      menu.style.display = menu.style.display === 'grid' ? 'none' : 'grid';
    }

    const editorEmojis = Array.from('😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 🤥 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 ☹️ 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👺 👻 👽 👾 🤖 🎃 😺 😸 😹 😻 😼 😽 🙀 😿 😾 👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🦿 🦵 🦶 👂 🦻 👃 🧠 🫀 🫁 🦷 🦴 👀 👁️ 👅 👄 💋 🩸 👶 🧒 👦 👧 🧑 👨 👩 🧔 👵 👴 👲 👳‍♀️ 👳‍♂️ 🧕 👮‍♀️ 👮‍♂️ 👷‍♀️ 👷‍♂️ 💂‍♀️ 💂‍♂️ 🕵️‍♀️ 🕵️‍♂️ 👩‍⚕️ 👨‍⚕️ 👩‍🌾 👨‍🌾 👩‍🍳 👨‍🍳 👩‍🎓 👨‍🎓 👩‍🎤 👨‍🎤 👩‍🏫 👨‍🏫 👩‍🏭 👨‍🏭 👩‍💻 👨‍💻 👩‍💼 👨‍💼 👩‍🔧 👨‍🔧 👩‍🔬 👨‍🔬 👩‍🎨 👨‍🎨 👩‍🚒 👨‍🚒 👩‍✈️ 👨‍✈️ 👩‍🚀 👨‍🚀 👩‍⚖️ 👨‍⚖️ 👰 🤵 👸 🤴 🫅 🥷 🦸‍♀️ 🦸‍♂️ 🦹‍♀️ 🦹‍♂️ 🧙‍♀️ 🧙‍♂️ 🧚‍♀️ 🧚‍♂️ 🧛‍♀️ 🧛‍♂️ 🧜‍♀️ 🧜‍♂️ 🧝‍♀️ 🧝‍♂️ 🧞‍♀️ 🧞‍♂️ 🧟‍♀️ 🧟‍♂️ 💆‍♀️ 💆‍♂️ 💇‍♀️ 💇‍♂️ 🚶‍♀️ 🚶‍♂️ 🧍‍♀️ 🧍‍♂️ 🧎‍♀️ 🧎‍♂️ 🏃‍♀️ 🏃‍♂️ 💃 🕺 🕴️ 👯‍♀️ 👯‍♂️ 🧖‍♀️ 🧖‍♂️ 🧗‍♀️ 🧗‍♂️ 🧘‍♀️ 🧘‍♂️ 🛀 🛌 🧑‍🤝‍🧑 💏 💑 👪 🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐻‍❄️ 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐒 🐔 🐧 🐦 🐤 🐣 🐥 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🪱 🐛 🦋 🐌 🐞 🐜 🪰 🪲 🪳 🦟 🦗 🕷️ 🕸️ 🦂 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🦐 🦞 🦀 🪼 🪸 🐠 🐟 🐡 🐬 🦈 🐳 🐋 🐊 🐆 🐅 🦓 🦍 🦧 🦣 🐘 🦛 🦏 🐪 🐫 🦒 🦘 🦬 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🦮 🐕‍🦺 🐩 🐈 🐈‍⬛ 🪶 🐓 🦃 🦤 🦚 🦜 🪽 🐇 🦝 🦨 🦡 🦫 🦦 🦥 🐁 🐀 🐿️ 🦔 🐾 🐉 🐲 🌵 🎄 🌲 🌳 🌴 🪵 🌱 🌿 ☘️ 🍀 🎍 🪴 🎋 🍃 🍂 🍁 🍄 🌾 💐 🌷 🌹 🥀 🪻 🌺 🌸 🌼 🌻 🌞 🌝 🌛 🌜 🌚 🌕 🌖 🌗 🌘 🌑 🌒 🌓 🌔 🌙 ⭐ 🌟 ✨ ⚡ ☄️ 💥 🔥 🌪️ 🌈 ☀️ 🌤️ ⛅ 🌥️ ☁️ 🌦️ 🌧️ ⛈️ 🌩️ 🌨️ ❄️ ☃️ ⛄ 🌬️ 💨 💧 💦 ☔ ☂️ 🌊 🌍 🌎 🌏 🌐 🗺️ 🏔️ ⛰️ 🌋 🗻 🏕️ 🏖️ 🏜️ 🏝️ 🏞️ 🏟️ 🏛️ 🏗️ 🧱 🪨 🪵 🛖 🏘️ 🏚️ 🏠 🏡 🏢 🏣 🏤 🏥 🏦 🏨 🏩 🏪 🏫 🏬 🏭 🏯 🏰 💒 🗼 🗽 ⛪ 🕌 🛕 🕍 ⛩️ 🕋 ⛲ ⛺ 🌁 🌃 🏙️ 🌄 🌅 🌆 🌇 🌉 ♨️ 🎠 🛝 🎡 🎢 💈 🎪 🚂 🚃 🚄 🚅 🚆 🚇 🚈 🚉 🚊 🚝 🚞 🚋 🚌 🚍 🚎 🚐 🚑 🚒 🚓 🚔 🚕 🚖 🚗 🚘 🚙 🛻 🚚 🚛 🚜 🏎️ 🏍️ 🛵 🛺 🚲 🛴 🛹 🛼 🚏 🛣️ 🛤️ ⛽ 🛞 🚨 🚥 🚦 🛑 🚧 ⚓ 🛟 ⛵ 🛶 🚤 🛳️ ⛴️ 🛥️ 🚢 ✈️ 🛩️ 🛫 🛬 🪂 💺 🚁 🚟 🚠 🚡 🛰️ 🚀 🛸 🧳⌛ ⏳ ⌚ ⏰ 🕰️ 🌑 🎉 🎊 🎈 🎁 🎀 🏆 🥇 🥈 🥉 🏅 🎖️ ⚽ ⚾ 🥎 🏀 🏐 🏈 🏉 🎾 🥏 🎳 🏏 🏑 🏒 🥍 🏓 🏸 🥊 🥋 🥅 ⛳ ⛸️ 🎣 🤿 🎽 🎿 🛷 🥌 🎯 🪀 🪁 🎱 🔮 🪄 🧿 🎮 🕹️ 🎰 🎲 🧩 🧸 🪅 🪩 🪆 ♠️ ♥️ ♦️ ♣️ ♟️ 🃏 🀄 🎴 🎭 🖼️ 🎨 🧵 🪡 🧶 🪢 🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🫒 🥑 🍆 🥔 🥕 🌽 🌶️ 🫑 🥒 🥬 🥦 🧄 🧅 🍄 🥜 🫘 🌰 🍞 🥐 🥖 🫓 🥨 🥯 🥞 🧇 🧀 🍖 🍗 🥩 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🫔 🥙 🧆 🥚 🍳 🥘 🍲 🫕 🥣 🥗 🍿 🧈 🧂 🥫 🍱 🍘 🍙 🍚 🍛 🍜 🍝 🍠 🍢 🍣 🍤 🍥 🥮 🍡 🥟 🥠 🥡 🦀 🦞 🦐 🦑 🍦 🍧 🍨 🍩 🍪 🎂 🍰 🧁 🥧 🍫 🍬 🍭 🍮 🍯 🍼 🥛 ☕ 🫖 🍵 🧃 🥤 🧋 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉 🍾 🧊 🥄 🍴 🍽️ 🥢 🧂 🌶️ 🧭 🏺 🔪 🛡️ 🪓 ⚔️ 🪃 🏹 🛹 🛷 🧰 🪛 🔧 🔨 ⚒️ 🛠️ ⛏️ 🪚 🔩 ⚙️ 🪤 🧱 ⛓️ 🪝 🧲 🪜 🧪 🧫 🧬 🔬 🔭 📡 💉 🩹 🩺 🩻 🩼 💊 🩸 🧯 🛢️ 🪠 🪣 🧹 🧺 🧻 🚽 🚰 🚿 🛁 🛀 🧼 🪥 🪒 🧽 🪮 🧴 🛎️ 🔑 🗝️ 🚪 🪑 🛋️ 🛏️ 🛌 🧸 🪞 🪟 🛍️ 🛒 🎁 🎈 🎏 🎀 🪄 🪅 🪩 🪆 🎎 🧧 ✉️ 📩 📨 📧 💌 📥 📤 📦 📫 📪 📬 📭 📮 🗳️ ✏️ ✒️ 🖋️ 🖊️ 🖌️ 🖍️ 📝 💼 📁 📂 🗂️ 📅 📆 🗒️ 🗓️ 📇 📈 📉 📊 📋 📌 📍 📎 🖇️ 📏 📐 ✂️ 🗃️ 🗄️ 🗑️ 🔒 🔓 🔏 🔐 🔑 🗝️ 🔨 ⚒️ 🛠️ ⛏️ 🪓 🪚 🔧 🪛 🔩 ⚙️ 🗜️ ⚖️ 🦯 🔗 ⛓️ 🪝 🧰 🧲 🪜 ⚗️ 🧪 🧫 🧬 🔬 🔭 📡 💉 🩸 💊 🩹 🩺 🩻 🩼 🚪 🛗 🪞 🪟 🛏️ 🛋️ 🪑 🚽 🪠 🚿 🛁 🪤 🪒 🧴 🧷 🧹 🧺 🧻 🪣 🧼 🫧 🪥 🧽 🧯 🛒 🚬 ⚰️ 🪦 ⚱️ 🗿 🪧 🪬 🪩 🔔 🔕 🎵 🎶 🎼 🎤 🎧 📻 🎷 🪗 🎸 🎹 🎺 🎻 🪕 🥁 🪘 🪇 📱 📲 ☎️ 📞 📟 📠 🔋 🪫 🔌 💻 🖥️ 🖨️ ⌨️ 🖱️ 🖲️ 💽 💾 💿 📀 🧮 🎥 🎞️ 📽️ 🎬 📺 📷 📸 📹 📼 🔍 🔎 🕯️ 💡 🔦 🏮 🪔 📔 📕 📖 📗 📘 📙 📚 📓 📒 📃 📜 📄 📰 🗞️ 📑 🔖 🏷️ 💰 🪙 💴 💵 💶 💷 💸 💳 🧾 💹 💱 💲 ⚕️ ♻️ ✅ ☑️ ✔️ ✖️ ❌ ❓ ❔ ❕ ❗ 💯 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 ⬛ ⬜ 🔶 🔷 🔸 🔹 ⭐ 🌟 💫 ✨ 💥 💢 💦 💨 🕳️ 💬 🗨️ 🗯️ 💭 💤 🏳️ 🏴 🏁 🚩 🏳️‍🌈 🏳️‍⚧️');
    const emojiMenu = document.getElementById('emojiMenu');
    const emojiItems = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(editorEmojis.join('')), ({ segment }) => segment)
      .filter(emoji => emoji.trim());
    const skinTones = ['🏻', '🏼', '🏽', '🏾', '🏿'];
    const skinToneBases = ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🙏', '✍️', '💅', '🤳', '💪', '🦵', '🦶', '👂', '🦻', '👃'];
    skinToneBases.forEach(base => skinTones.forEach(tone => emojiItems.push(`${base}${tone}`)));
    const countryCodes = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CP CR CU CV CW CX CY CZ DE DG DJ DK DM DO DZ EA EC EE EG EH ER ES ET EU FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU IC ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TA TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(' ');
    countryCodes.forEach(code => {
      const flag = String.fromCodePoint(...Array.from(code, letter => 0x1f1e6 + letter.charCodeAt(0) - 65));
      emojiItems.push(flag);
    });
    emojiItems.forEach(emoji => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'te-emoji-item';
      button.textContent = emoji;
      button.title = emoji;
      button.addEventListener('click', () => {
        const editor = document.getElementById('descricaoEditor');
        editor.focus();
        document.execCommand('insertText', false, emoji);
        emojiMenu.style.display = 'none';
      });
      emojiMenu.appendChild(button);
    });

    function toggleDropdown() {
      const menu = document.getElementById('attachMenu');
      menu.style.display = menu.style.display === 'flex' ? 'none' : 'flex';
    }

    function closeAttachDropdown() {
      document.getElementById('attachMenu').style.display = 'none';
    }

    // Fecha o menu de anexo se clicar fora
    document.addEventListener('click', function(event) {
      const wrapper = document.getElementById('attachWrapper');
      if (wrapper && !wrapper.contains(event.target)) {
        document.getElementById('attachMenu').style.display = 'none';
      }
      const emojiWrapper = document.getElementById('emojiMenu').parentElement;
      if (!emojiWrapper.contains(event.target)) {
        document.getElementById('emojiMenu').style.display = 'none';
      }
    });

    // --- Lógica Geral do Formulário ---
    function toggleLinkBox() {
      const isChecked = document.getElementById('toggleLink').checked;
      document.getElementById('linkContainer').style.display = isChecked ? 'block' : 'none';
      if (!isChecked) document.getElementById('link').value = '';
    }

    async function publicarEvento(forcarEnvio = false, publicarNoWordPress = true) {
      const btn = document.getElementById('btnEnviar');
      const calendarBtn = document.getElementById('btnEnviarCalendario');
      const alertaDuplicado = document.getElementById('alertaDuplicado');
      const statusTeams = document.getElementById('statusTeams');
      const statusWP = document.getElementById('statusWP');
      const setPublishButtonsDisabled = disabled => {
        btn.disabled = disabled;
        calendarBtn.disabled = disabled;
      };

      alertaDuplicado.style.display = 'none';

      const titulo = document.getElementById('titulo').value.trim();
      const participantes = document.getElementById('participantes').value.trim();
      const dataEvento = document.getElementById('dataEvento').value;
      const organizador = document.getElementById('organizador').value.trim();
      const horaInicio = document.getElementById('horaInicio').value;
      const horaTermino = document.getElementById('horaTermino').value;
      const local = document.getElementById('local').value.trim();
      const lembreteMinutos = parseInt(document.getElementById('lembrete').value);
      
      // Captura o estado da nova flag "Teams reunião"
      const isTeamsMeeting = document.getElementById('isTeamsMeeting').checked;
      
      const descricaoEditor = document.getElementById('descricaoEditor');
      const descricaoTeamsTexto = descricaoEditor.innerText.trim();
      const descricaoWordPressTexto = document.getElementById('descricaoWordPress').value.trim();
      if (!descricaoTeamsTexto) {
        showToast('Adicione a descrição do evento para o Teams/Calendário.', 'error');
        descricaoEditor.focus();
        return;
      }
      if (publicarNoWordPress && !descricaoWordPressTexto) {
        showToast('Adicione a descrição do anúncio para o WordPress.', 'error');
        document.getElementById('descricaoWordPress').focus();
        return;
      }
      if (pendingFileReads.length) {
        setPublishButtonsDisabled(true);
        await Promise.all(pendingFileReads);
        pendingFileReads = [];
        setPublishButtonsDisabled(false);
      }
      const descricaoHtml = serializeDescription();
      const anexosTeams = serializeTeamsAttachments();
      const descricaoWordPressHtml = publicarNoWordPress
        ? serializeWordPressDescription(descricaoWordPressTexto)
        : '';

      // Se o usuário digitou um link manual, ele captura aqui
      const linkManual = document.getElementById('toggleLink').checked ? document.getElementById('link').value.trim() : '';
      let linkFinal = linkManual; // Começa como o manual, mas pode ser sobrescrito pelo link automático

      const dataInicioIso = `${dataEvento}T${horaInicio}:00`;
      const dataFimIso = `${dataEvento}T${horaTermino}:00`;

      const urlTeams = "/api/teams";
      const urlWP = "/api/wordpress/events";

      setPublishButtonsDisabled(true);

      // 0. VERIFICAÇÃO DE DUPLICIDADE
      if (publicarNoWordPress && !forcarEnvio) {
        statusWP.innerText = "WordPress: Verificando duplicidade no sistema...";
        statusTeams.innerText = "Teams/Calendário: Aguardando verificação...";

        try {
          const resBusca = await fetch(`${urlWP}?per_page=50`);

          if (resBusca.ok) {
            const eventosExistentes = await resBusca.json();
            const existeDuplicado = eventosExistentes.some(ev => {
              const tituloIgual = ev.title.rendered.trim().toLowerCase() === titulo.toLowerCase();
              const dataMeta = ev.meta?._evento_data || ev._evento_data;
              return tituloIgual && (dataMeta === dataEvento);
            });

            if (existeDuplicado) {
              alertaDuplicado.style.display = 'block';
              statusWP.innerText = "WordPress: ⚠️ Envio suspenso (Evento idêntico detectado).";
              statusTeams.innerText = "Teams/Calendário: ⚠️ Envio suspenso (Evento idêntico detectado).";
              showToast('Já existe um evento com este título e data. Revise os dados antes de reenviar.', 'warning');
              setPublishButtonsDisabled(false);
              return;
            }
          }
        } catch (e) {
          console.warn("Seguindo envio sem checagem previa de duplicidade.", e);
        }
      }

      // 1. TEAMS / POWER AUTOMATE
      statusTeams.innerText = "Teams/Calendário: Agendando evento...";
      statusWP.innerText = publicarNoWordPress
        ? "WordPress: Aguardando o link da reunião (se ativado)..."
        : "WordPress: Não será publicado (modo somente calendário).";

      let teamsSucceeded = false;
      let calendarConflicts = [];
      try {
        const respTeams = await fetch(urlTeams, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            titulo: titulo,
            descricao: descricaoHtml,
            descricaoContentType: 'HTML',
            attachments: anexosTeams,
            dataEvento: dataEvento,
            dataInicioIso: dataInicioIso,
            dataFimIso: dataFimIso,
            participantes: participantes,
            local: local,
            lembreteMinutos: lembreteMinutos,
            isTeamsMeeting: isTeamsMeeting // Enviando o status do toggle para o Power Automate
          })
        });

        if (respTeams.ok) {
          teamsSucceeded = true;
          // Tenta extrair a resposta do Power Automate (caso esteja configurado com o bloco de 'Response')
          try {
            const dadosResposta = await respTeams.json();
            if (dadosResposta && typeof dadosResposta === 'object' && Array.isArray(dadosResposta.conflitos)) {
              calendarConflicts = [...new Set(dadosResposta.conflitos
                .filter(email => typeof email === 'string')
                .map(email => email.trim())
                .filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
            }
            // Se o botão estava marcado e o PA devolveu um linkGerado
            if (isTeamsMeeting && dadosResposta.linkGerado) {
              linkFinal = dadosResposta.linkGerado; // O Link Final passa a ser o do Teams
              statusTeams.innerText = "Teams/Calendário: ✅ Reunião online criada com sucesso!";
            } else {
              statusTeams.innerText = "Teams/Calendário: ✅ Evento presencial criado com sucesso!";
            }
          } catch (errJson) {
            statusTeams.innerText = "Teams/Calendário: ✅ Evento criado com sucesso!";
          }
        } else {
          statusTeams.innerText = `Teams/Calendário: ❌ Erro HTTP ${respTeams.status}`;
          showToast(`Não foi possível criar o evento no Teams/Calendário (HTTP ${respTeams.status}).`, 'error');
        }
      } catch (e) {
        statusTeams.innerText = "Teams/Calendário: ❌ Erro: " + e.message;
        showToast('Não foi possível conectar ao Teams/Calendário.', 'error');
      }

      if (anexosTeams.length && !teamsSucceeded) {
        statusWP.innerText = publicarNoWordPress
          ? "WordPress: publicação cancelada porque o Teams/Calendário não confirmou o envio dos anexos."
          : "WordPress: não publicado (modo somente calendário).";
        showToast('A publicação foi interrompida porque o envio dos anexos ao Teams/Calendário não foi confirmado.', 'error');
        setPublishButtonsDisabled(false);
        return;
      }

      if (!publicarNoWordPress) {
        statusWP.innerText = "WordPress: não publicado (modo somente calendário).";
        if (teamsSucceeded) showToast('Evento criado somente no Calendário/Teams.', 'success');
        setPublishButtonsDisabled(false);
        showCalendarConflictDialog(calendarConflicts);
        return;
      }

      // 2. WORDPRESS REST API
      statusWP.innerText = "WordPress: Publicando no site...";
      try {
        const respWP = await fetch(urlWP, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: titulo,
            content: descricaoWordPressHtml,
            status: 'publish',
            _evento_data: dataEvento,
            _evento_hora_ini: horaInicio,
            _evento_hora_fim: horaTermino,
            _evento_local: local,
            _evento_organizador: organizador,
            _evento_link: linkFinal, // Envia o link gerado pelo Teams (ou o link manual, se houver)
            meta: {
              _evento_data: dataEvento,
              _evento_hora_ini: horaInicio,
              _evento_hora_fim: horaTermino,
              _evento_local: local,
              _evento_organizador: organizador,
              _evento_link: linkFinal // Envia o link gerado pelo Teams (ou o link manual, se houver)
            }
          })
        });

        if (respWP.ok) {
          const dadosPost = await respWP.json();
          statusWP.innerText = `WordPress: ✅ Evento publicado na agenda! (ID: ${dadosPost.id})`;
          showToast('Evento publicado com sucesso no site.', 'success');
        } else {
          const erro = await respWP.json();
          statusWP.innerText = `WordPress: ❌ Erro (${respWP.status}): ${erro.message || 'Falha ao salvar'}`;
          showToast(`Não foi possível publicar o evento no site (HTTP ${respWP.status}).`, 'error');
        }
      } catch (e) {
        statusWP.innerText = "WordPress: ❌ Erro de conexão/CORS: " + e.message;
        showToast('Não foi possível conectar ao WordPress para publicar o evento.', 'error');
      } finally {
        setPublishButtonsDisabled(false);
      }
      showCalendarConflictDialog(calendarConflicts);
    }

    renderView(viewFromHash());
