import * as THREE from '../vendor/three.module.min.js';
import { columns, columnX, rowGeometry, isSeat } from './metrics.js';

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const COLOR = {
  bg: 0x09090b,
  wall: 0x1c1c20,
  wallFront: 0x0d0d0f,
  ceiling: 0x101012,
  floor: 0x151518,
  tread: 0x2a2a2f,
  panel: 0x26262b,
  seat: 0x7c2630,
  seatBack: 0x5e1c24,
  wheel: 0x24405a,
  mine: 0xff6a3d,
  party: 0xc98a3f,
  head: 0x3a3431,
  stepLight: 0xffb469,
};

export class SeatViewer {
  constructor(el) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    el.prepend(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLOR.bg);
    this.camera = new THREE.PerspectiveCamera(56, 1, 0.05, 300);
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.base = { pos: new THREE.Vector3(0, 10, 20), target: new THREE.Vector3() };
    this.actual = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    this.yaw = 0;
    this.pitch = 0;
    this.mode = 'overview';
    this.tween = null;
    this.hall = null;

    this.resize();
    new ResizeObserver(() => this.resize()).observe(el);
    this.bindDrag();
    this.tick = this.tick.bind(this);
    requestAnimationFrame(this.tick);
  }

  resize() {
    const w = this.el.clientWidth || 1;
    const h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  bindDrag() {
    const c = this.renderer.domElement;
    let last = null;
    c.addEventListener('pointerdown', (e) => {
      last = { x: e.clientX, y: e.clientY };
      c.setPointerCapture(e.pointerId);
      this.el.classList.add('dragging');
    });
    c.addEventListener('pointermove', (e) => {
      if (!last || this.tween) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      if (this.mode === 'seat') {
        this.yaw = THREE.MathUtils.clamp(this.yaw - dx * 0.0035, -0.75, 0.75);
        this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0035, -0.45, 0.45);
      } else {
        this.yaw = THREE.MathUtils.clamp(this.yaw - dx * 0.004, -1.0, 1.0);
      }
    });
    const end = () => {
      last = null;
      this.el.classList.remove('dragging');
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  clear() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const list = Array.isArray(o.material) ? o.material : [o.material];
        list.forEach((m) => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
    this.root.clear();
  }

  load(hall, { occupied, party, frame }) {
    this.frame = frame || {};
    this.clear();
    this.hall = hall;
    const { room, screen } = hall;
    const back = room.depth - screen.setback;
    const front = -screen.setback;
    const W = room.width;

    const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.95, side: THREE.BackSide });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(W, room.height, room.depth), [
      mat(COLOR.wall), mat(COLOR.wall), mat(COLOR.ceiling), mat(COLOR.floor), mat(COLOR.wall), mat(COLOR.wallFront),
    ]);
    shell.position.set(0, room.height / 2, front + room.depth / 2);
    this.root.add(shell);

    const panelMat = new THREE.MeshStandardMaterial({ color: COLOR.panel, roughness: 1 });
    const panelGeo = new THREE.BoxGeometry(0.06, room.height * 0.62, 1.1);
    for (let z = 1.2; z < back - 0.8; z += 1.8) {
      for (const side of [-1, 1]) {
        const p = new THREE.Mesh(panelGeo, panelMat);
        p.position.set(side * (W / 2 - 0.04), room.height * 0.55, z);
        this.root.add(p);
      }
    }

    const treadMat = new THREE.MeshStandardMaterial({ color: COLOR.tread, roughness: 0.9 });
    const lightMat = new THREE.MeshBasicMaterial({ color: COLOR.stepLight });
    const cols = columns(hall);
    const aisleCols = [];
    for (let c = 0; c < cols; c++) if (hall.rows.some(([, l]) => l[c] === '_')) aisleCols.push(c);

    hall.rows.forEach((_, i) => {
      const g = rowGeometry(hall, i);
      if (g.floor <= 0) return;
      const start = g.z - hall.rowPitch / 2 + 0.15;
      const end = i === hall.rows.length - 1 ? back : g.z + hall.rowPitch / 2 + 0.15;
      const d = end - start;
      const tread = new THREE.Mesh(new THREE.BoxGeometry(W, g.floor, d), treadMat);
      tread.position.set(0, g.floor / 2, start + d / 2);
      this.root.add(tread);
      aisleCols.forEach((c) => {
        const led = new THREE.Mesh(new THREE.BoxGeometry(hall.seatWidth * 0.7, 0.025, 0.02), lightMat);
        led.position.set(columnX(hall, c), g.floor - 0.03, start - 0.011);
        this.root.add(led);
      });
    });

    const sy = screen.bottom + screen.height / 2;
    const scr = new THREE.Mesh(
      new THREE.PlaneGeometry(screen.width, screen.height),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
    );
    this.screenMesh = scr;
    this.setFrame(this.frame);
    scr.position.set(0, sy, 0);
    this.root.add(scr);
    const mask = new THREE.Mesh(
      new THREE.PlaneGeometry(screen.width + 0.8, screen.height + 0.8),
      new THREE.MeshBasicMaterial({ color: 0x030303 }),
    );
    mask.position.set(0, sy, -0.02);
    this.root.add(mask);

    this.root.add(new THREE.AmbientLight(0xffffff, 0.9));
    this.root.add(new THREE.HemisphereLight(0xc4d2ec, 0x2a2a30, 1.1));
    const spill = new THREE.PointLight(0xeef4ff, 3.4, 0, 0);
    spill.position.set(0, sy, 3);
    this.root.add(spill);
    const fill = new THREE.DirectionalLight(0xb8c4de, 0.9);
    fill.position.set(0, room.height, back);
    this.root.add(fill);

    const cells = [];
    hall.rows.forEach(([, layout], i) => {
      [...layout].forEach((ch, c) => {
        if (isSeat(ch)) cells.push({ i, c, ch });
      });
    });
    const rec = hall.seat === 'recliner';
    const sw = hall.seatWidth * (rec ? 0.84 : 0.88);
    const cushionGeo = new THREE.BoxGeometry(sw, 0.16, rec ? 0.72 : 0.5);
    const backGeo = new THREE.BoxGeometry(sw, rec ? 0.78 : 0.68, 0.14);
    const armGeo = new THREE.BoxGeometry(0.06, 0.2, rec ? 0.8 : 0.5);
    const seatMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    const armMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.7 });

    this.cushions = new THREE.InstancedMesh(cushionGeo, seatMat, cells.length);
    this.backs = new THREE.InstancedMesh(backGeo, seatMat.clone(), cells.length);
    const arms = new THREE.InstancedMesh(armGeo, armMat, cells.length);
    const m4 = new THREE.Matrix4();
    const lift = rec ? 0.38 : 0.42;
    cells.forEach((cell, k) => {
      const g = rowGeometry(hall, cell.i);
      const x = columnX(hall, cell.c);
      m4.makeTranslation(x, g.floor + lift, g.z + (rec ? 0.08 : 0.02));
      this.cushions.setMatrixAt(k, m4);
      m4.makeTranslation(x, g.floor + lift + (rec ? 0.42 : 0.38), g.z + (rec ? 0.48 : 0.32));
      this.backs.setMatrixAt(k, m4);
      m4.makeTranslation(x - hall.seatWidth / 2 + 0.03, g.floor + lift + 0.14, g.z + 0.05);
      arms.setMatrixAt(k, m4);
    });
    this.cells = cells;
    this.root.add(this.cushions, this.backs, arms);

    this.heads = new THREE.Group();
    this.root.add(this.heads);
    this.occupied = occupied;
    this.paintSeats(party, null);
    this.overview(false);
  }

  setFrame(frame) {
    this.frame = { ...this.frame, ...frame };
    this.paintScreen(null);
    const { art } = this.frame;
    if (!art) return;
    loadArt(art).then((img) => {
      if (img && this.frame.art === art) this.paintScreen(img);
    });
  }

  paintScreen(art) {
    const { screen } = this.hall;
    const tex = new THREE.CanvasTexture(
      paintFrame(screen.width / screen.height, this.frame.scene, this.frame.subtitle, this.hall, art),
    );
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = this.screenMesh.material;
    if (mat.map) mat.map.dispose();
    mat.map = tex;
    mat.needsUpdate = true;
  }

  paintSeats(party, focus) {
    const key = (i, c) => `${i}-${c}`;
    const partyKeys = new Set(party.map((s) => key(s.i, s.c)));
    const focusKey = focus ? key(focus.i, focus.c) : null;
    const col = new THREE.Color();
    this.cells.forEach((cell, k) => {
      const kk = key(cell.i, cell.c);
      let hex = cell.ch === 'W' ? COLOR.wheel : COLOR.seat;
      if (kk === focusKey) hex = COLOR.mine;
      else if (partyKeys.has(kk)) hex = COLOR.party;
      col.setHex(hex);
      this.cushions.setColorAt(k, col);
      col.setHex(hex === COLOR.seat ? COLOR.seatBack : hex).multiplyScalar(0.85);
      this.backs.setColorAt(k, col);
    });
    this.cushions.instanceColor.needsUpdate = true;
    this.backs.instanceColor.needsUpdate = true;

    this.heads.traverse((o) => o.geometry && o.geometry.dispose());
    this.heads.clear();
    const people = this.cells.filter((cell) => {
      const kk = key(cell.i, cell.c);
      return kk !== focusKey && (this.occupied.has(kk) || partyKeys.has(kk));
    });
    if (!people.length) return;
    const rec = this.hall.seat === 'recliner';
    const headGeo = new THREE.SphereGeometry(0.105, 18, 14);
    const bodyGeo = new THREE.CapsuleGeometry(0.15, 0.22, 4, 10);
    const mat = new THREE.MeshStandardMaterial({ color: COLOR.head, roughness: 0.9 });
    const headI = new THREE.InstancedMesh(headGeo, mat, people.length);
    const bodyI = new THREE.InstancedMesh(bodyGeo, mat, people.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const pos = new THREE.Vector3();
    people.forEach((cell, k) => {
      const g = rowGeometry(this.hall, cell.i);
      const x = columnX(this.hall, cell.c);
      const jitter = ((cell.i * 7 + cell.c * 13) % 5) * 0.012;
      pos.set(x, g.eye + 0.03 + jitter, g.z + (rec ? 0.2 : 0.1));
      scl.set(1, 1.18, 1.05);
      m4.compose(pos, q.identity(), scl);
      headI.setMatrixAt(k, m4);
      pos.set(x, g.eye - 0.34 + jitter, g.z + (rec ? 0.26 : 0.16));
      scl.set(1.25, 1, 0.75);
      m4.compose(pos, q.identity(), scl);
      bodyI.setMatrixAt(k, m4);
    });
    this.heads.add(headI, bodyI);
  }

  overviewPose() {
    const { room, screen } = this.hall;
    const back = room.depth - screen.setback;
    return {
      pos: new THREE.Vector3(0, room.height + room.depth * 0.95, back + room.depth * 0.02),
      target: new THREE.Vector3(0, room.height * 0.1, room.depth * 0.4),
    };
  }

  seatPose(i, c) {
    const g = rowGeometry(this.hall, i);
    const s = this.hall.screen;
    return {
      pos: new THREE.Vector3(columnX(this.hall, c), g.eye, g.z),
      target: new THREE.Vector3(0, s.bottom + s.height * 0.38, 0),
    };
  }

  go(pose, mode, animate = true) {
    this.yaw = 0;
    this.pitch = 0;
    if (!animate) {
      this.base = pose;
      this.mode = mode;
      this.tween = null;
      return;
    }
    this.tween = {
      from: { pos: this.actual.pos.clone(), target: this.actual.target.clone() },
      to: pose,
      t0: performance.now(),
      dur: mode === 'seat' ? 1500 : 1100,
      mode,
    };
  }

  overview(animate = true) {
    if (!this.hall) return;
    this.go(this.overviewPose(), 'overview', animate);
  }

  focus(i, c, animate = true) {
    if (!this.hall) return;
    this.go(this.seatPose(i, c), 'seat', animate);
  }

  capture(i, c, w = 640, h = 360) {
    const pose = this.seatPose(i, c);
    const prevAspect = this.camera.aspect;
    const size = this.renderer.getSize(new THREE.Vector2());
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(pose.pos);
    this.camera.lookAt(pose.target);
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/jpeg', 0.86);
    this.renderer.setSize(size.x, size.y, false);
    this.camera.aspect = prevAspect;
    this.camera.updateProjectionMatrix();
    return url;
  }

  tick(now) {
    requestAnimationFrame(this.tick);
    if (!this.hall || !this.el.offsetParent) return;

    let pos;
    let target;
    if (this.tween) {
      const tw = this.tween;
      const k = easeInOut(Math.min(1, (now - tw.t0) / tw.dur));
      pos = tw.from.pos.clone().lerp(tw.to.pos, k);
      target = tw.from.target.clone().lerp(tw.to.target, k);
      if (k >= 1) {
        this.base = tw.to;
        this.mode = tw.mode;
        this.tween = null;
      }
    } else {
      pos = this.base.pos.clone();
      target = this.base.target.clone();
      if (this.mode === 'seat') {
        const dir = target.clone().sub(pos);
        const len = dir.length();
        const sph = new THREE.Spherical().setFromVector3(dir);
        sph.theta += this.yaw;
        sph.phi = THREE.MathUtils.clamp(sph.phi - this.pitch, 0.2, Math.PI - 0.2);
        target = pos.clone().add(new THREE.Vector3().setFromSpherical(sph).setLength(len));
      } else {
        const off = pos.clone().sub(target).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
        pos = target.clone().add(off);
      }
    }
    this.actual.pos.copy(pos);
    this.actual.target.copy(target);
    this.camera.position.copy(pos);
    this.camera.lookAt(target);
    this.renderer.render(this.scene, this.camera);
  }
}

