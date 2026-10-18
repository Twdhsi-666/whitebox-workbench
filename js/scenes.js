// 白膜环境预设：地面 + 天空 + 灯光 + 默认机位
import * as THREE from 'three';
(function () {
  function ground(size, color, receive) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ color: color, roughness: 0.96 })
    );
    m.rotation.x = -Math.PI / 2;
    m.receiveShadow = true;
    return m;
  }
  function box(w, h, d, color, x, y, z, ry) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: color, roughness: 0.92 }));
    m.position.set(x || 0, y || 0, z || 0);
    if (ry) m.rotation.y = ry;
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function cyl(rt, rb, h, color, x, y, z, seg) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 12),
      new THREE.MeshStandardMaterial({ color: color, roughness: 0.92 }));
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  function envRoom() {
    const objs = [];
    objs.push(box(14, 0.2, 14, 0xcfc9bb, 0, -0.1, 0));                       // 地板
    objs.push(box(14, 3.2, 0.3, 0xe8e4da, 0, 1.6, -7));                       // 后墙
    objs.push(box(0.3, 3.2, 14, 0xe8e4da, -7, 1.6, 0));                       // 左墙
    objs.push(box(0.3, 3.2, 14, 0xe0dcd2, 7, 1.6, 0));                        // 右墙
    objs.push(box(2.2, 2.2, 0.1, 0xd5d0c2, -3.5, 1.5, 6.85));                 // 窗
    objs.push(box(1.1, 2.2, 0.1, 0xcfc9bb, 4.5, 1.1, 6.85));                  // 门
    objs.push(box(3.2, 0.08, 1.2, 0xddd8ca, -4, 0.78, 2));                    // 桌
    for (const [lx, lz] of [[-1.4, 0.45], [-1.4, -0.45], [1.4, 0.45], [1.4, -0.45]])
      objs.push(box(0.09, 0.74, 0.09, 0xd3cec0, -4 + lx, 0.37, 2 + lz));      // 桌腿
    return { objects: objs, sky: 0xeceae4, fog: [0xeceae4, 30, 70], sun: 1.15, cam: [4.5, 4.5, 5.5], tgt: [0, 1.2, 0] };
  }
  function envStreet() {
    const objs = [];
    objs.push(ground(120, 0xc4c8bc));
    objs.push(box(120, 0.06, 9, 0xb9bdc0, 0, 0.03, 0));                       // 柏油路
    for (let i = -5; i <= 5; i++) objs.push(box(2.4, 0.04, 0.22, 0xe8e6df, i * 5, 0.05, 0)); // 车道线
    objs.push(box(120, 0.24, 5, 0xd3d6cb, 0, 0.12, 8.5));                     // 人行道
    objs.push(box(120, 0.24, 5, 0xd3d6cb, 0, 0.12, -8.5));
    for (let i = -4; i <= 4; i++) {
      if (i === 0) continue;
      objs.push(box(5, 7 + (i % 3) * 1.5, 6, 0xe2ded4, i * 11, (7 + (i % 3) * 1.5) / 2, 13.5));
      objs.push(box(5, 6 + ((i + 1) % 3) * 1.5, 6, 0xdcd8cc, i * 11, (6 + ((i + 1) % 3) * 1.5) / 2, -13.5));
    }
    for (let i = -3; i <= 3; i++) {                                           // 路灯
      const l = cyl(0.07, 0.09, 3.2, 0xb5b2a6, i * 9 + 4.5, 1.6, 8.5, 8);
      objs.push(l); objs.push(box(0.8, 0.1, 0.1, 0xb5b2a6, i * 9 + 4.5 + 0.35, 3.15, 8.5));
    }
    return { objects: objs, sky: 0xdfe3e6, fog: [0xdfe3e6, 40, 110], sun: 1.25, cam: [14, 11, 16], tgt: [0, 1, 0] };
  }
  function envTemple() {
    const objs = [];
    objs.push(ground(140, 0xd6cfbc));
    objs.push(box(16, 0.6, 26, 0xe0dccd, 0, 0.3, 0));                        // 主台
    for (let i = -1; i <= 1; i++) objs.push(box(1.0, 4.2, 1.0, 0xefeade, i * 4, 2.7, -8)); // 柱
    objs.push(box(14, 0.5, 1.6, 0xe0dccd, 0, 4.7, -8));                       // 楣
    const gate = box(9, 3.4, 1.2, 0xe6e1d2, 0, 2.4, -10.2); objs.push(gate);
    objs.push(box(7, 0.5, 1.8, 0xd8d2c0, 0, 0.85, 3));                        // 阶
    objs.push(box(3.4, 0.5, 3.4, 0xd8d2c0, -5.5, 0.85, 4));
    objs.push(box(3.4, 0.5, 3.4, 0xd8d2c0, 5.5, 0.85, 4));
    return { objects: objs, sky: 0xe6e2d4, fog: [0xe6e2d4, 45, 120], sun: 1.3, cam: [16, 10, 18], tgt: [0, 2, -2] };
  }
  function envOffice() {
    const objs = [];
    objs.push(box(20, 0.2, 16, 0xd2d4d6, 0, -0.1, 0));
    objs.push(box(20, 3, 0.3, 0xe6e6e4, 0, 1.5, -8));
    objs.push(box(0.3, 3, 16, 0xe6e6e4, -10, 1.5, 0));
    for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) {
      objs.push(box(2.4, 0.08, 1.2, 0xe9e7e0, i * 3.6, 0.76, j * 3.4));      // 办公桌
      objs.push(box(2.3, 0.62, 0.06, 0xe0ddd4, i * 3.6, 0.45, j * 3.4 - 0.5)); // 桌下挡板
      objs.push(box(0.5, 0.5, 0.5, 0xd8d5cc, i * 3.6, 1.05, j * 3.4));       // 显示器
      objs.push(box(0.45, 0.8, 0.45, 0xdedbd2, i * 3.6 + 1.0, 0.4, j * 3.4 + 0.6)); // 椅
    }
    objs.push(box(0.15, 2.4, 6, 0xdde8e4, -9.8, 1.2, -2));                   // 玻璃隔断
    return { objects: objs, sky: 0xe9ebec, fog: [0xe9ebec, 30, 75], sun: 1.1, cam: [11, 8.5, 11.5], tgt: [0, 1, -1] };
  }
  function envWild() {
    const objs = [];
    objs.push(ground(160, 0xc9cbb2));
    for (let i = 0; i < 14; i++) {
      const a = i * 1.7, r = 12 + (i % 5) * 4;
      objs.push(cyl(0.16, 0.26, 1.6, 0xb0ac96, Math.cos(a) * r, 0.8, Math.sin(a) * r, 7));
      const c = new THREE.Mesh(new THREE.SphereGeometry(1.15, 12, 8),
        new THREE.MeshStandardMaterial({ color: 0xc3c9a8, roughness: 0.95 }));
      c.position.set(Math.cos(a) * r, 2.2, Math.sin(a) * r); c.scale.y = 0.9;
      c.castShadow = true; objs.push(c);
    }
    for (let i = 0; i < 10; i++) {
      const a = i * 2.3 + 1, r = 8 + (i % 4) * 5;
      const rock = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 7),
        new THREE.MeshStandardMaterial({ color: 0xbab8a8, roughness: 0.96 }));
      rock.position.set(Math.cos(a) * r, 0.4, Math.sin(a) * r);
      rock.scale.set(1.2, 0.7, 1); rock.castShadow = true; objs.push(rock);
    }
    return { objects: objs, sky: 0xdde4e0, fog: [0xdde4e0, 50, 130], sun: 1.35, cam: [15, 9, 17], tgt: [0, 1, 0] };
  }
  function envStudio() {
    const objs = [];
    objs.push(ground(80, 0xe4e2dc));
    const cyc = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 9, 24, 1, true, -Math.PI / 2.2, Math.PI / 1.1),
      new THREE.MeshStandardMaterial({ color: 0xf0eee8, roughness: 0.98, side: THREE.BackSide }));
    cyc.position.y = 4.5; objs.push(cyc);
    objs.push(box(5, 0.3, 5, 0xd6d3ca, 0, 0.15, 0));                          // 中心台
    return { objects: objs, sky: 0xf2f0ea, fog: [0xf2f0ea, 35, 85], sun: 1.0, cam: [9, 6.5, 11], tgt: [0, 1.2, 0] };
  }

  window.WB_ENVIRONMENTS = [
    { id: 'room', name: '空房间', desc: '室内 · 三面墙', build: envRoom },
    { id: 'street', name: '街道', desc: '城市场景', build: envStreet },
    { id: 'temple', name: '神庙', desc: '宏大仪式感', build: envTemple },
    { id: 'office', name: '办公室', desc: '工位阵列', build: envOffice },
    { id: 'wild', name: '荒野', desc: '自然外景', build: envWild },
    { id: 'studio', name: '影棚', desc: '无缝白背景', build: envStudio }
  ];
})();
