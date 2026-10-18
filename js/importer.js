/* ============================================================
 * 白膜工作台 · 导入器
 * 职责：读取 HTML 文件 → 校验规范 → 分级（Tier A 规范 / Tier B 旧文件）
 *       → 重写 three 依赖为本地镜像 → 注入桥接脚本 → 产出场景记录
 * ============================================================ */
import { WB_BRIDGES } from './adapter.js';

export const SPEC_VERSION = 'whitebox-html/1.0';

/* 标准接口清单（规范 §4） */
const APIS = ['__ready', '__seek', '__grab', '__size', '__glOk',
              '__play', '__pause', '__playing', '__duration', '__getTime'];

/* 本地 three 镜像的绝对地址（localhost / GitHub Pages 均可用） */
const LOCAL_THREE = new URL('assets/three.module.js', document.baseURI).href;

/* ------------------------------------------------------------ */
/* 清单校验                                                      */
/* ------------------------------------------------------------ */
function validateManifest(mf, fileName) {
  const errors = [], warnings = [];
  if (!mf || typeof mf !== 'object') {
    return { manifest: null, errors: ['缺少 #whitebox-manifest 元数据清单（旧文件走兼容层导入）'], warnings: [] };
  }
  if (mf.spec !== SPEC_VERSION) {
    warnings.push(`manifest.spec 应为 "${SPEC_VERSION}"，实际为 ${JSON.stringify(mf.spec)}（按旧文件处理）`);
  }
  const m = { spec: SPEC_VERSION, title: '', author: '无', duration: 15, location: null, shots: [], notes: '无' };

  if (typeof mf.title === 'string' && mf.title.trim()) m.title = mf.title.trim();
  else { m.title = fileName.replace(/\.html?$/i, ''); warnings.push('manifest.title 缺失，用文件名代替'); }

  if (typeof mf.author === 'string' && mf.author.trim()) m.author = mf.author.trim();

  if (typeof mf.duration === 'number' && isFinite(mf.duration) && mf.duration > 0) {
    m.duration = Math.round(mf.duration * 10) / 10;
  } else warnings.push('manifest.duration 缺失或非法，默认按 15s 处理');

  if (mf.location && typeof mf.location === 'object') {
    const lat = Number(mf.location.lat), lng = Number(mf.location.lng);
    if (isFinite(lat) && isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      m.location = {
        name: (typeof mf.location.name === 'string' && mf.location.name.trim()) ? mf.location.name.trim() : '无',
        lat, lng
      };
    } else if (mf.location.name) {
      m.location = { name: String(mf.location.name), lat: 0, lng: 0 };
      warnings.push('location 缺少合法经纬度，已按"未定位"排布');
    }
  }

  if (Array.isArray(mf.shots)) {
    for (const s of mf.shots) {
      const t = Number(s && s.t);
      if (isFinite(t) && t >= 0 && t <= m.duration && s && typeof s.label === 'string') {
        m.shots.push({ t: Math.round(t * 100) / 100, label: s.label.trim() || `${t}s` });
      }
    }
    m.shots.sort((a, b) => a.t - b.t);
    if (m.shots.length !== mf.shots.length) warnings.push(`${mf.shots.length - m.shots.length} 个 shots 字段非法已丢弃`);
  }
  if (typeof mf.notes === 'string' && mf.notes.trim()) m.notes = mf.notes.trim();
  return { manifest: m, errors, warnings };
}