const arts = new Map();

function loadArt(url) {
  if (!arts.has(url)) {
    arts.set(url, new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    }));
  }
  return arts.get(url);
}

function paintFrame(aspect, scene, subtitle, hall, art) {
  const w = 1600;
  const h = Math.round(w / aspect);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');

  if (art) paintArt(g, w, h, art);
  else if (scene === 'credits') paintCredits(g, w, h);
  else paintSky(g, w, h);
  return finish(cv, g, w, h, subtitle, hall.subtitleAt ?? 0.08, hall.subtitleSize ?? 42 / 792);
}

function paintSky(g, w, h) {
  const sky = g.createLinearGradient(0, 0, 0, h * 0.62);
  sky.addColorStop(0, '#3f8fe0');
  sky.addColorStop(0.6, '#8cc6f2');
  sky.addColorStop(1, '#dff0fb');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);

  const sun = g.createRadialGradient(w * 0.74, h * 0.2, 0, w * 0.74, h * 0.2, h * 0.32);
  sun.addColorStop(0, 'rgba(255,255,240,1)');
  sun.addColorStop(0.12, 'rgba(255,250,215,0.9)');
  sun.addColorStop(1, 'rgba(255,250,215,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, w, h);

  g.fillStyle = 'rgba(255,255,255,0.9)';
  [[0.18, 0.2, 1], [0.42, 0.12, 0.7], [0.58, 0.3, 0.85], [0.9, 0.4, 0.6]].forEach(([x, y, k]) => {
    const r = h * 0.05 * k;
    [[-1.6, 0.3], [-0.6, 0], [0.5, -0.3], [1.5, 0.25]].forEach(([dx, dy]) => {
      g.beginPath();
      g.arc(w * x + dx * r, h * y + dy * r, r * (dy < 0 ? 1.3 : 1), 0, Math.PI * 2);
      g.fill();
    });
  });

  const hill = (base, amp, seed, top, bottom) => {
    const fill = g.createLinearGradient(0, base - amp, 0, h);
    fill.addColorStop(0, top);
    fill.addColorStop(1, bottom);
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) {
      g.lineTo(x, base + Math.sin(x * 0.003 + seed) * amp + Math.sin(x * 0.009 + seed * 2.3) * amp * 0.35);
    }
    g.lineTo(w, h);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  };
  hill(h * 0.58, h * 0.06, 0.8, '#9cc3d8', '#b9d6e2');
  hill(h * 0.68, h * 0.05, 2.4, '#7cc25a', '#5ea844');
  hill(h * 0.8, h * 0.04, 4.0, '#9bd36a', '#6fb64c');

  g.fillStyle = '#f6d55c';
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 160; k++) {
    g.beginPath();
    g.arc(rnd() * w, h * (0.86 + rnd() * 0.14), h * 0.004, 0, Math.PI * 2);
    g.fill();
  }
}

