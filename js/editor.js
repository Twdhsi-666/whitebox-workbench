// 白膜场景编辑器：Cinemap 导演台精简版
// 轨道相机 / 资产生成放置 / 地面拖拽移动 / 变换检查器 / 机位书签 / 序列化
import * as THREE from 'three';

const SHOT_SIZES = [
  { id: 'full', name: '全景', r: 24 },
  { id: 'medium', name: '中景', r: 13 },
  { id: 'close', name: '近景', r: 7 },
  { id: 'ecu', name: '特写', r: 3.6 }
];

export class EditorApp {
  constructor(container, opts) {
    this.container = container;
    this.opts = opts || {};
    this.objects = [];        // 用户放置的资产 { assetId, group }
    this.envId = 'room';
    this.cams = [];
    this.selected = null;
    this.dragging = null;
    this.camAnim = null;
    this.disposed = false;

    this._initRenderer();
    this._initScene();
    this._initLights();
    this._initCamera();
    this._initEvents();
    this._animate();
  }

  // ---------- 基础 ----------
  _initRenderer() {
    const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.setSize(this.container.clientWidth, this.container.clientHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.domElement.style.display = 'block';
    this.container.appendChild(r.domElement);
    this.renderer = r;
  }
  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xeceae4);
    this.envGroup = new THREE.Group();
    this.assetGroup = new THREE.Group();
    this.scene.add(this.envGroup, this.assetGroup);
    this.grid = new THREE.GridHelper(60, 60, 0xb9b4a6, 0xd6d2c6);
    this.grid.position.y = 0.01;
    this.grid.visible = false;
    this.scene.add(this.grid);
    // 选中框
    this.selBox = new THREE.Box3();
    this.selHelper = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0xd4882a, depthTest: false })
    );
    this.selHelper.visible = false;
    this.selHelper.renderOrder = 999;
    this.scene.add(this.selHelper);
  }
  _initLights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 0.95);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff6e8, 1.2);
    this.sun.position.set(18, 26, 12);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera;
    c.left = -32; c.right = 32; c.top = 32; c.bottom = -32; c.near = 1; c.far = 90;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.25));
  }
  _initCamera() {
    this.camera = new THREE.PerspectiveCamera(45, this.container.clientWidth / this.container.clientHeight, 0.1, 400);
    this.target = new THREE.Vector3(0, 1.2, 0);
    this.sph = { r: 16, phi: 1.05, theta: 0.85 };
    this._applyCamera();
  }
  _applyCamera() {
    const s = this.sph;
    this.camera.position.set(
      this.target.x + s.r * Math.sin(s.phi) * Math.sin(s.theta),
      this.target.y + s.r * Math.cos(s.phi),
      this.target.z + s.r * Math.sin(s.phi) * Math.cos(s.theta)
    );
    this.camera.lookAt(this.target);
  }

  // ---------- 环境 ----------
  loadEnv(envId) {
    this.envId = envId;
    const env = window.WB_ENVIRONMENTS.find(e => e.id === envId) || window.WB_ENVIRONMENTS[0];
    this._clearGroup(this.envGroup);
    const built = env.build();
    built.objects.forEach(o => this.envGroup.add(o));
    this.scene.background = new THREE.Color(built.sky);
    this.scene.fog = new THREE.Fog(built.fog[0], built.fog[1], built.fog[2]);
    this.sun.intensity = built.sun;
    this.target.set(built.tgt[0], built.tgt[1], built.tgt[2]);
    this.sph.r = Math.hypot(built.cam[0], built.cam[2]) || 16;
    this.sph.phi = 1.05; this.sph.theta = Math.atan2(built.cam[0], built.cam[2]);
    this._applyCamera();
    if (this.opts.onStatus) this.opts.onStatus('已加载环境：' + env.name);
  }
  _clearGroup(g) {
    while (g.children.length) {
      const c = g.children[0];
      g.remove(c);
      c.traverse(n => { if (n.geometry) n.geometry.dispose(); });
    }
  }

  // ---------- 资产 ----------
  addAsset(assetId) {
    const def = window.WB_ASSETS.find(a => a.id === assetId);
    if (!def) return null;
    const g = def.make();
    // 放在相机目标前方
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.target).setY(0).normalize();
    const p = new THREE.Vector3().copy(this.target).addScaledVector(dir, 4.5);
    p.x = Math.round(p.x * 2) / 2; p.z = Math.round(p.z * 2) / 2;
    g.position.copy(p);
    this.assetGroup.add(g);
    const rec = { assetId: assetId, group: g };
    this.objects.push(rec);
    this.select(rec);
    if (this.opts.onStatus) this.opts.onStatus('已放置「' + def.name + '」，拖动可移动');
    return rec;
  }
  select(rec) {
    this.selected = rec || null;
    this.selHelper.visible = !!rec;
    if (rec) {
      const b = new THREE.Box3().setFromObject(rec.group);
      const size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      this.selHelper.scale.set(Math.max(size.x, 0.3) * 1.08, Math.max(size.y, 0.3) * 1.08, Math.max(size.z, 0.3) * 1.08);
      this.selHelper.position.copy(c);
      this.selBox.copy(b);
    }
    if (this.opts.onSelect) this.opts.onSelect(rec);
  }
  deleteSelected() {
    if (!this.selected) return;
    const i = this.objects.indexOf(this.selected);
    if (i >= 0) this.objects.splice(i, 1);
    this.assetGroup.remove(this.selected.group);
    this.selected.group.traverse(n => { if (n.geometry) n.geometry.dispose(); });
    this.select(null);
    if (this.opts.onStatus) this.opts.onStatus('已删除');
  }
  // 变换（检查器调用）
  setTransform(prop, v) {
    if (!this.selected) return;
    const g = this.selected.group;
    if (prop === 'x') g.position.x = v;
    else if (prop === 'y') g.position.y = Math.max(0, v);
    else if (prop === 'z') g.position.z = v;
    else if (prop === 'ry') g.rotation.y = v * Math.PI / 180;
    else if (prop === 'scale') g.scale.setScalar(v);
    this.select(this.selected);
  }
  setColor(hex) {
    if (!this.selected) return;
    this.selected.group.traverse(n => {
      if (n.isMesh && n.material && n.material.color) {
        n.material = n.material.clone();
        n.material.color.set(hex);
      }
    });
    this.selected.color = hex;
  }

  // ---------- 相机 ----------
  setShotSize(id) {
    const s = SHOT_SIZES.find(x => x.id === id);
    if (!s) return;
    this._animateCam({ r: s.r });
  }
  saveCam() {
    const n = this.cams.length + 1;
    this.cams.push({
      name: '机位' + n,
      p: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      t: [this.target.x, this.target.y, this.target.z]
    });
    if (this.opts.onCams) this.opts.onCams(this.cams);
    if (this.opts.onStatus) this.opts.onStatus('已保存机位' + n);
  }
  gotoCam(i) {
    const c = this.cams[i];
    if (!c) return;
    this._animateCam({
      r: Math.hypot(c.p[0] - c.t[0], c.p[1] - c.t[1], c.p[2] - c.t[2]),
      phi: Math.acos(Math.max(-1, Math.min(1, (c.p[1] - c.t[1]) / Math.max(0.01, Math.hypot(c.p[0] - c.t[0], c.p[1] - c.t[1], c.p[2] - c.t[2]))))),
      theta: Math.atan2(c.p[0] - c.t[0], c.p[2] - c.t[2]),
      t: new THREE.Vector3(c.t[0], c.t[1], c.t[2])
    });
  }
  _animateCam(to) {
    const from = { r: this.sph.r, phi: this.sph.phi, theta: this.sph.theta, t: this.target.clone() };
    const t0 = performance.now(), dur = 650;
    const step = () => {
      if (this.disposed) return;
      const k = Math.min(1, (performance.now() - t0) / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.sph.r = from.r + (to.r - from.r) * e;
      this.sph.phi = from.phi + (to.phi - from.phi) * e;
      this.sph.theta = from.theta + (to.theta - from.theta) * e;
      if (to.t) this.target.lerpVectors(from.t, to.t, e);
      this._applyCamera();
      if (k < 1) requestAnimationFrame(step);
      else this.camAnim = null;
    };
    if (this.camAnim) cancelAnimationFrame(this.camAnim);
    this.camAnim = requestAnimationFrame(step);
  }

  // ---------- 事件 ----------
  _initEvents() {
    const el = this.renderer.domElement;
    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    let mode = null, lastX = 0, lastY = 0, moved = 0;
    const dragPlane = new THREE.Plane();
    const hitOff = new THREE.Vector3();

    const setPtr = e => {
      const r = el.getBoundingClientRect();
      ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, this.camera);
    };
    const pickables = () => this.assetGroup.children;

    el.addEventListener('pointerdown', e => {
      el.setPointerCapture(e.pointerId);
      moved = 0; lastX = e.clientX; lastY = e.clientY;
      setPtr(e);
      const hits = ray.intersectObjects(pickables(), true);
      if (e.button === 0 && hits.length) {
        let rec = null;
        for (const h of hits) {
          let p = h.object;
          while (p.parent && p.parent !== this.assetGroup) p = p.parent;
          rec = this.objects.find(o => o.group === p);
          if (rec) break;
        }
        if (rec) {
          this.select(rec);
          mode = 'move';
          dragPlane.set(new THREE.Vector3(0, 1, 0), -rec.group.position.y);
          const pt = new THREE.Vector3();
          if (ray.ray.intersectPlane(dragPlane, pt)) hitOff.subVectors(rec.group.position, pt);
          return;
        }
      }
      mode = (e.button === 2 || e.shiftKey) ? 'pan' : 'orbit';
    });
    el.addEventListener('pointermove', e => {
      if (!mode) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      lastX = e.clientX; lastY = e.clientY;
      if (mode === 'orbit') {
        this.sph.theta -= dx * 0.005;
        this.sph.phi = Math.max(0.12, Math.min(1.52, this.sph.phi - dy * 0.005));
        this._applyCamera();
      } else if (mode === 'pan') {
        const s = this.sph.r * 0.0016;
        const fw = new THREE.Vector3().subVectors(this.target, this.camera.position).setY(0).normalize();
        const rt = new THREE.Vector3(fw.z, 0, -fw.x);
        this.target.addScaledVector(rt, -dx * s).addScaledVector(fw, dy * s);
        this._applyCamera();
      } else if (mode === 'move' && this.selected) {
        setPtr(e);
        const pt = new THREE.Vector3();
        if (ray.ray.intersectPlane(dragPlane, pt)) {
          this.selected.group.position.copy(pt.add(hitOff));
          this.select(this.selected);
        }
      }
    });
    const endPtr = e => {
      if (mode === 'move' && moved < 4) { /* 单击不撤销 */ }
      if (mode === 'orbit' && moved < 4) {
        setPtr(e);
        const hits = ray.intersectObjects(pickables(), true);
        if (!hits.length) this.select(null);
      }
      mode = null;
    };
    el.addEventListener('pointerup', endPtr);
    el.addEventListener('pointercancel', () => { mode = null; });
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('wheel', e => {
      e.preventDefault();
      this.sph.r = Math.max(2.2, Math.min(90, this.sph.r * (1 + Math.sign(e.deltaY) * 0.09)));
      this._applyCamera();
    }, { passive: false });

    this._onResize = () => {
      if (this.disposed || !this.container.clientWidth) return;
      this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    };
    window.addEventListener('resize', this._onResize);
  }

  // ---------- 序列化 ----------
  serialize() {
    return {
      v: 1, env: this.envId,
      objects: this.objects.map(o => ({
        id: o.assetId,
        p: [+o.group.position.x.toFixed(3), +o.group.position.y.toFixed(3), +o.group.position.z.toFixed(3)],
        ry: +(o.group.rotation.y * 180 / Math.PI).toFixed(1),
        s: +o.group.scale.x.toFixed(3),
        c: o.color || null
      })),
      cams: this.cams
    };
  }
  loadScene(json) {
    this.loadEnv(json.env || 'room');
    this._clearGroup(this.assetGroup);
    this.objects = [];
    (json.objects || []).forEach(o => {
      const def = window.WB_ASSETS.find(a => a.id === o.id);
      if (!def) return;
      const g = def.make();
      g.position.set(o.p[0], o.p[1], o.p[2]);
      g.rotation.y = (o.ry || 0) * Math.PI / 180;
      g.scale.setScalar(o.s || 1);
      if (o.c) g.traverse(n => {
        if (n.isMesh && n.material) { n.material = n.material.clone(); n.material.color.set(o.c); }
      });
      this.assetGroup.add(g);
      this.objects.push({ assetId: o.id, group: g, color: o.c });
    });
    this.cams = (json.cams || []).map(c => ({ name: c.name, p: c.p, t: c.t }));
    if (this.opts.onCams) this.opts.onCams(this.cams);
    this.select(null);
  }

  // ---------- 截图 ----------
  captureThumb(w, h) {
    w = w || 480; h = h || 270;
    const old = this.renderer.getSize(new THREE.Vector2());
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/jpeg', 0.82);
    this.renderer.setSize(old.x, old.y, false);
    this.camera.aspect = old.x / old.y;
    this.camera.updateProjectionMatrix();
    return url;
  }

  // ---------- 主循环 ----------
  _animate() {
    if (this.disposed) return;
    this._raf = requestAnimationFrame(() => this._animate());
    if (this.selected) {
      const b = new THREE.Box3().setFromObject(this.selected.group);
      const size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      this.selHelper.position.copy(c);
      this.selHelper.scale.set(Math.max(size.x, 0.3) * 1.08, Math.max(size.y, 0.3) * 1.08, Math.max(size.z, 0.3) * 1.08);
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this._clearGroup(this.assetGroup);
    this._clearGroup(this.envGroup);
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
  }
}

