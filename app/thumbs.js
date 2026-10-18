// 道具缩略图：另开一个很小的离屏渲染器，把资产摆正、打一盏光、渲成方图。
// 不这么做的话道具库就是一堆中文按钮，谁也认不出哪个是沙发哪个是床。
import * as THREE from '../vendor/three.module.js';
import { makeMaterials } from '../engine/builder.js';
import { instantiate, ASSETS } from '../engine/assets.js';
import { makeFigure } from '../engine/figure.js';

const SIZE = 128;
let r, scene, cam, mats, holder;

function ensure() {
  if (r) return;
  holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden';
  document.body.appendChild(holder);
  r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(SIZE, SIZE, false);
  r.setClearColor(0x000000, 0);
  holder.appendChild(r.domElement);
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(30, 1, 0.01, 500);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 5, 4);
  const rim = new THREE.DirectionalLight(0xffffff, 0.7);
  rim.position.set(-4, 2, -3);
  scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.75));
  mats = makeMaterials('dark');
}

export function thumbOf(asset) {
  ensure();
  const def = instantiate(asset, [0, 0], { seq: 0, name: asset.label + '_缩略' });
  const root = new THREE.Group();
  walk(def, root);
  scene.add(root);

  const box = new THREE.Box3().setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  const rad = box.getSize(new THREE.Vector3()).length() * 0.5 || 1;
  cam.position.set(c.x + rad * 1.5, c.y + rad * 0.85, c.z + rad * 1.75);
  cam.lookAt(c);
  cam.near = Math.max(0.01, rad / 50);
  cam.far = rad * 40;
  cam.updateProjectionMatrix();
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  scene.remove(root);
  root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  return url;

  function walk(d, parent) {
    if (d.t === 'group') {
      const g = new THREE.Group();
      g.position.set(...d.p);
      if (d.rot) g.rotation.set(...d.rot);
      parent.add(g);
      (d.children || []).forEach(c => walk(c, g));
      return;
    }
    if (d.t === 'figure') {
      const parts = makeFigure({ height: d.height || 1.75, material: mats.accent });
      parts.root.position.set(...d.p);
      parts.root.rotation.y = d.facing || 0;
      parent.add(parts.root);
      return;
    }
    const s = d.s || [0.5, 0.5, 0.5];
    const geo = d.t === 'sphere' ? new THREE.SphereGeometry(s[0], 18, 12)
      : d.t === 'cyl' ? new THREE.CylinderGeometry(s[0], s[1] == null ? s[0] : s[1], s[2], s[3] || 14)
      : new THREE.BoxGeometry(s[0], s[1], s[2]);
    const m = new THREE.Mesh(geo, mats[d.m] || mats.prop);
    m.position.set(...d.p);
    if (d.rot) m.rotation.set(...d.rot);
    parent.add(m);
  }
}

export function allThumbs() {
  const map = {};
  for (const a of ASSETS) { try { map[a.id] = thumbOf(a); } catch (e) { map[a.id] = ''; } }
  return map;
}
