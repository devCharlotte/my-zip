(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const editor = $('#editor');
  const preview = $('#preview');
  const workbench = $('#workbench');
  const splitter = $('#splitter');
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
    detail.textContent = '왼쪽에 내용을 붙여넣거나 위에서 MD 파일을 선택해 주세요.';
    wrapper.append(heading, detail);
    preview.append(wrapper);
  }

  function updateSource() {
    const text = editor.value;
    $('#charCount').textContent = text.length.toLocaleString('ko-KR') + '자';
    sourceLabel.textContent = documentName ? documentName : '직접 입력한 내용';
  }

  function renderMarkdown() {
    renderFrame = 0;
    updateSource();
    const input = editor.value;
    if (!input.trim()) {
      showPlaceholder();
      $('#viewInfo').textContent = '내용을 입력하면 바로 보여요.';
      report('');
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

  function setMarkdown(text, name) {
    editor.value = text.replace(/^\uFEFF/, '');
    documentName = name || '';
    queueRender();
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
    try {
      setMarkdown(await file.text(), file.name);
      report('');
    } catch (error) {
      report('파일을 읽지 못했어요. 다른 파일을 선택해 주세요.');
    }
  }

  function setMode(next) {
    mode = next;
    workbench.dataset.mode = mode;
    $('#modeView').setAttribute('aria-pressed', String(mode === 'view'));
    $('#modeSplit').setAttribute('aria-pressed', String(mode === 'split'));
    $('#toggleEditor').setAttribute('aria-expanded', String(mode === 'split'));
    $('#toggleEditor').textContent = mode === 'split' ? '입력창 접기' : '입력창 펼치기';
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

  $('#modeView').addEventListener('click', () => setMode('view'));
  $('#modeSplit').addEventListener('click', () => setMode('split'));
  $('#toggleEditor').addEventListener('click', () => setMode(mode === 'split' ? 'view' : 'split'));

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
      setMarkdown(text, '');
      report('');
    } catch (error) {
      setMode('split');
      editor.focus();
      report('클립보드에 접근할 수 없어요. 입력창을 눌러 Ctrl+V 또는 붙여넣기를 이용해 주세요.');
    }
  });

  $('#clearButton').addEventListener('click', () => {
    if (editor.value && !window.confirm('입력한 내용을 비울까요? 이 화면에 자동 저장한 내용은 없어요.')) return;
    setMarkdown('', '');
    setMode('split');
    editor.focus();
  });

  editor.addEventListener('input', () => {
    documentName = '';
    queueRender();
  });

  editor.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || event.shiftKey) return;
    event.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText('  ', start, end, 'end');
    documentName = '';
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

  window.addEventListener('dragover', event => {
    if (event.dataTransfer && [...event.dataTransfer.types].includes('Files')) event.preventDefault();
  });

  window.addEventListener('drop', async event => {
    if (!event.dataTransfer || !event.dataTransfer.files.length) return;
    event.preventDefault();
    await readFile(event.dataTransfer.files[0]);
  });

  if (compact.addEventListener) compact.addEventListener('change', refreshSplitter);
  else compact.addListener(refreshSplitter);

  refreshSplitter();
  renderMarkdown();
})();
