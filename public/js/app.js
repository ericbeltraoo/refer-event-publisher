// --- Lógica do Editor Estilo Teams ---
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
          alert(`Não foi possível ${options.action} "${file.name}".`);
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
      copy.querySelectorAll('.te-image-attachment').forEach((attachment, index) => {
        const image = attachment.querySelector('img');
        const outputImage = document.createElement('img');
        outputImage.alt = image.alt;
        outputImage.dataset.teamsInlineId = `teams-inline-image-${index + 1}@refer.local`;
        outputImage.style.width = attachment.style.width || 'auto';
        outputImage.style.maxWidth = '100%';
        const rotation = Number(attachment.dataset.rotation);
        if (rotation) outputImage.style.transform = `rotate(${rotation}deg)`;
        attachment.replaceWith(outputImage);
      });
      return copy.innerHTML.trim().replace(
        /\sdata-teams-inline-id="([^"]+)"/g,
        ' src="cid:$1"'
      );
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
      const images = Array.from(document.querySelectorAll('#descricaoEditor .te-image-attachment img')).map((image, index) => ({
        name: image.alt || `imagem-${index + 1}`,
        contentType: image.src.slice(5, image.src.indexOf(';')) || 'application/octet-stream',
        contentBytes: getDataUrlContent(image.src, image.alt || `imagem-${index + 1}`),
        isInline: true,
        contentId: `teams-inline-image-${index + 1}@refer.local`
      }));
      return [...files, ...images];
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

    async function publicarEvento(forcarEnvio = false) {
      const btn = document.getElementById('btnEnviar');
      const alertaDuplicado = document.getElementById('alertaDuplicado');
      const statusTeams = document.getElementById('statusTeams');
      const statusWP = document.getElementById('statusWP');

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
        alert("Adicione a descrição do evento para o Teams/Calendário.");
        descricaoEditor.focus();
        return;
      }
      if (!descricaoWordPressTexto) {
        alert("Adicione a descrição do anúncio para o WordPress.");
        document.getElementById('descricaoWordPress').focus();
        return;
      }
      if (pendingFileReads.length) {
        btn.disabled = true;
        await Promise.all(pendingFileReads);
        pendingFileReads = [];
        btn.disabled = false;
      }
      const descricaoHtml = serializeDescription();
      const anexosTeams = serializeTeamsAttachments();
      const descricaoWordPressHtml = serializeWordPressDescription(descricaoWordPressTexto);

      // Se o usuário digitou um link manual, ele captura aqui
      const linkManual = document.getElementById('toggleLink').checked ? document.getElementById('link').value.trim() : '';
      let linkFinal = linkManual; // Começa como o manual, mas pode ser sobrescrito pelo link automático

      const dataInicioIso = `${dataEvento}T${horaInicio}:00`;
      const dataFimIso = `${dataEvento}T${horaTermino}:00`;

      const urlTeams = "/api/teams";
      const urlWP = "/api/wordpress/events";

      btn.disabled = true;

      // 0. VERIFICAÇÃO DE DUPLICIDADE
      if (!forcarEnvio) {
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
              btn.disabled = false;
              return;
            }
          }
        } catch (e) {
          console.warn("Seguindo envio sem checagem previa de duplicidade.", e);
        }
      }

      // 1. TEAMS / POWER AUTOMATE
      statusTeams.innerText = "Teams/Calendário: Agendando evento...";
      statusWP.innerText = "WordPress: Aguardando o link da reunião (se ativado)...";

      let teamsSucceeded = false;
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
        }
      } catch (e) {
        statusTeams.innerText = "Teams/Calendário: ❌ Erro: " + e.message;
      }

      if (anexosTeams.length && !teamsSucceeded) {
        statusWP.innerText = "WordPress: publicação cancelada porque o Teams/Calendário não confirmou o envio dos anexos.";
        btn.disabled = false;
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
        } else {
          const erro = await respWP.json();
          statusWP.innerText = `WordPress: ❌ Erro (${respWP.status}): ${erro.message || 'Falha ao salvar'}`;
        }
      } catch (e) {
        statusWP.innerText = "WordPress: ❌ Erro de conexão/CORS: " + e.message;
      } finally {
        btn.disabled = false;
      }
    }