export const EDITOR_SHOT_SIZES = SHOT_SIZES;

/* 离屏渲染全部资产缩略图（等距视角，黏土白模） */
EditorApp.makeAssetThumbs = function (size) {
  size = size || 96;
  if (window.__WB_THUMBS) return Promise.resolve(window.__WB_THUMBS);
  return new Promise(resolve => {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setSize(size, size);
    r.shadowMap.enabled = false;
    const sc = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    cam.position.set(6, 5, 6); cam.lookAt(0, 1, 0);
    sc.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 1.15));
    const dl = new THREE.DirectionalLight(0xfff6e8, 1.1);
    dl.position.set(8, 14, 6); sc.add(dl);
    const out = {};
    const list = window.WB_ASSETS;
    let i = 0;
    const next = () => {
      if (i >= list.length) {
        r.dispose();
        window.__WB_THUMBS = out;
        return resolve(out);
      }
      const def = list[i++];
      const g = def.make();
      const b = new THREE.Box3().setFromObject(g);
      const sz = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      const k = 2.4 / Math.max(sz.x, sz.y, sz.z, 0.001);
      g.scale.setScalar(k);
      g.position.sub(c.multiplyScalar(k));
      sc.add(g);
      r.render(sc, cam);
      out[def.id] = r.domElement.toDataURL('image/png');
      sc.remove(g);
      g.traverse(n => { if (n.geometry) n.geometry.dispose(); });
      setTimeout(next, 0);   // 让出主线程，防卡 UI
    };
    next();
  });
};