/* ------------------------------------------------------------ */
/* three 依赖本地化                                              */
/* ------------------------------------------------------------ */
function rewriteThree(text) {
  let out = text, hadImportmap = /type\s*=\s*["']importmap["']/i.test(text);

  // 1) importmap 里的 three 指向 → 本地镜像
  out = out.replace(/<script([^>]*?)type\s*=\s*["']importmap["']([^>]*)>([\s\S]*?)<\/script>/gi,
    (whole, pre, post, json) => {
      try {
        const map = JSON.parse(json.trim());
        let changed = false;
        const imports = map.imports || {};
        for (const k of Object.keys(imports)) {
          if (k === 'three' || /three/i.test(String(imports[k]))) { imports[k] = LOCAL_THREE; changed = true; }
        }
        if (!changed) return whole;
        const next = JSON.stringify(map, null, 2);
        return whole.replace(json, next);
      } catch (e) { return whole; }
    });

  // 2) 直接写 CDN 地址的 import → 本地镜像
  out = out.replace(/(["'])(https?:\/\/[^"']*three[^"']*)\1/g, (m, q) => q + LOCAL_THREE + q);

  // 3) 裸导入 'three' 但没有 importmap → 补一个
  if (!hadImportmap && /from\s*['"]three['"]/.test(out)) {
    const inject = `<script type="importmap">\n{"imports":{"three":"${LOCAL_THREE}"}}\n</script>\n`;
    out = out.replace(/(<script[^>]*type\s*=\s*["']module["'][^>]*>)/i, inject + '$1');
    if (!out.includes('type="importmap"') && !out.includes("type='importmap'")) {
      out = inject + out;
    }
  }
  return out;
}

/* 远程依赖巡检（three 之外的外链） */
function scanRemoteDeps(text) {
  const urls = new Set();
  const re = /(?:src|href|from)\s*=\s*["'](https?:\/\/[^"']+)["']|from\s*["'](https?:\/\/[^"']+)["']/gi;
  let m;
  while ((m = re.exec(text))) {
    const u = m[1] || m[2];
    if (u && !/three/i.test(u)) urls.add(u);
  }
  return [...urls];
}

/* ------------------------------------------------------------ */
/* 桥接注入                                                      */
/* ------------------------------------------------------------ */
function injectBridge(text, bridgeSrc) {
  const tag = `<script>\n${bridgeSrc}\n</script>\n`;
  if (/<head[^>]*>/i.test(text)) return text.replace(/<head[^>]*>/i, (m) => m + '\n' + tag);
  if (/<html[^>]*>/i.test(text)) return text.replace(/<html[^>]*>/i, (m) => m + '\n' + tag);
  return tag + text;
}

/* ------------------------------------------------------------ */
/* 主入口：处理单个文件                                          */
/* ------------------------------------------------------------ */
export async function importSceneFile(file) {
  const errors = [], warnings = [];
  const base = {
    id: 'sc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
    originalName: file.name,
    importedAt: new Date().toISOString(),
    sizeBytes: file.size,
  };

  if (!/\.html?$/i.test(file.name)) {
    return { ok: false, record: null, errors: [`不是 HTML 文件（${file.name}）`], warnings };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { ok: false, record: null, errors: [`文件超过 5MB（${(file.size / 1048576).toFixed(1)}MB），拒绝导入`], warnings };
  }

  let text;
  try { text = await file.text(); }
  catch (e) { return { ok: false, record: null, errors: [`读取失败：${e.message}`], warnings }; }

  /* 1. 解析 manifest */
  let mf = null;
  try {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const el = doc.querySelector('script#whitebox-manifest') ||
               [...doc.querySelectorAll('script[type="application/json"]')].find(s => /whitebox-html/.test(s.textContent || ''));
    if (el) { try { mf = JSON.parse(el.textContent); } catch (e) { errors.push(`manifest JSON 解析失败：${e.message}`); } }
  } catch (e) { errors.push(`HTML 解析失败：${e.message}`); }

  const v = validateManifest(mf, file.name);
  errors.push(...v.errors);
  warnings.push(...v.warnings);

  /* 2. 接口扫描 */
  const missing = APIS.filter(a => !new RegExp(`window\\.${a}\\s*=`).test(text));

  /* 3. 分级 */
  const tier = (mf && missing.length === 0) ? 'A' : 'B';
  if (tier === 'B' && missing.length) {
    warnings.push(`缺少 ${missing.length}/10 个标准接口（${missing.join(' ')}），以兼容层导入`);
  }

  /* 4. 依赖本地化 + 桥接注入 */
  let adapted = rewriteThree(text);
  adapted = injectBridge(adapted, tier === 'A' ? WB_BRIDGES.spec : WB_BRIDGES.legacy);

  const remote = scanRemoteDeps(text);
  if (remote.length) warnings.push(`检测到 three 之外的远程依赖（${remote.length} 个），离线环境可能加载失败`);

  const manifest = v.manifest || {
    spec: SPEC_VERSION, title: file.name.replace(/\.html?$/i, ''), author: '无（旧文件）',
    duration: null, location: null, shots: [], notes: '由兼容层自动导入'
  };

  return {
    ok: true,
    record: { ...base, tier, manifest, html: adapted, missing },
    errors, warnings
  };
}

/* ------------------------------------------------------------ */
/* 项目 JSON 导入                                                */
/* ------------------------------------------------------------ */
export function importProjectJSON(json) {
  const errors = [], warnings = [], records = [];
  if (!json || json.app !== 'whitebox-workbench' || !Array.isArray(json.scenes)) {
    return { ok: false, records: [], errors: ['不是有效的白膜工作台项目文件'] };
  }
  for (const s of json.scenes) {
    if (s && s.type === 'native' && s.data && typeof s.data === 'object') {
      records.push({
        id: 'sc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
        type: 'native',
        title: s.title || '未命名场景',
        data: s.data,
        thumb: s.thumb || null,
        createdAt: s.createdAt || Date.now(),
      });
      continue;
    }
    if (!s || typeof s.html !== 'string' || !s.manifest || typeof s.manifest !== 'object') {
      errors.push(`跳过一条无效场景记录（${s && s.manifest ? s.manifest.title : '未知'}）`);
      continue;
    }
    if (!/__WB_BRIDGE__/.test(s.html)) {
      s.html = injectBridge(s.html, s.tier === 'A' ? WB_BRIDGES.spec : WB_BRIDGES.legacy);
    }
    records.push({
      id: 'sc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      originalName: s.originalName || (s.manifest.title + '.html'),
      importedAt: new Date().toISOString(),
      sizeBytes: s.html.length,
      tier: s.tier === 'A' ? 'A' : 'B',
      manifest: s.manifest,
      html: s.html,
      thumb: s.thumb || null,
    });
  }
  return { ok: records.length > 0, records, errors, warnings };
}
