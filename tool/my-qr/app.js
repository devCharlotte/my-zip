(() => {
  'use strict';

  const get = (id) => document.getElementById(id);
  const fields = {
    url: get('url'),
    text: get('plain'),
    name: get('contact-name'),
    phone: get('contact-phone'),
    email: get('contact-email'),
    color: get('foreground'),
    background: get('background'),
    file: get('logo'),
    canvas: get('qr'),
    status: get('status')
  };

  const canvasSize = 1024;
  const margin = 4;
  const maxImageSize = 2 * 1024 * 1024;
  const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

  let inputType = 'url';
  let centerImage = null;
  let result = null;

  function showMessage(message, isError = false) {
    fields.status.textContent = message;
    fields.status.classList.toggle('error', isError);
  }

  function escapeContact(value) {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/\r?\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
  }

  function readContent() {
    if (inputType === 'text') {
      const value = fields.text.value.trim();
      if (!value) throw new Error('텍스트를 입력하세요.');
      return value;
    }

    if (inputType === 'contact') {
      const name = fields.name.value.trim();
      const phone = fields.phone.value.trim();
      const email = fields.email.value.trim();

      if (!name || !phone) {
        throw new Error('이름과 전화번호를 입력하세요.');
      }
      if (email && !fields.email.checkValidity()) {
        throw new Error('이메일 주소를 확인하세요.');
      }

      const lines = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:' + escapeContact(name),
        'TEL;TYPE=CELL:' + escapeContact(phone)
      ];
      if (email) lines.push('EMAIL:' + escapeContact(email));
      lines.push('END:VCARD');
      return lines.join('\r\n');
    }

    const value = fields.url.value.trim();
    if (!value) throw new Error('URL을 입력하세요.');

    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error('URL 형식을 확인하세요.');
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('HTTP 또는 HTTPS 주소만 사용할 수 있습니다.');
    }
    return value;
  }

  function luminance(color) {
    const channels = color.slice(1).match(/.{2}/g).map((part) => {
      const value = parseInt(part, 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : Math.pow((value + 0.055) / 1.055, 2.4);
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }

  function validColors() {
    const foreground = luminance(fields.color.value);
    const background = luminance(fields.background.value);
    const contrast = (background + 0.05) / (foreground + 0.05);
    return foreground < background && contrast >= 4.5;
  }

  function buildMatrix(value) {
    if (typeof window.qrcode !== 'function') {
      throw new Error('QR 모듈을 불러오지 못했습니다.');
    }

    const utf8 = window.qrcode.stringToBytesFuncs['UTF-8'];
    if (utf8) window.qrcode.stringToBytes = utf8;

    const qr = window.qrcode(0, centerImage ? 'H' : 'M');
    qr.addData(value, 'Byte');
    qr.make();

    const size = qr.getModuleCount();
    return Array.from({ length: size }, (_, row) =>
      Array.from({ length: size }, (_, col) => qr.isDark(row, col))
    );
  }

  function createSvg() {
    const { matrix, foreground, background, image } = result;
    const count = matrix.length;
    const size = count + margin * 2;
    let cells = '';

    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (matrix[row][col]) {
          cells += 'M' + (col + margin) + ' ' + (row + margin) + 'h1v1h-1z';
        }
      }
    }

    let center = '';
    if (image) {
      const side = count * 0.17;
      const start = margin + (count - side) / 2;
      const padding = 0.65;
      center = '<rect x="' + (start - padding) +
        '" y="' + (start - padding) +
        '" width="' + (side + padding * 2) +
        '" height="' + (side + padding * 2) +
        '" fill="' + background +
        '"/><image href="' + image +
        '" x="' + start +
        '" y="' + start +
        '" width="' + side +
        '" height="' + side +
        '" preserveAspectRatio="xMidYMid meet"/>';
    }

    return '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"' +
      ' viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges">' +
      '<rect width="' + size + '" height="' + size + '" fill="' + background + '"/>' +
      '<path d="' + cells + '" fill="' + foreground + '"/>' + center + '</svg>';
  }

  async function renderQr() {
    const snapshot = result;
    const canvas = fields.canvas;
    const context = canvas.getContext('2d');
    const count = snapshot.matrix.length;
    const unit = canvasSize / (count + margin * 2);

    context.fillStyle = snapshot.background;
    context.fillRect(0, 0, canvasSize, canvasSize);
    context.fillStyle = snapshot.foreground;

    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (!snapshot.matrix[row][col]) continue;
        const left = Math.round((col + margin) * unit);
        const top = Math.round((row + margin) * unit);
        const right = Math.round((col + margin + 1) * unit);
        const bottom = Math.round((row + margin + 1) * unit);
        context.fillRect(left, top, right - left, bottom - top);
      }
    }

    if (snapshot.image) {
      const image = new Image();
      image.src = snapshot.image;
      await image.decode();
      if (result !== snapshot) return;

      const side = count * unit * 0.17;
      const start = (canvasSize - side) / 2;
      const padding = unit * 0.65;

      context.fillStyle = snapshot.background;
      context.fillRect(start - padding, start - padding, side + padding * 2, side + padding * 2);
      context.drawImage(image, start, start, side, side);
    }

    if (result !== snapshot) return;
    canvas.style.display = 'block';
    get('placeholder').hidden = true;
    get('png').disabled = false;
    get('svg').disabled = false;
  }

  async function generate() {
    result = null;
    get('png').disabled = true;
    get('svg').disabled = true;

    try {
      const value = readContent();
      if (!validColors()) {
        throw new Error('색상 대비를 높여 주세요.');
      }

      result = {
        matrix: buildMatrix(value),
        foreground: fields.color.value,
        background: fields.background.value,
        image: centerImage
      };

      await renderQr();
      if (result) showMessage('QR 생성 완료');
    } catch (error) {
      result = null;
      showMessage(error.message || 'QR 생성 실패', true);
    }
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function selectInput(type) {
    inputType = type;

    document.querySelectorAll('[data-kind]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.kind === type));
    });

    ['url', 'text', 'contact'].forEach((name) => {
      get(name + '-fields').hidden = name !== type;
    });

    showMessage('');
  }

  function readImage() {
    centerImage = null;
    const file = fields.file.files[0];

    if (!file) {
      showMessage('');
      return;
    }
    if (file.size > maxImageSize || !imageTypes.includes(file.type)) {
      fields.file.value = '';
      showMessage('이미지 형식 또는 크기를 확인하세요.', true);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      centerImage = reader.result;
      showMessage('이미지 선택 완료');
    };
    reader.onerror = () => showMessage('이미지 읽기 실패', true);
    reader.readAsDataURL(file);
  }

  document.querySelectorAll('[data-kind]').forEach((button) => {
    button.addEventListener('click', () => selectInput(button.dataset.kind));
  });

  fields.color.addEventListener('input', () => {
    get('color-code').textContent = fields.color.value;
  });

  fields.background.addEventListener('input', () => {
    get('bg-code').textContent = fields.background.value;
  });

  fields.file.addEventListener('change', readImage);
  get('generate').addEventListener('click', generate);

  get('png').addEventListener('click', () => {
    if (!result) return;
    fields.canvas.toBlob((blob) => {
      if (blob) download(blob, 'my-qr.png');
      else showMessage('PNG 저장 실패', true);
    }, 'image/png');
  });

  get('svg').addEventListener('click', () => {
    if (!result) return;
    const file = new Blob([createSvg()], { type: 'image/svg+xml;charset=utf-8' });
    download(file, 'my-qr.svg');
  });
})();
