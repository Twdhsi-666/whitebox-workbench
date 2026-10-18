// 白膜资产生成器：全部用基础几何体程序化生成，黏土白模风格
// 每个资产 make() 返回 THREE.Group，原点在物体底部中心
import * as THREE from 'three';
(function () {
  const CLAY = 0xf2efe8, CLAY_D = 0xe3dfd4, GROUND = 0xd9d6cd, DARK = 0xc9c5b8;

  function mat(color, rough) {
    return new THREE.MeshStandardMaterial({ color: color, roughness: rough === undefined ? 0.92 : rough, metalness: 0 });
  }
  function box(w, h, d, color, x, y, z, ry) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x || 0, y || 0, z || 0);
    if (ry) m.rotation.y = ry;
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function cyl(rt, rb, h, color, x, y, z, seg) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 12), mat(color));
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function sph(r, color, x, y, z, sx, sy) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat(color));
    m.position.set(x || 0, y || 0, z || 0);
    if (sx || sy) m.scale.set(sx || 1, sy || 1, 1);
    m.castShadow = true;
    return m;
  }
  function cone(r, h, color, x, y, z, seg) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg || 8), mat(color));
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true;
    return m;
  }

  // ---------- 人物 ----------
  function personStand() {
    const g = new THREE.Group();
    g.add(box(0.5, 0.95, 0.28, CLAY, 0, 1.18, 0));          // 躯干
    g.add(sph(0.21, CLAY, 0, 1.86, 0, 1, 1.08));            // 头
    g.add(box(0.16, 0.85, 0.16, CLAY_D, -0.17, 0.72, 0));   // 左腿
    g.add(box(0.16, 0.85, 0.16, CLAY_D, 0.17, 0.72, 0));    // 右腿
    g.add(box(0.13, 0.78, 0.13, CLAY, -0.36, 1.2, 0));      // 左臂
    g.add(box(0.13, 0.78, 0.13, CLAY, 0.36, 1.2, 0));       // 右臂
    return g;
  }
  function personSit() {
    const g = new THREE.Group();
    g.add(box(0.46, 0.55, 0.26, CLAY, 0, 0.78, 0.05));      // 躯干
    g.add(sph(0.2, CLAY, 0, 1.22, 0.05, 1, 1.05));          // 头
    g.add(box(0.5, 0.14, 0.5, CLAY_D, 0, 0.44, 0.3));       // 大腿
    g.add(box(0.14, 0.4, 0.14, CLAY_D, -0.16, 0.22, 0.52)); // 小腿
    g.add(box(0.14, 0.4, 0.14, CLAY_D, 0.16, 0.22, 0.52));
    g.add(box(0.12, 0.5, 0.12, CLAY, -0.33, 0.82, 0.12));   // 手臂
    g.add(box(0.12, 0.5, 0.12, CLAY, 0.33, 0.82, 0.12));
    g.add(box(0.44, 0.44, 0.14, CLAY_D, 0, 0.44, -0.22));   // 椅背暗示
    return g;
  }
  function personPair() {
    const g = new THREE.Group();
    const a = personStand(); a.position.set(-0.45, 0, 0); a.rotation.y = 0.35;
    const b = personStand(); b.position.set(0.45, 0, 0); b.rotation.y = -0.35; b.scale.set(0.94, 0.94, 0.94);
    g.add(a); g.add(b);
    return g;
  }
  function crowd(n) {
    const g = new THREE.Group();
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const p = personStand();
      p.position.set((i - (n - 1) / 2) * 0.62, 0, (j - (n - 1) / 2) * 0.62);
      p.scale.setScalar(0.9 + ((i * 7 + j * 3) % 5) * 0.02);
      g.add(p);
    }
    return g;
  }

  // ---------- 载具 ----------
  function carSedan() {
    const g = new THREE.Group();
    g.add(box(1.8, 0.5, 4.0, CLAY, 0, 0.62, 0));
    g.add(box(1.6, 0.46, 2.0, CLAY_D, 0, 1.08, -0.15));
    const w = [[-0.85, 1.25], [0.85, 1.25], [-0.85, -1.25], [0.85, -1.25]];
    w.forEach(function (p) {
      const wh = cyl(0.34, 0.34, 0.24, DARK, p[0], 0.34, p[1], 14);
      wh.rotation.z = Math.PI / 2; g.add(wh);
    });
    return g;
  }
  function carTruck() {
    const g = new THREE.Group();
    g.add(box(2.0, 1.5, 2.2, CLAY, 0, 1.25, 1.6));          // 驾驶室
    g.add(box(2.2, 2.0, 4.4, CLAY_D, 0, 1.6, -1.0));        // 货厢
    const w = [[-1.0, 1.5], [1.0, 1.5], [-1.0, -1.4], [1.0, -1.4]];
    w.forEach(function (p) {
      const wh = cyl(0.42, 0.42, 0.26, DARK, p[0], 0.42, p[1], 14);
      wh.rotation.z = Math.PI / 2; g.add(wh);
    });
    return g;
  }
  function bike() {
    const g = new THREE.Group();
    const w1 = cyl(0.36, 0.36, 0.06, DARK, 0, 0.36, 0.62, 16); w1.rotation.x = Math.PI / 2; g.add(w1);
    const w2 = w1.clone(); w2.position.z = -0.62; g.add(w2);
    g.add(box(0.08, 0.08, 1.2, CLAY, 0, 0.62, 0));
    g.add(box(0.08, 0.55, 0.08, CLAY, 0, 0.88, 0.6));
    g.add(box(0.3, 0.06, 0.5, CLAY_D, 0, 1.14, 0.42));      // 车座
    g.add(box(0.06, 0.5, 0.06, CLAY, 0, 1.05, 0.66));
    g.add(box(0.44, 0.05, 0.05, CLAY, 0, 1.28, 0.62));      // 车把
    return g;
  }

  // ---------- 建筑 ----------
  function wall() {
    const g = new THREE.Group();
    g.add(box(4, 2.6, 0.24, CLAY, 0, 1.3, 0));
    g.add(box(0.5, 0.5, 0.1, DARK, -1.2, 1.5, 0.14));       // 窗洞暗示
    g.add(box(0.5, 0.5, 0.1, DARK, 1.2, 1.5, 0.14));
    return g;
  }
  function roomBox() {
    const g = new THREE.Group();
    g.add(box(0.24, 2.7, 5, CLAY, -2.5, 1.35, 0));          // 左墙
    g.add(box(0.24, 2.7, 5, CLAY, 2.5, 1.35, 0));           // 右墙
    g.add(box(5, 2.7, 0.24, CLAY, 0, 1.35, -2.5));          // 后墙
    g.add(box(1.1, 2.1, 0.12, CLAY_D, -1.2, 1.05, 2.44));   // 门
    g.add(box(1.2, 1.2, 0.08, DARK, 1.3, 1.6, 2.44));       // 窗
    return g;
  }
  function house() {
    const g = new THREE.Group();
    g.add(box(4, 2.6, 3.4, CLAY, 0, 1.3, 0));
    const roof = box(4.6, 0.9, 4.0, CLAY_D, 0, 2.95, 0);
    roof.rotation.x = 0; g.add(roof);
    g.add(cone(2.9, 1.3, CLAY_D, 0, 3.5, 0, 4).rotateY(Math.PI / 4));
    g.add(box(0.9, 1.9, 0.12, DARK, 0, 0.95, 1.72));        // 门
    g.add(box(0.9, 0.9, 0.08, DARK, -1.4, 1.6, 1.72));      // 窗
    g.add(box(0.9, 0.9, 0.08, DARK, 1.4, 1.6, 1.72));
    return g;
  }
  function tower() {
    const g = new THREE.Group();
    g.add(box(2.6, 6.5, 2.6, CLAY, 0, 3.25, 0));
    for (let i = 0; i < 4; i++) {
      const f = 2.6 - i * 0.5;
      g.add(box(f, 0.16, f, CLAY_D, 0, 1.4 + i * 1.6, 0)); // 楼层线
    }
    g.add(box(2.9, 0.3, 2.9, CLAY_D, 0, 6.6, 0));
    g.add(box(0.8, 0.8, 0.08, DARK, 0, 4.9, 1.32));
    return g;
  }
  function tent() {
    const g = new THREE.Group();
    const t = cone(2.2, 2.6, CLAY, 0, 1.3, 0, 4);
    t.rotation.y = Math.PI / 4; g.add(t);
    g.add(box(0.9, 1.5, 0.1, DARK, 0, 0.75, 1.5));
    return g;
  }
  function pavilion() {
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      g.add(cyl(0.13, 0.15, 2.6, CLAY, Math.cos(a) * 1.15, 1.3, Math.sin(a) * 1.15, 8));
    }
    g.add(box(3.0, 0.18, 3.0, CLAY_D, 0, 2.66, 0));         // 檐
    const r1 = cone(2.3, 0.9, CLAY_D, 0, 3.4, 0, 4); r1.rotation.y = Math.PI / 4; g.add(r1);
    const r2 = cone(1.2, 0.7, CLAY, 0, 4.05, 0, 4); r2.rotation.y = Math.PI / 4; g.add(r2);
    g.add(sph(0.22, CLAY, 0, 4.55, 0));
    g.add(box(3.0, 0.12, 3.0, CLAY, 0, 0.06, 0));           // 台基
    return g;
  }
  function column() {
    const g = new THREE.Group();
    g.add(box(1.1, 0.3, 1.1, CLAY_D, 0, 0.15, 0));
    g.add(cyl(0.42, 0.46, 4.2, CLAY, 0, 2.4, 0, 12));
    g.add(box(1.1, 0.3, 1.1, CLAY_D, 0, 4.65, 0));
    return g;
  }
  function pyramid() {
    const g = new THREE.Group();
    const p = cone(3.2, 4.4, CLAY, 0, 2.2, 0, 4);
    p.rotation.y = Math.PI / 4; g.add(p);
    return g;
  }
  function templeGate() {
    const g = new THREE.Group();
    g.add(box(6, 0.5, 2.4, CLAY_D, 0, 0.25, 0));
    g.add(box(0.9, 3.2, 1.0, CLAY, -2.2, 1.6, 0));
    g.add(box(0.9, 3.2, 1.0, CLAY, 2.2, 1.6, 0));
    g.add(box(0.9, 3.2, 1.0, CLAY, -0.75, 1.6, 0));
    g.add(box(0.9, 3.2, 1.0, CLAY, 0.75, 1.6, 0));
    g.add(box(6.4, 0.5, 1.6, CLAY_D, 0, 3.45, 0));
    return g;
  }

  // ---------- 自然 ----------
  function tree() {
    const g = new THREE.Group();
    g.add(cyl(0.16, 0.24, 1.6, DARK, 0, 0.8, 0, 8));
    g.add(sph(1.15, CLAY, 0, 2.25, 0, 1, 0.92));
    g.add(sph(0.8, CLAY, 0.55, 1.85, 0.2, 1, 0.9));
    g.add(sph(0.7, CLAY, -0.5, 1.95, -0.25, 1, 0.9));
    return g;
  }
  function palm() {
    const g = new THREE.Group();
    g.add(cyl(0.13, 0.2, 3.4, DARK, 0, 1.7, 0, 8));
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      const leaf = cone(0.32, 2.2, CLAY, Math.cos(a) * 1.0, 3.5, Math.sin(a) * 1.0, 4);
      leaf.rotation.set(Math.PI / 2.4 * Math.cos(a - Math.PI / 2), -a, 0);
      leaf.translateY(1.0);
      g.add(leaf);
    }
    g.add(sph(0.2, DARK, 0, 3.45, 0));
    return g;
  }
  function rock() {
    const g = new THREE.Group();
    const r = sph(0.9, CLAY, 0, 0.55, 0, 1.2, 0.75, 0.9);
    g.add(r);
    g.add(sph(0.5, CLAY_D, 0.85, 0.28, 0.3, 1, 0.7));
    return g;
  }
  function bush() {
    const g = new THREE.Group();
    g.add(sph(0.62, CLAY, 0, 0.5, 0, 1.1, 0.85));
    g.add(sph(0.45, CLAY, 0.5, 0.4, 0.3, 1, 0.8));
    g.add(sph(0.4, CLAY_D, -0.4, 0.35, -0.3, 1, 0.8));
    return g;
  }
  function grass() {
    const g = new THREE.Group();
    g.add(box(2.2, 0.06, 2.2, CLAY, 0, 0.03, 0));
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9, r = 0.6 + (i % 3) * 0.3;
      const b = cone(0.16, 0.5 + (i % 3) * 0.15, CLAY_D, Math.cos(a) * r, 0.3, Math.sin(a) * r, 5);
      g.add(b);
    }
    return g;
  }

  // ---------- 道具 ----------
  function streetlamp() {
    const g = new THREE.Group();
    g.add(cyl(0.07, 0.1, 3.2, DARK, 0, 1.6, 0, 8));
    g.add(box(0.8, 0.1, 0.1, DARK, 0.35, 3.15, 0));
    g.add(box(0.3, 0.16, 0.3, CLAY, 0.68, 3.05, 0));
    return g;
  }
  function table() {
    const g = new THREE.Group();
    g.add(box(1.6, 0.1, 0.9, CLAY, 0, 0.78, 0));
    [[-0.7, -0.35], [0.7, -0.35], [-0.7, 0.35], [0.7, 0.35]].forEach(function (p) {
      g.add(box(0.09, 0.74, 0.09, CLAY_D, p[0], 0.37, p[1]));
    });
    return g;
  }
  function chair() {
    const g = new THREE.Group();
    g.add(box(0.5, 0.08, 0.5, CLAY, 0, 0.46, 0));
    g.add(box(0.5, 0.6, 0.08, CLAY_D, 0, 0.78, -0.21));
    [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]].forEach(function (p) {
      g.add(box(0.06, 0.44, 0.06, CLAY_D, p[0], 0.22, p[1]));
    });
    return g;
  }
  function crate() {
    const g = new THREE.Group();
    g.add(box(0.9, 0.9, 0.9, CLAY, 0, 0.45, 0));
    g.add(box(0.94, 0.1, 0.94, CLAY_D, 0, 0.9, 0));
    return g;
  }
  function bench() {
    const g = new THREE.Group();
    g.add(box(1.8, 0.09, 0.5, CLAY, 0, 0.46, 0));
    g.add(box(1.8, 0.5, 0.09, CLAY, 0, 0.76, -0.22));
    g.add(box(0.12, 0.44, 0.5, CLAY_D, -0.78, 0.22, 0));
    g.add(box(0.12, 0.44, 0.5, CLAY_D, 0.78, 0.22, 0));
    return g;
  }
  function hydrant() {
    const g = new THREE.Group();
    g.add(cyl(0.2, 0.24, 0.7, CLAY, 0, 0.35, 0, 10));
    g.add(sph(0.2, CLAY, 0, 0.72, 0));
    g.add(cyl(0.07, 0.07, 0.3, CLAY_D, 0, 0.85, 0, 8));
    g.add(box(0.34, 0.08, 0.08, CLAY_D, 0, 0.55, 0.22));
    return g;
  }
  function fence() {
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) g.add(cyl(0.05, 0.05, 1.0, CLAY_D, -0.75 + i * 0.5, 0.5, 0, 6));
    g.add(box(2.0, 0.07, 0.07, CLAY, 0, 0.85, 0));
    g.add(box(2.0, 0.07, 0.07, CLAY, 0, 0.45, 0));
    return g;
  }
  function boat() {
    const g = new THREE.Group();
    g.add(box(2.2, 0.5, 5.0, CLAY, 0, 0.3, 0));
    const bow = cone(1.1, 1.4, CLAY, 0, 0.35, 3.1, 4);
    bow.rotation.x = Math.PI / 2; bow.rotation.y = Math.PI / 4; g.add(bow);
    g.add(box(1.4, 0.7, 1.6, CLAY_D, 0, 0.85, -0.6));
    g.add(cyl(0.04, 0.04, 2.2, DARK, 0, 1.7, -1.6, 6));
    return g;
  }
  function sphinx() {
    const g = new THREE.Group();
    g.add(box(1.6, 0.7, 3.2, CLAY, 0, 0.7, 0));             // 身
    g.add(box(1.1, 1.0, 1.2, CLAY, 0, 1.35, 1.7));          // 头胸
    g.add(box(0.9, 0.5, 0.4, CLAY_D, 0, 1.05, 2.35));       // 前爪
    g.add(box(1.5, 0.55, 0.7, CLAY_D, 0, 1.15, -1.7));      // 后身
    return g;
  }
  function obelisk() {
    const g = new THREE.Group();
    g.add(box(1.2, 0.3, 1.2, CLAY_D, 0, 0.15, 0));
    const o = cone(0.42, 5.0, CLAY, 0, 2.8, 0, 4);
    o.rotation.y = Math.PI / 4; g.add(o);
    return g;
  }
  function statue() {
    const g = new THREE.Group();
    g.add(box(1.2, 0.4, 1.2, CLAY_D, 0, 0.2, 0));
    g.add(box(0.7, 1.6, 0.5, CLAY, 0, 1.2, 0));
    g.add(sph(0.3, CLAY, 0, 2.25, 0, 1, 1.15));
    g.add(box(0.9, 0.12, 0.12, CLAY_D, 0, 2.55, 0));
    return g;
  }

  window.WB_ASSETS = [
    { id: 'person-stand', name: '站立的人', cat: 'people', make: personStand },
    { id: 'person-sit', name: '坐姿的人', cat: 'people', make: personSit },
    { id: 'person-pair', name: '两人交谈', cat: 'people', make: personPair },
    { id: 'crowd-3', name: '人群 3×3', cat: 'people', make: function () { return crowd(3); } },
    { id: 'crowd-5', name: '人群 5×5', cat: 'people', make: function () { return crowd(5); } },
    { id: 'car-sedan', name: '轿车', cat: 'vehicles', make: carSedan },
    { id: 'car-truck', name: '货车', cat: 'vehicles', make: carTruck },
    { id: 'bike', name: '自行车', cat: 'vehicles', make: bike },
    { id: 'wall', name: '墙体', cat: 'buildings', make: wall },
    { id: 'room-box', name: '房间', cat: 'buildings', make: roomBox },
    { id: 'house', name: '房子', cat: 'buildings', make: house },
    { id: 'tower', name: '楼房', cat: 'buildings', make: tower },
    { id: 'tent', name: '帐篷', cat: 'buildings', make: tent },
    { id: 'pavilion', name: '亭子', cat: 'buildings', make: pavilion },
    { id: 'column', name: '石柱', cat: 'buildings', make: column },
    { id: 'temple-gate', name: '神庙门', cat: 'buildings', make: templeGate },
    { id: 'pyramid', name: '金字塔', cat: 'buildings', make: pyramid },
    { id: 'tree', name: '树', cat: 'nature', make: tree },
    { id: 'palm', name: '棕榈', cat: 'nature', make: palm },
    { id: 'rock', name: '岩石', cat: 'nature', make: rock },
    { id: 'bush', name: '灌木', cat: 'nature', make: bush },
    { id: 'grass', name: '草丛', cat: 'nature', make: grass },
    { id: 'streetlamp', name: '路灯', cat: 'props', make: streetlamp },
    { id: 'table', name: '桌子', cat: 'props', make: table },
    { id: 'chair', name: '椅子', cat: 'props', make: chair },
    { id: 'crate', name: '箱子', cat: 'props', make: crate },
    { id: 'bench', name: '长椅', cat: 'props', make: bench },
    { id: 'hydrant', name: '消防栓', cat: 'props', make: hydrant },
    { id: 'fence', name: '护栏', cat: 'props', make: fence },
    { id: 'boat', name: '船', cat: 'props', make: boat },
    { id: 'sphinx', name: '狮身像', cat: 'props', make: sphinx },
    { id: 'obelisk', name: '方尖碑', cat: 'props', make: obelisk },
    { id: 'statue', name: '雕像', cat: 'props', make: statue }
  ];
  window.WB_ASSET_CATS = [
    { id: 'people', name: '人物', icon: 'person' },
    { id: 'vehicles', name: '载具', icon: 'car' },
    { id: 'buildings', name: '建筑', icon: 'building' },
    { id: 'nature', name: '自然', icon: 'tree' },
    { id: 'props', name: '道具', icon: 'cube' }
  ];
})();
