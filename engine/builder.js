// schema 数据 → three.js 场景图。同时产出 registry（名字/包围盒/类别），体检和大纲树都读它。
import * as THREE from '../vendor/three.module.js';
import { makeFigure, applyAction, resetFigure } from './figure.js';

// 亮度档：白膜靠明度分层，不靠颜色。accent/person 用椰子橙做强调。
export const PALETTE = {
  ground:   { l: 0.30, accent: false },
  floor:    { l: 0.42, accent: false },
  road:     { l: 0.26, accent: false },
  sidewalk: { l: 0.52, accent: false },
  building: { l: 0.60, accent: false },
  wall:     { l: 0.70, accent: false },
  furniture:{ l: 0.80, accent: false },
  prop:     { l: 0.88, accent: false },
  foliage:  { l: 0.66, accent: false },
  glass:    { l: 0.86, accent: false, opacity: 0.28 },
  person:   { l: 0.94, accent: false },
  accent:   { l: 1.00, accent: true },
  mark:     { l: 1.00, accent: true, wire: true }
};

const ACCENT = 0xff9a4d;
const KIND_BY_MAT = {
  ground: 'floor', floor: 'floor', road: 'floor', sidewalk: 'floor',
  building: 'wall', wall: 'wall', glass: 'glass',
  furniture: 'prop', prop: 'prop', foliage: 'prop',
  person: 'person', accent: 'subject', mark: 'mark'
};

function colorFor(m) {
  const p = PALETTE[m] || PALETTE.prop;
  if (p.accent) return new THREE.Color(ACCENT).multiplyScalar(0.9 + p.l * 0.1);
  const base = 0.42 + p.l * 0.5;
  return new THREE.Color(base, base * 0.99, base * 0.96);
}

export function makeMaterials(theme) {
  const mats = {};
  for (const m of Object.keys(PALETTE)) {
    const p = PALETTE[m];
    const mat = new THREE.MeshLambertMaterial({ color: colorFor(m) });
    if (p.opacity != null) { mat.transparent = true; mat.opacity = p.opacity; }
    if (p.wire) { mat.visible = false; }
    mats[m] = mat;
  }
  mats.__edge = new THREE.LineBasicMaterial({ color: theme === 'light' ? 0x2a2f36 : 0xdfe6ee, transparent: true, opacity: 0.55 });
  mats.__mark = new THREE.LineBasicMaterial({ color: ACCENT });
  return mats;
}

function geoFor(o) {
  const s = o.s || [1, 1, 1];
  switch (o.t) {
    case 'box': return new THREE.BoxGeometry(s[0], s[1], s[2]);
    case 'cyl': return new THREE.CylinderGeometry(s[0], s[1] != null ? s[1] : s[0], s[2], s[3] || 20);
    case 'sphere': return new THREE.SphereGeometry(s[0], 22, 16);
    case 'plane': return new THREE.PlaneGeometry(s[0], s[1]).rotateX(-Math.PI / 2);
    default: return null;
  }
}

function sizeOf(o) {
  const s = o.s || [1, 1, 1];
  if (o.t === 'box') return [s[0], s[1], s[2]];
  if (o.t === 'cyl') return [Math.max(s[0], s[1]) * 2, s[2], Math.max(s[0], s[1]) * 2];
  if (o.t === 'sphere') return [s[0] * 2, s[0] * 2, s[0] * 2];
  if (o.t === 'plane') return [s[0], 0, s[1]];
  return [0, 0, 0];
}

function markRing(r, mats) {
  const seg = 40, pts = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, 0.012, Math.sin(a) * r));
  }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mats.__mark);
}

let seq = 0;

