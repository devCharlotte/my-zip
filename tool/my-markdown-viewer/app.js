(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const editor = $('#editor');
  const preview = $('#preview');
  const workbench = $('#workbench');
  const splitter = $('#splitter');
  const dropZone = $('#dropZone');
  const editorPane = $('#editorPane');
  const sourceLabel = $('#sourceLabel');
  const status = $('#renderStatus');
  const hint = $('#layoutHint');
  const compact = window.matchMedia('(max-width: 850px)');
  const maxFileSize = 12 * 1024 * 1024;

  let mode = 'split';
  let editorSize = 34;
  let editorHeight = 38;
  let renderFrame = 0;
  let activePointer = null;
  let documentName = '';
  let lastSavedText = '';
  let dragDepth = 0;
  let started = false;
  let clearedDocument = null;

  const renderer = window.markdownit ? window.markdownit({
    html: false,
    breaks: true,
    linkify: true,
    typographer: false
  }) : null;

  if (renderer) {
    renderer.renderer.rules.image = (tokens, index) => {
      const label = renderer.utils.escapeHtml(tokens[index].content || '이미지');
      return '<span class="md-image" title="외부 이미지는 자동으로 불러오지 않아요.">[이미지] ' + label + '</span>';
    };
    const fallbackLinkOpen = renderer.renderer.rules.link_open || ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
    renderer.renderer.rules.link_open = (tokens, index, options, env, self) => {
      tokens[index].attrSet('target', '_blank');
      tokens[index].attrSet('rel', 'noopener noreferrer nofollow');
      tokens[index].attrSet('referrerpolicy', 'no-referrer');
      return fallbackLinkOpen(tokens, index, options, env, self);
    };
  }

  function isCompact() {
    return compact.matches;
  }

  function report(message) {
    status.textContent = message || '';
  }

  function showPlaceholder() {
    preview.replaceChildren();
    const wrapper = document.createElement('div');
    wrapper.className = 'empty';
    const heading = document.createElement('strong');
    heading.textContent = 'Markdown을 보여드릴게요.';
    const detail = document.createElement('p');
    detail.textContent = '왼쪽에서 파일 열기, 붙여넣기 또는 직접 작성하기를 선택해 주세요.';
    wrapper.append(heading, detail);
    preview.append(wrapper);
  }

  function updateSource() {
    const text = editor.value;
    $('#charCount').textContent = text.length.toLocaleString('ko-KR') + '자';
    sourceLabel.textContent = !started
      ? '파일을 열거나 직접 작성해 주세요.'
      : documentName
        ? '열린 파일: ' + documentName
        : '새 Markdown 문서';
    $('#downloadButton').disabled = !text.trim();
    $('#clearButton').disabled = !text;
    $('#undoClear').hidden = !clearedDocument;
  }

  function renderMarkdown() {
    renderFrame = 0;
    updateSource();
    const input = editor.value;
    if (!input.trim()) {
      showPlaceholder();
      $('#viewInfo').textContent = '내용을 입력하면 바로 보여요.';
      if (!clearedDocument) report('');
      return;
    }
    if (!renderer) {
      preview.textContent = input;
      $('#viewInfo').textContent = '원문 보기';
      report('Markdown 표시 기능을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 새로고침해 주세요. 원문은 그대로 남아 있어요.');
      return;
    }
    try {
      preview.innerHTML = renderer.render(input);
      const tables = preview.querySelectorAll('table');
      tables.forEach(table => {
        const container = document.createElement('div');
        container.className = 'table-scroll';
        container.tabIndex = 0;
        container.setAttribute('role', 'region');
        container.setAttribute('aria-label', '가로로 스크롤할 수 있는 표');
        table.parentNode.insertBefore(container, table);
        container.append(table);
      });
      const headingCount = preview.querySelectorAll('h1,h2,h3,h4,h5,h6').length;
      $('#viewInfo').textContent = tables.length
        ? '표 ' + tables.length + '개, 제목 ' + headingCount + '개'
        : '제목 ' + headingCount + '개';
      report('');
    } catch (error) {
      preview.textContent = input;
      report('내용을 표시하지 못했어요. 원문은 그대로 남아 있어요.');
    }
  }

  function queueRender() {
    if (renderFrame) cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(renderMarkdown);
  }

  function beginEditing(text, name, method) {
    if (started) return false;
    started = true;
    clearedDocument = null;
    editor.hidden = false;
    dropZone.hidden = true;
    documentName = name || '';
    editor.value = text.replace(/^\uFEFF/, '');
    lastSavedText = editor.value;
    const notice = $('#editorNotice');
    notice.hidden = false;
    notice.textContent = method === 'file'
      ? documentName + ' 파일을 열었어요. 수정한 뒤 다운로드하면 파일명에 -JH가 붙어요. 다른 파일을 열려면 페이지를 새로고침해 주세요.'
      : method === 'paste'
        ? '붙여넣은 내용으로 시작했어요. 수정한 내용은 Markdown으로 다운로드할 수 있어요. 다른 파일을 열려면 페이지를 새로고침해 주세요.'
        : '직접 작성을 시작했어요. Markdown으로 다운로드할 수 있어요. 다른 파일을 열려면 페이지를 새로고침해 주세요.';
    $('#modeView').disabled = false;
    setMode('split');
    queueRender();
    return true;
  }

  function openPicker() {
    $('#mdFile').click();
  }

  function downloadMarkdown() {
    if (!editor.value.trim()) {
      report('다운로드할 내용이 없어요.');
      return;
    }
    const baseName = documentName
      ? documentName.replace(/\.(md|markdown|mdown|txt)$/i, '')
      : 'markdown';
    const currentName = (baseName.endsWith('-JH') ? baseName : baseName + '-JH') + '.md';
    const safeName = currentName.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
    const file = new Blob([editor.value], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = safeName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    lastSavedText = editor.value;
    report('Markdown 파일을 다운로드했어요.');
  }

  async function readFile(file) {
    if (!file) return;
    if (file.size > maxFileSize) {
      report('12MB 이하의 Markdown 파일을 선택해 주세요.');
      return;
    }
    if (!/\.(md|markdown|mdown|txt)$/i.test(file.name) && file.type !== 'text/plain' && file.type !== 'text/markdown') {
      report('Markdown 또는 텍스트 파일을 선택해 주세요.');
      return;
    }
    if (started) {
      report('다른 파일을 열려면 페이지를 새로고침해 주세요. 수정한 내용은 먼저 다운로드해 주세요.');
      return;
    }
    try {
      const text = await file.text();
      beginEditing(text, file.name, 'file');
      report('');
    } catch (error) {
      report('파일을 읽지 못했어요. 다른 파일을 선택해 주세요.');
    }
  }

  function setMode(next) {
    if (!started && next === 'view') return;
    mode = next;
    workbench.dataset.mode = mode;
    $('#modeView').setAttribute('aria-pressed', String(mode === 'view'));
    $('#modeSplit').setAttribute('aria-pressed', String(mode === 'split'));

    hint.textContent = mode === 'view'
      ? '입력창을 다시 펼치면 원문을 수정할 수 있어요.'
      : isCompact()
        ? '가운데 선을 위아래로 드래그해 높이를 조절할 수 있어요.'
        : '가운데 선을 좌우로 드래그해 너비를 조절할 수 있어요.';
    refreshSplitter();
  }

  function refreshSplitter() {
    workbench.style.setProperty('--editor-width', editorSize + '%');
    workbench.style.setProperty('--editor-height', editorHeight + '%');
    splitter.setAttribute('aria-orientation', isCompact() ? 'horizontal' : 'vertical');
    const value = isCompact() ? editorHeight : editorSize;
    splitter.setAttribute('aria-valuenow', String(value));
    splitter.setAttribute('aria-valuetext', '입력창 ' + value + '%');
    splitter.setAttribute('aria-valuemin', '12');
    splitter.setAttribute('aria-valuemax', '75');
  }

  function resizeTo(position) {
    const bounds = workbench.getBoundingClientRect();
    const distance = isCompact() ? position.y - bounds.top : position.x - bounds.left;
    const extent = isCompact() ? bounds.height : bounds.width;
    if (!extent) return;
    const percent = Math.round(Math.min(75, Math.max(12, distance / extent * 100)));
    if (isCompact()) editorHeight = percent;
    else editorSize = percent;
    refreshSplitter();
  }

  splitter.addEventListener('pointerdown', event => {
    if (mode !== 'split' || event.button !== 0) return;
    activePointer = event.pointerId;
    splitter.setPointerCapture(event.pointerId);
    workbench.classList.add('is-dragging');
    document.body.classList.add('is-resizing');
    resizeTo({ x: event.clientX, y: event.clientY });
    event.preventDefault();
  });

  splitter.addEventListener('pointermove', event => {
    if (activePointer !== event.pointerId) return;
    resizeTo({ x: event.clientX, y: event.clientY });
  });

  function endResize(event) {
    if (activePointer !== event.pointerId) return;
    activePointer = null;
    workbench.classList.remove('is-dragging');
    document.body.classList.remove('is-resizing');
  }

  splitter.addEventListener('pointerup', endResize);
  splitter.addEventListener('pointercancel', endResize);
  splitter.addEventListener('lostpointercapture', endResize);

  splitter.addEventListener('keydown', event => {
    const amount = event.shiftKey ? 10 : 3;
    const axis = isCompact()
      ? { decrease: 'ArrowUp', increase: 'ArrowDown' }
      : { decrease: 'ArrowLeft', increase: 'ArrowRight' };
    let delta = 0;
    if (event.key === axis.decrease) delta = -amount;
    if (event.key === axis.increase) delta = amount;
    if (event.key === 'Home') delta = -100;
    if (event.key === 'End') delta = 100;
    if (!delta) return;
    event.preventDefault();
    if (isCompact()) editorHeight = Math.max(12, Math.min(75, editorHeight + delta));
    else editorSize = Math.max(12, Math.min(75, editorSize + delta));
    refreshSplitter();
  });

  splitter.addEventListener('dblclick', () => {
    editorSize = 34;
    editorHeight = 38;
    refreshSplitter();
  });

  $('#modeView').disabled = true;
  $('#modeView').addEventListener('click', () => setMode('view'));
  $('#modeSplit').addEventListener('click', () => setMode('split'));

  $('#resetLayout').addEventListener('click', () => {
    editorSize = 34;
    editorHeight = 38;
    setMode('split');
  });

  $('#openFullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if ($('.viewer-page').requestFullscreen) await $('.viewer-page').requestFullscreen();
      else report('이 브라우저는 전체 화면을 지원하지 않아요. 뷰어만 보기를 사용해 주세요.');
    } catch (error) {
      report('전체 화면으로 전환할 수 없어요. 뷰어만 보기를 사용해 주세요.');
    }
  });

  document.addEventListener('fullscreenchange', () => {
    $('#openFullscreen').textContent = document.fullscreenElement ? '전체 화면 종료' : '전체 화면';
  });

  $('#openInEditor').addEventListener('click', openPicker);
  $('#startWriting').addEventListener('click', () => {
    if (beginEditing('', '', 'write')) editor.focus();
  });
  $('#downloadButton').addEventListener('click', downloadMarkdown);

  $('#mdFile').addEventListener('change', async event => {
    await readFile(event.target.files[0]);
    event.target.value = '';
  });

  $('#pasteButton').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        report('클립보드에 복사된 텍스트가 없어요.');
        return;
      }
      if (started) {
        report('새 내용을 열려면 페이지를 새로고침해 주세요. 수정한 내용은 먼저 다운로드해 주세요.');
        return;
      }
      beginEditing(text, '', 'paste');
      report('');
    } catch (error) {
      if (!started) beginEditing('', '', 'write');
      editor.focus();
      report('클립보드에 접근할 수 없어요. 입력창에서 Ctrl+V로 붙여넣어 주세요.');
    }
  });

  function restoreClear() {
    if (!clearedDocument) return;
    editor.value = clearedDocument.text;
    documentName = clearedDocument.name;
    lastSavedText = clearedDocument.savedText;
    clearedDocument = null;
    queueRender();
    editor.focus();
    report('내용을 되돌렸어요.');
  }

  $('#clearButton').addEventListener('click', () => {
    if (!editor.value) return;
    if (!window.confirm('입력한 내용을 모두 비울까요? 비운 직후에는 되돌릴 수 있지만 자동 저장되지는 않아요.')) return;
    clearedDocument = {
      text: editor.value,
      name: documentName,
      savedText: lastSavedText
    };
    editor.value = '';
    queueRender();
    editor.focus();
    report('내용을 비웠어요. 위쪽의 비우기 취소를 누르거나 Ctrl+Z로 되돌릴 수 있어요.');
  });

  $('#undoClear').addEventListener('click', restoreClear);

  editor.addEventListener('input', () => {
    clearedDocument = null;
    queueRender();
  });

  editor.addEventListener('keydown', event => {
    if (clearedDocument && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      restoreClear();
      return;
    }
    if (event.key !== 'Tab' || event.shiftKey) return;
    event.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText('  ', start, end, 'end');
    queueRender();
  });

  function setFontSize(requested, typing = false) {
    const number = Number(requested);
    if (!Number.isFinite(number)) return;
    const pt = Math.round(Math.max(8, Math.min(36, number)) * 2) / 2;
    if (!typing) $('#fontSize').value = String(pt);
    $('#fontRange').value = String(pt);
    preview.style.setProperty('--reader-pt', pt + 'pt');
  }

  $('#fontSize').addEventListener('input', event => {
    if (event.target.value !== '') setFontSize(event.target.value, true);
  });
  $('#fontSize').addEventListener('change', event => {
    setFontSize(event.target.value || 12);
  });
  $('#fontRange').addEventListener('input', event => setFontSize(event.target.value));
  $('#smallerText').addEventListener('click', () => setFontSize(Number($('#fontSize').value || 12) - 1));
  $('#largerText').addEventListener('click', () => setFontSize(Number($('#fontSize').value || 12) + 1));
  setFontSize(12);

  $('#copyRendered').addEventListener('click', async () => {
    if (!editor.value.trim()) return;
    try {
      await navigator.clipboard.writeText(preview.innerText);
      report('보이는 텍스트를 복사했어요.');
    } catch (error) {
      report('텍스트를 복사하지 못했어요. 뷰어에서 직접 선택해 복사해 주세요.');
    }
  });

  function hasFileDrag(event) {
    return event.dataTransfer && [...event.dataTransfer.types].includes('Files');
  }

  function resetDropState() {
    dragDepth = 0;
    dropZone.classList.remove('is-over');
    editorPane.classList.remove('is-over');
  }

  editorPane.addEventListener('dragenter', event => {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    dragDepth++;
    editorPane.classList.add('is-over');
    dropZone.classList.add('is-over');
  });

  editorPane.addEventListener('dragleave', event => {
    if (!hasFileDrag(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) resetDropState();
  });

  editorPane.addEventListener('dragover', event => {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });

  editorPane.addEventListener('drop', async event => {
    if (!event.dataTransfer) return;
    const file = event.dataTransfer.files[0];
    resetDropState();
    if (file) {
      event.preventDefault();
      if (started) {
        report('다른 파일을 열려면 페이지를 새로고침해 주세요. 수정한 내용은 먼저 다운로드해 주세요.');
        return;
      }
      await readFile(file);
    }
  });

  dropZone.addEventListener('dragover', event => {
    if (event.dataTransfer && ([...event.dataTransfer.types].includes('text/plain') || hasFileDrag(event))) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  });

  dropZone.addEventListener('drop', async event => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer.files[0];
    resetDropState();
    if (file) {
      await readFile(file);
      return;
    }
    const text = event.dataTransfer.getData('text/plain');
    if (!text) return;
    if (started) {
      report('새 내용을 열려면 페이지를 새로고침해 주세요. 수정한 내용은 먼저 다운로드해 주세요.');
      return;
    }
    beginEditing(text, '', 'paste');
  });

  window.addEventListener('dragover', event => {
    if (hasFileDrag(event)) event.preventDefault();
  });

  window.addEventListener('drop', event => {
    if (hasFileDrag(event)) {
      event.preventDefault();
      resetDropState();
    }
  });

  window.addEventListener('beforeunload', event => {
    if (!started || (editor.value === lastSavedText && !clearedDocument)) return;
    event.preventDefault();
    event.returnValue = '';
  });

  if (compact.addEventListener) compact.addEventListener('change', refreshSplitter);
  else compact.addListener(refreshSplitter);

  refreshSplitter();
  renderMarkdown();
})();
