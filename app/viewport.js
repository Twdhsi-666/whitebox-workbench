// 3D 视口：编辑用的自由相机 + 出片用的镜头相机，共用一个渲染器。
// 画幅用 scissor 做真·遮幅（不是拉伸画面），导出时同一套逻辑直接换分辨率。
import * as THREE from '../vendor/three.module.js';
import { buildPreset, applyAction } from '../engine/builder.js';
import { makeFigure, ACTIONS } from '../engine/figure.js';
import { cameraAt, figureAt, timeline } from './state.js';
import { fovFromMM, aspectOf, sampleShot, V } from '../engine/camera.js';

const { sub, len, nrm } = V;
const AXES = {
  front: [0, 0, 1], back: [0, 0, -1], right: [1, 0, 0], left: [-1, 0, 0], top: [0, 1, 0.0001], bottom: [0, -1, 0.0001]
};

export class Viewport {
  constructor(holder, opts = {}) {
    this.holder = holder;
    this.theme = opts.theme || 'dark';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
    holder.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.nav = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 500);
    this.nav.position.set(6, 4, 8);
    this.cam = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 300);

    this.world = new THREE.Group();
    this.overlay = new THREE.Group();
    this.scene.add(this.world, this.overlay);

    this.project = null; this.preset = null; this.built = null;
    this.t = 0;
    this.viewMode = 'free';
    this.aspect = '16:9';
    this.show = { grid: true, frustums: true, paths: true, sunArrow: true, letterbox: true };
    this.selected = null;
    this.pickables = [];
    this.dragMode = 'none';           // none | move | drawPath | place
    this.onSelect = this.onPathPoint = this.onPlace = this.onDragFigure = this.onViewMode = this.onDragMode = null;

    this._figs = new Map();
    this._figureGroup = new THREE.Group();
    this.world.add(this._figureGroup);
    this._box = new THREE.BoxHelper(new THREE.Object3D(), 0xff9a4d);
    this._box.visible = false;
    this.scene.add(this._box);
    this._plane = new THREE.Mesh(new THREE.PlaneGeometry(800, 800).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }));
    this.scene.add(this._plane);

    this.navState = { target: new THREE.Vector3(0, 1.1, 0), radius: 10, orbiting: false, panning: false, lx: 0, ly: 0 };
    this.keys = {};
    this._bindNav();
    this._measure();
  }

  // ---------- 装载 ----------

  setProject(project) {
    this.project = project;
    this.aspect = project.aspect || '16:9';
    this.renderer.shadowMap.enabled = project.look ? project.look.shadows !== false : true;
    this._rebuildFigures();
    this._buildOverlays();
  }

  setPreset(preset) {
    this.preset = preset;
    for (const c of [...this.world.children]) if (c !== this._figureGroup) this.world.remove(c);
    this.pickables = [];
    this.built = buildPreset(preset, { theme: this.theme, edges: !this.project || this.project.look.edges !== false, shadows: true });
    this.world.add(this.built.root);
    for (const it of this.built.items) if (it.kind !== 'floor' && it.kind !== 'person') this.pickables.push(it.node);
    this.setBackground();
    this._rebuildFigures();
    this._buildOverlays();
    return this.built;
  }

  setBackground() {
    this.scene.background = new THREE.Color(this.theme === 'dark' ? 0x0d1015 : 0xe9ecf1);
  }

  setTheme(theme) {
    this.theme = theme;
    if (this.preset) this.setPreset(this.preset); else this.setBackground();
    this._buildOverlays();
  }

  addObject(def) {
    const mats = this.built ? this.built.mats : {};
    const s = def.s || [0.6, 0.6, 0.6];
    const geo = def.t === 'sphere' ? new THREE.SphereGeometry(s[0], 22, 16)
      : def.t === 'cyl' ? new THREE.CylinderGeometry(s[0], s[1] == null ? s[0] : s[1], s[2], s[3] || 20)
      : new THREE.BoxGeometry(s[0], s[1], s[2]);
    const mesh = new THREE.Mesh(geo, mats[def.m] || mats.prop || mats.person);
    mesh.position.set(def.p[0], def.p[1], def.p[2]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.wm = def;
    this.world.add(mesh);
    this.pickables.push(mesh);
    return mesh;
  }

  removeObject(name) {
    const inPreset = this.built && this.built.items.find(i => i.name === name);
    if (inPreset) { inPreset.node.visible = false; inPreset.hiddenByUser = true; return 'hidden'; }
    const extra = this.world.children.find(n => n.userData.wm && n.userData.wm.n === name);
    if (extra) { this.world.remove(extra); this.pickables = this.pickables.filter(p => p !== extra); return 'removed'; }
    return 'none';
  }

  // ---------- 人物 ----------

  _rebuildFigures() {
    if (!this.project || !this.built) return;
    this._figureGroup.clear();
    this._figs = new Map();
    for (const f of this.project.figures) {
      // 用户亲手放的人 = 主角，用强调橙；预设里自带的演员用中性灰，两者一眼分得开
      const parts = makeFigure({ height: f.height || 1.75, name: f.name, material: this.built.mats.accent });
      parts.root.position.set(f.p[0], f.p[1], f.p[2]);
      parts.root.rotation.y = f.facing || 0;
      this._figureGroup.add(parts.root);
      this._figs.set(f.id, { root: parts.root, parts, pose: null });
    }
    this.applyTime(this.t);
  }

  applyTime(t) {
    this.t = t;
    if (!this.project) return;
    for (const f of this.project.figures) {
      const one = this._figs.get(f.id);
      if (!one) continue;
      const st = figureAt(this.project, f, t);
      one.root.position.set(st.p[0], st.p[1], st.p[2]);
      if (st.facing != null) one.root.rotation.y = st.facing;
      const act = st.action || 'stand';
      const a = ACTIONS[act] || ACTIONS.stand;
      // 循环动作按累计时间推相位，脚才不会被拖着滑；单次动作播到 u=1 停住
      const u = a.cycle ? (((t - (f.startT || 0)) / a.cycle) % 1) : 1;
      applyAction(one.parts, act, u, { seatY: f.seatY != null ? f.seatY : 0.45 });
      one.pose = act;
    }
  }

  // ---------- 相机 ----------

  shotCamera(t) {
    const c = cameraAt(this.project, t);
    const a = aspectOf(this.aspect);
    this.cam.aspect = a;
    this.cam.fov = fovFromMM(c.mm, a);
    this.cam.position.set(c.pos[0], c.pos[1], c.pos[2]);
    this.cam.lookAt(c.look[0], c.look[1], c.look[2]);
    this.cam.updateProjectionMatrix();
    return this.cam;
  }

  currentCamera() { return this.viewMode === 'cam' ? this.shotCamera(this.t) : this.nav; }

  snapshotViewAsShot(mm) {
    const p = this.nav.position, tg = this.navState.target;
    return { pos: [p.x, p.y, p.z], look: [tg.x, tg.y, tg.z], mm: mm || 35 };
  }

  // 打开工程时先把自由相机放到预设推荐的第一个机位，别让用户第一眼看见的是墙背
  frameFromPresetCamera(i = 0) {
    const c = this.preset && (this.preset.cameras || [])[i];
    if (!c) return false;
    this.nav.up.set(0, 1, 0);
    this.navState.target.set(c.look[0], c.look[1], c.look[2]);
    this.nav.position.set(c.pos[0], c.pos[1], c.pos[2]);
    this.nav.lookAt(this.navState.target);
    this.navState.radius = Math.max(0.6, len(sub(c.pos, c.look)));
    return true;
  }

  focusOn(node) {
    if (!node) return;
    const box = new THREE.Box3().setFromObject(node);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || 2;
    const dir = nrm(sub(this.nav.position.toArray(), this.navState.target.toArray()));
    this.navState.target.copy(c);
    this.navState.radius = Math.max(1.2, size * 1.5);
    this.nav.position.copy(c).add(new THREE.Vector3(dir[0] * this.navState.radius, dir[1] * this.navState.radius, dir[2] * this.navState.radius));
    this.nav.lookAt(c);
  }

  goAxis(name, reverse) {
    const v = AXES[name];
    if (!v) return;
    const s = this.navState.radius, c = this.navState.target;
    const off = new THREE.Vector3(v[0] * s, v[1] * s, v[2] * s);
    if (reverse) off.negate();
    this.nav.up.set(0, 1, 0);
    this.nav.position.copy(c).add(off);
    if (name === 'top' || name === 'bottom') this.nav.up.set(0, 0, reverse ? 1 : -1);
    this.nav.lookAt(c);
  }

  toggleViewMode() {
    this.viewMode = this.viewMode === 'cam' ? 'free' : 'cam';
    if (this.onViewMode) this.onViewMode(this.viewMode);
    return this.viewMode;
  }

  // ---------- 渲染 ----------

  _measure() {
    const w = this.holder.clientWidth || 800, h = this.holder.clientHeight || 450;
    this.renderer.setSize(w, h, false);
    this._vp = { w, h };
    const a = aspectOf(this.aspect), wa = w / h;
    let vw = w, vh = h;
    if (a > wa) vh = w / a; else vw = h * a;
    this._frame = { x: (w - vw) / 2, y: (h - vh) / 2, w: vw, h: vh };
  }

  draw() {
    const { w, h } = this._vp;
    const cam = this.currentCamera();
    cam.aspect = this.viewMode === 'cam' ? aspectOf(this.aspect) : w / h;
    cam.updateProjectionMatrix();
    if (this.viewMode === 'cam' && this.show.letterbox) {
      const f = this._frame;
      this.renderer.setScissorTest(true);
      this.renderer.setClearColor(0x000000, 1);
      this.renderer.setViewport(f.x, f.y, f.w, f.h);
      this.renderer.setScissor(f.x, f.y, f.w, f.h);
      this.renderer.clear(true, true, true);
      this.renderer.render(this.scene, cam);
      this.renderer.setScissorTest(false);
    } else {
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, w, h);
      this.renderer.render(this.scene, cam);
    }
  }

  // 出片：按目标分辨率渲一整帧，**在还原尺寸之前**把图取出来。
  // 改 canvas 尺寸会清空它的内容，先还原再 toBlob 拿到的就是全黑帧（这个坑踩过一次，263 帧全是 4326 字节的空图）。
  captureFrame(t, outW, outH, quality = 0.92) {
    const prevMode = this.viewMode, prevT = this.t, prevAspect = this.aspect;
    this.viewMode = 'cam';
    this.aspect = `${outW}:${outH}`;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(outW, outH, false);
    this.t = t;
    this.applyTime(t);
    const cam = this.shotCamera(t);
    cam.aspect = outW / outH;
    cam.updateProjectionMatrix();
    const wasOverlay = this.overlay.visible;
    this.overlay.visible = false;
    this._box.visible = false;
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, outW, outH);
    this.renderer.render(this.scene, cam);
    const dataURL = this.renderer.domElement.toDataURL('image/jpeg', quality);
    this.overlay.visible = wasOverlay;
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.setSize(this._vp.w, this._vp.h, false);
    this.aspect = prevAspect;
    this.viewMode = prevMode;
    this.t = prevT;
    return dataURL;
  }

  renderFrameAt(t, outW, outH) { return this.captureFrame(t, outW, outH); }

  // ---------- 叠加层 ----------

  _buildOverlays() {
    this.overlay.clear();
    const preset = this.preset;
    if (!preset) return;
    if (this.show.grid) {
      const size = preset.ground ? Math.max(...preset.ground.size) : 30;
      const g = new THREE.GridHelper(size, Math.max(4, Math.round(size / 2)), 0x66738a, 0x2f3742);
      g.position.y = 0.003;
      if (g.material) { g.material.transparent = true; g.material.opacity = 0.45; }
      this.overlay.add(g);
    }
    if (this.show.sunArrow && this.built && this.built.sun) {
      const d = this.built.sun.userData.dir || [-0.5, 1, 0.35];
      const v = new THREE.Vector3(...d).normalize();
      const arrow = new THREE.ArrowHelper(v, new THREE.Vector3(0, 3.2, 0), 2.2, 0xffd250, 0.7, 0.4);
      this.overlay.add(arrow);
    }
    if (this.show.paths && this.project) {
      for (const f of this.project.figures) {
        if (!f.path || f.path.length < 2) continue;
        const pts = f.path.map(p => new THREE.Vector3(p[0], 0.025, p[1]));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x4fd1c5 }));
        this.overlay.add(line);
        for (let i = 0; i < f.path.length; i++) {
          const p = f.path[i];
          const dot = new THREE.Mesh(new THREE.SphereGeometry(i === 0 ? 0.09 : 0.06, 10, 8), new THREE.MeshBasicMaterial({ color: i === 0 ? 0xffd250 : 0x4fd1c5 }));
          dot.position.set(p[0], 0.04, p[1]);
          this.overlay.add(dot);
        }
      }
    }
    if (this.show.frustums && this.project) {
      const rows = timeline(this.project).rows;
      const a = aspectOf(this.aspect);
      this.project.shots.forEach((s, i) => {
        const c = sampleShot(s, 0, rows[i] ? rows[i].t0 : 0, {});
        const hc = new THREE.PerspectiveCamera(fovFromMM(c.mm, a), a, 0.1, 100);
        hc.position.set(c.pos[0], c.pos[1], c.pos[2]);
        hc.lookAt(c.look[0], c.look[1], c.look[2]);
        hc.updateProjectionMatrix();
        const helper = new THREE.CameraHelper(hc);
        const on = i === this.selectedShotIndex;
        if (helper.material) {
          helper.material.transparent = true;
          helper.material.opacity = on ? 0.95 : 0.22;
          helper.material.color.setHex(on ? 0xff9a4d : 0x8b9bb0);
          helper.material.depthTest = on;
        }
        this.overlay.add(helper);
      });
    }
  }

  refreshOverlays() { this._measure(); this._buildOverlays(); }

  setSelected(sel) {
    this.selected = sel;
    const node = this.selectedNode();
    if (node) { this._box.setFromObject(node); this._box.visible = true; }
    else this._box.visible = false;
    if (this.onSelect) this.onSelect(sel);
  }

  selectedNode() {
    if (!this.selected) return null;
    if (this.selected.type === 'figure') { const one = this._figs.get(this.selected.id); return one && one.root; }
    const inPreset = this.built && this.built.items.find(i => i.name === this.selected.id);
    if (inPreset) return inPreset.node;
    return this.world.children.find(n => n.userData.wm && n.userData.wm.n === this.selected.id) || null;
  }

  setDragMode(mode) {
    this.dragMode = mode;
    this.renderer.domElement.style.cursor = mode === 'drawPath' ? 'crosshair' : mode === 'place' ? 'copy' : '';
    if (this.onDragMode) this.onDragMode(mode);
  }

  // ---------- 交互 ----------

  _bindNav() {
    const el = this.renderer.domElement;
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture(e.pointerId);
      this.navState.lx = e.clientX; this.navState.ly = e.clientY;
      if (e.button === 2 || e.button === 1) this.navState.orbiting = true;
      else if (e.button === 0) {
        if (this.dragMode === 'drawPath' || this.dragMode === 'place') {
          const p = this._groundPoint(e);
          if (p && this.dragMode === 'drawPath' && this.onPathPoint) this.onPathPoint(p);
          else if (p && this.dragMode === 'place' && this.onPlace) this.onPlace(p);
        } else { this._pick(e); this.navState.panning = true; }
      }
    });
    el.addEventListener('pointermove', e => {
      const dx = e.clientX - this.navState.lx, dy = e.clientY - this.navState.ly;
      this.navState.lx = e.clientX; this.navState.ly = e.clientY;
      if (this.navState.orbiting) this._orbit(dx, dy);
      else if (this.navState.panning && this.dragMode === 'move' && this.selected && this.selected.type === 'figure' && this.onDragFigure) {
        const p = this._groundPoint(e); if (p) this.onDragFigure(this.selected.id, p);
      } else if (this.navState.panning && (e.shiftKey || this.dragMode !== 'none')) this._pan(dx, dy);
    });
    const up = () => { this.navState.orbiting = false; this.navState.panning = false; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const off = sub(this.nav.position.toArray(), this.navState.target.toArray());
      const nl = Math.max(0.4, Math.min(200, len(off) * Math.exp(e.deltaY * 0.0015)));
      this.nav.position.copy(this.navState.target).add(new THREE.Vector3(...nrm(off).map(v => v * nl)));
      this.navState.radius = nl;
      this.nav.lookAt(this.navState.target);
    }, { passive: false });

    addEventListener('keydown', e => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      this.keys[e.code] = true;
      this._hotkey(e);
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
  }

  // 笔记本没小键盘：主键盘 1/3/7/9 = 前/右/顶/后，Ctrl 反向，0 切相机视角，. 聚焦选中
  _hotkey(e) {
    const digit = { Digit1: 'front', Numpad1: 'front', Digit3: 'right', Numpad3: 'right', Digit7: 'top', Numpad7: 'top', Digit9: 'back', Numpad9: 'back' }[e.code];
    if (digit) { this.goAxis(digit, e.ctrlKey || e.metaKey); e.preventDefault(); return; }
    if (e.code === 'Numpad0' || e.code === 'Digit0') { this.toggleViewMode(); e.preventDefault(); return; }
    if (e.code === 'Period' || e.code === 'NumpadDecimal') { this.focusOn(this.selectedNode()); e.preventDefault(); return; }
    if (e.code === 'KeyG') { this.setDragMode(this.dragMode === 'move' ? 'none' : 'move'); return; }
    if (e.code === 'Escape') this.setDragMode('none');
  }

  _orbit(dx, dy) {
    const t = this.navState.target;
    const off = sub(this.nav.position.toArray(), t.toArray());
    // "抓住场景转"：鼠标往哪走，画面里的东西就往哪走（与 Blender / OrbitControls 同向）
    const yaw = dx * 0.006, pitch = dy * 0.006;
    const [x, y, z] = off;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const nx = x * cy - z * sy, nz = x * sy + z * cy;
    const horiz = Math.hypot(nx, nz);
    const r = Math.hypot(x, y, z);
    const ang = Math.max(-1.5, Math.min(1.5, Math.atan2(y, horiz) + pitch));
    const hy = r * Math.sin(ang), hr = r * Math.cos(ang);
    const k = hr / Math.max(1e-6, horiz);
    this.nav.position.set(t.x + nx * k, t.y + hy, t.z + nz * k);
    this.nav.lookAt(t);
    this.navState.radius = r;
  }

  _pan(dx, dy) {
    const fwd = nrm(sub(this.navState.target.toArray(), this.nav.position.toArray()));
    const right = nrm([-fwd[2], 0, fwd[0]]);
    const up = nrm(cross3(right, fwd));
    const k = this.navState.radius * 0.0018;
    const move = new THREE.Vector3(
      -right[0] * dx * k + up[0] * dy * k,
      -right[1] * dx * k + up[1] * dy * k,
      -right[2] * dx * k + up[2] * dy * k
    );
    this.navState.target = this.navState.target.clone().add(move);
    this.nav.position.copy(this.nav.position).add(move);
    this.nav.lookAt(this.navState.target);
  }

  _screenRay(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(nx, ny), this.currentCamera());
    return rc;
  }

  _groundPoint(e) {
    const rc = this._screenRay(e);
    const hit = rc.intersectObject(this._plane, false)[0];
    if (hit) return [hit.point.x, hit.point.z];
    const p = new THREE.Vector3();
    return rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? [p.x, p.z] : null;
  }

  _pick(e) {
    const hits = this._screenRay(e).intersectObjects([...this._figs.values()].map(v => v.root).concat(this.pickables), true);
    if (!hits.length) { this.setSelected(null); return; }
    let node = hits[0].object;
    const figEntry = [...this._figs.entries()].find(([, v]) => isAncestor(v.root, node));
    if (figEntry) { this.setSelected({ type: 'figure', id: figEntry[0] }); return; }
    let n = node;
    while (n && n !== this.scene) {
      const inPreset = this.built && this.built.items.find(i => i.node === n);
      if (inPreset) { this.setSelected({ type: 'item', id: inPreset.name }); return; }
      if (n.userData && n.userData.wm) { this.setSelected({ type: 'item', id: n.userData.wm.n }); return; }
      n = n.parent;
    }
  }

  tickFly(dt) {
    if (this.viewMode !== 'free') return false;
    const k = this.keys;
    const speed = (k.ShiftLeft || k.ShiftRight ? 8 : 2.6) * dt;
    const fwd = nrm(sub(this.navState.target.toArray(), this.nav.position.toArray()));
    const right = nrm([-fwd[2], 0, fwd[0]]);
    let mv = [0, 0, 0];
    const acc = (v, s) => { mv = [mv[0] + v[0] * s, mv[1] + v[1] * s, mv[2] + v[2] * s]; };
    if (k.KeyW) acc(fwd, speed);
    if (k.KeyS) acc(fwd, -speed);
    if (k.KeyD) acc(right, speed);
    if (k.KeyA) acc(right, -speed);
    if (k.KeyE) acc([0, 1, 0], speed);
    if (k.KeyQ) acc([0, -1, 0], speed);
    if (!mv[0] && !mv[1] && !mv[2]) return false;
    const d = new THREE.Vector3(...mv);
    this.nav.position.add(d);
    this.navState.target.add(d);
    this.nav.lookAt(this.navState.target);
    this.navState.radius = len(sub(this.nav.position.toArray(), this.navState.target.toArray()));
    return true;
  }

  resize() { this._measure(); this._buildOverlays(); }

  start() {
    let last = performance.now();
    const loop = now => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      this.tickFly(dt);
      if (this.holder.clientWidth && (Math.abs(this.holder.clientWidth - this._vp.w) > 1 || Math.abs(this.holder.clientHeight - this._vp.h) > 1)) this._measure();
      this.draw();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() { cancelAnimationFrame(this._raf); }
}

function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function isAncestor(ancestor, node) { let n = node; while (n) { if (n === ancestor) return true; n = n.parent; } return false; }