export function buildPreset(preset, opts = {}) {
  const theme = opts.theme || 'dark';
  const showEdges = opts.edges !== false;
  const mats = makeMaterials(theme);
  const root = new THREE.Group();
  root.name = preset.id || 'preset_' + (++seq);
  const items = [];
  const figures = [];
  const warnings = [];

  const push = (node, def, centerWorld, sizeWorld, kind, gid, inh) => {
    const name = def.n || (kind + '_' + items.length);
    if (items.some(i => i.name === name)) warnings.push({ lvl: 'warn', msg: `重名 "${name}"，已自动加后缀` });
    node.name = name;
    const box = new THREE.Box3().setFromObject(node);
    items.push({
      name, kind, mat: def.m || 'prop', node, box,
      center: [centerWorld[0], centerWorld[1], centerWorld[2]],
      size: sizeWorld, def, gid: gid || '',
      hang: !!(def.hang || (inh && inh.hang)),
      scope: def.scope || (inh && inh.scope) || null,
      solid: !['glass', 'mark', 'plane'].includes(def.t) && (def.m !== 'mark')
    });
  };

  const walk = (list, parent, origin, gid, inh) => {
    inh = inh || {};
    for (const o of list || []) {
      const p = [(o.p ? o.p[0] : 0) + origin[0], (o.p ? o.p[1] : 0) + origin[1], (o.p ? o.p[2] : 0) + origin[2]];
      if (o.t === 'group') {
        const g = new THREE.Group();
        g.position.set(...p);
        if (o.rot) g.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
        parent.add(g);
        // hang / scope 往下继承：吊灯组写一次，灯杆灯罩都不用再各写一遍
        walk(o.children, g, [0, 0, 0], (gid ? gid + '/' : '') + (o.n || 'g'), {
          hang: !!(o.hang || inh.hang), scope: o.scope || inh.scope
        });
        continue;
      }
      if (o.t === 'figure') {
        const fg = makeFigure({ height: (o.s && o.s[0]) || 1.75, name: o.n, material: mats.person });
        fg.root.position.set(...p);
        fg.root.rotation.y = o.facing != null ? o.facing : (o.rot ? o.rot[1] : 0);
        // u=1：静态摆位要摆成动作做完的样子，否则"坐下"的人腿还垂着插进地板
        if (o.action) applyAction(fg, o.action, 1, { seatY: o.seatY });
        parent.add(fg.root);
        figures.push({ fig: fg, def: o, baseY: p[1] });
        const h = (o.s && o.s[0]) || 1.75;
        push(fg.root, o, p, [0.45, h, 0.35], 'person', gid, inh);
        continue;
      }
      if (o.t === 'mark' || o.m === 'mark') {
        const g = new THREE.Group();
        g.position.set(...p);
        g.add(markRing((o.s && o.s[0]) || 0.32, mats));
        parent.add(g);
        push(g, o, p, [0.64, 0, 0.64], 'mark', gid, inh);
        continue;
      }
      const geo = geoFor(o);
      if (!geo) { warnings.push({ lvl: 'warn', msg: `图元 "${o.t}" 不认识，跳过 ${o.n || ''}` }); continue; }
      const mesh = new THREE.Mesh(geo, mats[o.m] || mats.prop);
      mesh.position.set(...p);
      if (o.rot) mesh.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
      mesh.castShadow = o.m !== 'glass';
      mesh.receiveShadow = true;
      parent.add(mesh);
      if (showEdges && o.t !== 'plane') {
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 12), mats.__edge);
        e.position.copy(mesh.position);
        e.rotation.copy(mesh.rotation);
        e.name = '__edge';
        parent.add(e);
      }
      if (o.hidden) mesh.visible = false;
      const sz = sizeOf(o);
      push(mesh, o, p, sz, KIND_BY_MAT[o.m] || KIND_BY_MAT.prop, gid, inh);
    }
  };

  root.updateMatrixWorld(true);
  walk(preset.objects, root, [0, 0, 0], '', {});

  if (preset.ground) {
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(preset.ground.size[0], preset.ground.size[1]).rotateX(-Math.PI / 2),
      mats[preset.ground.m] || mats.ground
    );
    g.receiveShadow = true;
    g.name = (preset.ground.n) || '地面';
    root.add(g);
    items.unshift({ name: g.name, kind: 'floor', mat: preset.ground.m || 'ground', node: g, box: new THREE.Box3().setFromObject(g), center: [0, 0, 0], size: [preset.ground.size[0], 0, preset.ground.size[1]], def: preset.ground, solid: false });
  }

  const lights = new THREE.Group();
  lights.name = '灯光';
  root.add(lights);
  let sun = null, amb = null;
  for (const L of preset.lights || []) {
    if (L.t === 'sun') {
      sun = new THREE.DirectionalLight(0xffffff, L.intensity || 1);
      const d = new THREE.Vector3(...(L.dir || [-0.5, 1, 0.35])).normalize();
      sun.position.copy(d).multiplyScalar(28);
      sun.target.position.set(0, 1, 0);
      sun.castShadow = opts.shadows !== false;
      if (sun.castShadow) {
        sun.shadow.mapSize.set(2048, 2048);
        const c = sun.shadow.camera;
        const r = Math.max(...(preset.ground ? preset.ground.size : [30, 30])) * 0.75 + 4;
        c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 1; c.far = 90;
        c.updateProjectionMatrix();
      }
      lights.add(sun, sun.target);
      sun.userData.dir = [d.x, d.y, d.z];
    } else if (L.t === 'amb') {
      amb = new THREE.AmbientLight(0xffffff, L.intensity || 0.45);
      lights.add(amb);
    } else if (L.t === 'point') {
      const pl = new THREE.PointLight(new THREE.Color(L.color || '#ffffff'), L.intensity || 8, L.distance || 0, 2);
      pl.position.set(...L.pos);
      lights.add(pl);
    }
  }
  if (!sun) {
    sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.position.set(-10, 20, 7);
    sun.userData.dir = [-0.42, 0.84, 0.35];
    lights.add(sun, sun.target);
    warnings.push({ lvl: 'warn', msg: '预设没有 sun 光源，已补一个默认主光' });
  }

  // 二次遍历：group/figure 的包围盒要按世界坐标算
  root.updateMatrixWorld(true);
  for (const it of items) it.box = new THREE.Box3().setFromObject(it.node);

  return { root, items, figures, sun, amb, mats, warnings, preset };
}

export { resetFigure, applyAction };
