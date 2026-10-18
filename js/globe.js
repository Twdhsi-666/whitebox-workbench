/* ============================================================
 * 白膜工作台 · Cinemap 风 3D 地球
 * 星空 + 点阵大陆 + 大气辉光 + 场景标记（有定位=琥珀色 / 未定位=青色故事环）
 * 交互：拖拽旋转（惯性）/ 滚轮缩放 / 悬停高亮 / 点击选中 / 飞行聚焦
 * ============================================================ */
import * as THREE from 'three';

const DEG = Math.PI / 180;

/* 解码陆地点阵（Int16 量化 lat*100, lng*100） */
function decodeLandDots() {
  const b64 = window.LAND_DOTS_B64;
  if (!b64) return [];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const arr = new Int16Array(bytes.buffer);
  const dots = [];
  for (let i = 0; i < arr.length; i += 2) dots.push([arr[i] / 100, arr[i + 1] / 100]);
  return dots;
}

function latLngToVec3(lat, lng, r) {
  const phi = (90 - lat) * DEG, theta = (lng + 180) * DEG;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta)
  );
}

function makeDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

const ATMOSPHERE_VERT = `
varying vec3 vNormal;
void main() {
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const ATMOSPHERE_FRAG = `
varying vec3 vNormal;
void main() {
  float intensity = pow(0.66 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
  gl_FragColor = vec4(0.28, 0.52, 1.0, 1.0) * intensity;
}`;

const COLORS = {
  land: 0x9db8dd,
  ocean: 0x0b1220,
  located: 0xffd250,
  auto: 0x56c4d6,
  dim: 0x3a4358,
  star: 0xcdd8ee,
};

export class CinemapGlobe {
  /**
   * @param {HTMLElement} container 容器（position:relative）
   * @param {{onHover?:Function, onPick?:Function, onBackground?:Function}} handlers
   */
  constructor(container, handlers = {}) {
    this.container = container;
    this.handlers = handlers;
    this.scenes = [];
    this.markerGroups = new Map();   // id -> {group, core, ring, hit, located}
    this.hoveredId = null;
    this.selectedId = null;
    this.dimFilter = null;           // Set|null：非成员变暗
    this.disposed = false;

    /* 相机球坐标 */
    this.sph = { phi: 1.15, theta: 0.7, radius: 3.1 };
    this.sphTarget = { ...this.sph };
    this.autoRotate = true;
    this.idleAt = 0;
    this.flyAnim = null;
    this.pointer = new THREE.Vector2(-10, -10);
    this.pointerActive = false;
    this.dragging = false;
    this.downPos = null;

    this._initRenderer();
    this._buildScene();
    this._bindEvents();
    this._animate();
  }

  /* ---------------- 渲染器 ---------------- */
  _initRenderer() {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 200);
    this.raycaster = new THREE.Raycaster();
    this.clock = new THREE.Clock();

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'globe-labels';
    this.container.appendChild(this.labelLayer);
  }

  /* ---------------- 场景内容 ---------------- */
  _buildScene() {
    /* 星空 */
    const starCount = 2600;
    const pos = new Float32Array(starCount * 3);
    const col = new Float32Array(starCount * 3);
    const c = new THREE.Color();
    for (let i = 0; i < starCount; i++) {
      const r = 55 + Math.random() * 30;
      const t = Math.random() * Math.PI * 2;
      const p = Math.acos(2 * Math.random() - 1);
      pos[i * 3]     = r * Math.sin(p) * Math.cos(t);
      pos[i * 3 + 1] = r * Math.cos(p);
      pos[i * 3 + 2] = r * Math.sin(p) * Math.sin(t);
      const b = 0.35 + Math.random() * 0.65;
      c.setHSL(0.58 + Math.random() * 0.06, 0.35, 0.55 + b * 0.3);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
      size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false,
    })));

    /* 海洋球体 */
    this.scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(0.995, 64, 48),
      new THREE.MeshBasicMaterial({ color: COLORS.ocean })
    ));

    /* 陆地点阵 */
    const dots = decodeLandDots();
    const dpos = new Float32Array(dots.length * 3);
    const dcol = new Float32Array(dots.length * 3);
    const dc = new THREE.Color();
    for (let i = 0; i < dots.length; i++) {
      const v = latLngToVec3(dots[i][0], dots[i][1], 1.003);
      dpos[i * 3] = v.x; dpos[i * 3 + 1] = v.y; dpos[i * 3 + 2] = v.z;
      const b = 0.72 + Math.random() * 0.28;
      dc.setHex(COLORS.land).multiplyScalar(b);
      dcol[i * 3] = dc.r; dcol[i * 3 + 1] = dc.g; dcol[i * 3 + 2] = dc.b;
    }
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
    dotGeo.setAttribute('color', new THREE.BufferAttribute(dcol, 3));
    this.scene.add(new THREE.Points(dotGeo, new THREE.PointsMaterial({
      size: 0.0125, map: makeDotTexture(), vertexColors: true,
      transparent: true, opacity: 0.95, depthWrite: false,
    })));

    /* 大气辉光 */
    this.scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(1.22, 64, 48),
      new THREE.ShaderMaterial({
        vertexShader: ATMOSPHERE_VERT, fragmentShader: ATMOSPHERE_FRAG,
        side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      })
    ));

    this.markerRoot = new THREE.Group();
    this.scene.add(this.markerRoot);
  }

  /* ---------------- 标记 ---------------- */
  _clearMarkers() {
    for (const m of this.markerGroups.values()) {
      this.markerRoot.remove(m.group);
      m.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
    this.markerGroups.clear();
    this.labelLayer.innerHTML = '';
  }

  _addMarker(scene, index, autoCount) {
    const located = !!(scene.location && (scene.location.lat || scene.location.lng));
    let pos;
    if (located) pos = latLngToVec3(scene.location.lat, scene.location.lng, 1.008);
    else {
      /* 未定位场景：沿赤道故事环等距排布 */
      const a = autoCount === 1 ? 0 : (index / Math.max(1, autoCount - 1)) * Math.PI * 2 - Math.PI / 2;
      pos = new THREE.Vector3(Math.cos(a) * 1.008, 0.0, Math.sin(a) * 1.008);
    }
    const color = located ? COLORS.located : COLORS.auto;

    const group = new THREE.Group();
    group.position.copy(pos);
    group.lookAt(pos.clone().multiplyScalar(2));

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.0145, 12, 10),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.98 })
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.024, 0.033, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })
    );
    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 8, 6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    hit.userData.sceneId = scene.id;
    core.userData.sceneId = scene.id;
    group.add(core, ring, hit);
    this.markerRoot.add(group);

    const label = document.createElement('div');
    label.className = 'globe-label';
    label.textContent = scene.title;
    label.style.display = 'none';
    this.labelLayer.appendChild(label);

    this.markerGroups.set(scene.id, { group, core, ring, hit, label, located, phase: Math.random() * Math.PI * 2 });
  }

  setScenes(scenes) {
    this.scenes = scenes;
    this._clearMarkers();
    let autoIdx = 0;
    const autoCount = scenes.filter(s => !(s.location && (s.location.lat || s.location.lng))).length;
    for (const s of scenes) {
      const located = !!(s.location && (s.location.lat || s.location.lng));
      this._addMarker(s, located ? 0 : autoIdx++, autoCount);
    }
    if (this.dimFilter) this._applyDim();
  }

  _applyDim() {
    for (const [id, m] of this.markerGroups) {
      const dim = this.dimFilter && !this.dimFilter.has(id);
      const col = dim ? COLORS.dim : (m.located ? COLORS.located : COLORS.auto);
      m.core.material.color.setHex(col);
      m.ring.material.color.setHex(col);
      m.core.material.opacity = dim ? 0.35 : 0.98;
      m.ring.material.opacity = dim ? 0.18 : 0.55;
    }
  }

  setDimFilter(idSet) { this.dimFilter = idSet; this._applyDim(); }

  focusScene(id) {
    const m = this.markerGroups.get(id);
    if (!m) return;
    const p = m.group.position.clone().normalize();
    const phi = Math.acos(Math.max(-1, Math.min(1, p.y)));
    let theta = Math.atan2(p.z, -p.x);
    if (theta < 0) theta += Math.PI * 2;
    this.flyAnim = {
      from: { ...this.sph }, to: { phi, theta, radius: 2.15 }, t0: performance.now(), dur: 1100,
    };
    this.selectedId = id;
    this._refreshLabels();
  }

  clearSelection() { this.selectedId = null; this._refreshLabels(); }

  _refreshLabels() {
    for (const [id, m] of this.markerGroups) {
      const show = id === this.hoveredId || id === this.selectedId;
      m.label.style.display = show ? 'block' : 'none';
      m.core.scale.setScalar(id === this.selectedId ? 1.7 : 1);
    }
  }

  /* ---------------- 交互 ---------------- */
  _bindEvents() {
    const el = this.renderer.domElement;
    this._onPointerDown = (e) => {
      this.dragging = true;
      this.downPos = { x: e.clientX, y: e.clientY, moved: 0 };
      this.autoRotate = false;
      el.setPointerCapture(e.pointerId);
    };
    this._onPointerMove = (e) => {
      const rect = el.getBoundingClientRect();
      this.pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      this.pointerActive = true;
      if (this.dragging && this.downPos) {
        const dx = e.clientX - this.downPos.x, dy = e.clientY - this.downPos.y;
        this.downPos.moved += Math.abs(dx) + Math.abs(dy);
        this.downPos.x = e.clientX; this.downPos.y = e.clientY;
        this.sphTarget.theta -= dx * 0.005;
        this.sphTarget.phi = Math.max(0.12, Math.min(Math.PI - 0.12, this.sphTarget.phi - dy * 0.005));
        this.flyAnim = null;
      }
    };
    this._onPointerUp = (e) => {
      if (this.dragging && this.downPos && this.downPos.moved < 6) this._handleClick();
      this.dragging = false;
      this.downPos = null;
      this.idleAt = performance.now();
      try { el.releasePointerCapture(e.pointerId); } catch (err) {}
    };
    this._onWheel = (e) => {
      e.preventDefault();
      this.flyAnim = null;
      this.sphTarget.radius = Math.max(1.4, Math.min(5.5, this.sphTarget.radius * (1 + e.deltaY * 0.001)));
      this.idleAt = performance.now();
    };
    el.addEventListener('pointerdown', this._onPointerDown);
    el.addEventListener('pointermove', this._onPointerMove);
    el.addEventListener('pointerup', this._onPointerUp);
    el.addEventListener('pointercancel', this._onPointerUp);
    el.addEventListener('wheel', this._onWheel, { passive: false });

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(this.container);
  }

  _handleClick() {
    const hit = this._pick();
    if (hit) this.handlers.onPick?.(hit);
    else this.handlers.onBackground?.();
  }

  _pick() {
    if (!this.pointerActive) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = [...this.markerGroups.values()].map(m => m.hit);
    const hits = this.raycaster.intersectObjects(targets, false);
    return hits.length ? hits[0].object.userData.sceneId : null;
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /* ---------------- 主循环 ---------------- */
  _animate() {
    if (this.disposed) return;
    requestAnimationFrame(() => this._animate());
    const now = performance.now();
    const dt = this.clock.getDelta();

    /* 飞行聚焦 */
    if (this.flyAnim) {
      const k = Math.min(1, (now - this.flyAnim.t0) / this.flyAnim.dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.sph.phi = this.flyAnim.from.phi + (this.flyAnim.to.phi - this.flyAnim.from.phi) * e;
      this.sph.theta = this.flyAnim.from.theta + (this.flyAnim.to.theta - this.flyAnim.from.theta) * e;
      this.sph.radius = this.flyAnim.from.radius + (this.flyAnim.to.radius - this.flyAnim.from.radius) * e;
      if (k >= 1) this.flyAnim = null;
    } else {
      /* 阻尼跟随 */
      const k = 1 - Math.pow(0.001, dt);
      this.sph.phi += (this.sphTarget.phi - this.sph.phi) * k;
      this.sph.theta += (this.sphTarget.theta - this.sph.theta) * k;
      this.sph.radius += (this.sphTarget.radius - this.sph.radius) * k;
      /* 空闲自动旋转 */
      if (!this.dragging && now - this.idleAt > 4000) this.autoRotate = true;
      if (this.autoRotate && !this.dragging) this.sphTarget.theta += 0.00045 * (dt * 60);
    }

    const { phi, theta, radius } = this.sph;
    this.camera.position.set(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta)
    );
    this.camera.lookAt(0, 0, 0);

    /* 悬停检测 */
    if (this.pointerActive && !this.dragging) {
      const hit = this._pick();
      if (hit !== this.hoveredId) {
        this.hoveredId = hit;
        this.renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
        this.handlers.onHover?.(hit);
        this._refreshLabels();
      }
    }

    /* 标记脉冲 + 标签投影 */
    const rect = this.container.getBoundingClientRect();
    const v = new THREE.Vector3();
    for (const [id, m] of this.markerGroups) {
      const s = 1 + 0.3 * Math.sin(now * 0.003 + m.phase);
      m.ring.scale.setScalar(id === this.selectedId ? s * 1.5 : s);
      m.ring.material.opacity = (id === this.selectedId ? 0.85 : (this.dimFilter && !this.dimFilter.has(id) ? 0.18 : 0.55)) * (1 - 0.35 * (s - 1));
      if (m.label.style.display !== 'none') {
        v.copy(m.group.position).project(this.camera);
        const x = (v.x * 0.5 + 0.5) * rect.width, y = (-v.y * 0.5 + 0.5) * rect.height;
        const behind = v.z > 1;
        m.label.style.transform = `translate(-50%, -140%) translate(${x}px, ${y}px)`;
        m.label.style.opacity = behind ? '0' : '1';
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this._ro?.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this._onPointerDown);
    el.removeEventListener('pointermove', this._onPointerMove);
    el.removeEventListener('pointerup', this._onPointerUp);
    el.removeEventListener('pointercancel', this._onPointerUp);
    el.removeEventListener('wheel', this._onWheel);
    this._clearMarkers();
    this.renderer.dispose();
    el.remove();
    this.labelLayer.remove();
  }
}