function paintArt(g, w, h, img) {
  const cover = Math.max(w / img.width, h / img.height) * 1.15;
  g.filter = 'blur(28px)';
  g.drawImage(img, (w - img.width * cover) / 2, (h - img.height * cover) / 2, img.width * cover, img.height * cover);
  g.filter = 'none';
  const fit = Math.min(w / img.width, h / img.height) * 0.94;
  g.drawImage(img, (w - img.width * fit) / 2, (h - img.height * fit) / 2, img.width * fit, img.height * fit);
}

function paintCredits(g, w, h) {
  g.fillStyle = '#f7f7f4';
  g.fillRect(0, 0, w, h);
  const rows = ['연출', '각본', '촬영', '조명', '미술', '편집', '음악', '음향', '제작'];
  const size = Math.round(h * 0.045);
  const gap = size * 1.9;
  const top = (h - gap * (rows.length - 1)) / 2;
  g.fillStyle = '#16161a';
  g.textBaseline = 'middle';
  rows.forEach((role, k) => {
    const y = top + k * gap;
    g.font = `500 ${size}px Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif`;
    g.textAlign = 'right';
    g.fillText(role, w / 2 - size, y);
    g.font = `700 ${size}px Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif`;
    g.textAlign = 'left';
    g.fillText('○○○', w / 2 + size, y);
  });
}

function finish(cv, g, w, h, subtitle, subAt, subSize) {
  const v = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);

  if (subtitle) {
    const size = Math.round(h * subSize);
    g.font = `600 ${size}px Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.lineJoin = 'round';
    g.lineWidth = size * 0.12;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.fillStyle = '#ffffff';
    const y = h * (1 - subAt);
    g.strokeText(subtitle, w / 2, y);
    g.fillText(subtitle, w / 2, y);
  }
  return cv;
}
