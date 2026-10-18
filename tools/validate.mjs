// 预设体检：node tools/validate.mjs presets/foo.js [presets/bar.js ...] [--json=报告.json]
// 中文走文件，别指望 Windows 控制台不吞字（见决策记录）。
import fs from 'node:fs';
import path from 'node:path';
import { buildPreset } from '../engine/builder.js';
import { runAll } from '../engine/checks.js';

const argv = process.argv.slice(2);
const jsonOut = (argv.find(a => a.startsWith('--json=')) || '').split('=')[1];
const files = argv.filter(a => !a.startsWith('--')).filter(f => !/(^|\/)index\.js$/.test(f));
if (!files.length) { console.log('usage: node tools/validate.mjs presets/x.js [--json=report.json]'); process.exit(2); }

const report = [];
let anyErr = false;

for (const f of files) {
  const abs = path.resolve(f);
  const entry = { file: f, id: null, name: null, counts: {}, findings: [] };
  try {
    const mod = await import('file:///' + abs.replace(/\\/g, '/'));
    const preset = mod.default;
    entry.id = preset.id; entry.name = preset.name;
    if (!preset.id) entry.findings.push({ lvl: 'err', msg: '缺 id' });
    if (!preset.name) entry.findings.push({ lvl: 'err', msg: '缺 name' });
    if (preset.id && path.basename(abs, '.js') !== preset.id)
      entry.findings.push({ lvl: 'warn', msg: `id "${preset.id}" 和文件名 "${path.basename(abs)}" 不一致` });
    const built = buildPreset(preset, { shadows: false });
    entry.counts = {
      objects: built.items.length,
      figures: built.figures.length,
      cameras: (preset.cameras || []).length,
      byKind: built.items.reduce((a, i) => (a[i.kind] = (a[i.kind] || 0) + 1, a), {})
    };
    entry.findings = runAll(preset, built.items, built.root, preset.shots || null);
  } catch (e) {
    entry.findings = [{ lvl: 'err', msg: '加载失败：' + (e && e.message ? e.message : String(e)).slice(0, 300) }];
  }
  entry.err = entry.findings.filter(x => x.lvl === 'err').length;
  entry.warn = entry.findings.filter(x => x.lvl === 'warn').length;
  if (entry.err) anyErr = true;
  report.push(entry);
}

for (const e of report) {
  console.log(`${e.err ? 'FAIL' : 'pass'}  ${e.file}  objects=${e.counts.objects ?? '-'} cams=${e.counts.cameras ?? '-'} err=${e.err} warn=${e.warn}`);
  for (const f of e.findings) if (f.lvl === 'err') console.log(`   ERR  [${f.code}] ${f.msg}`);
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2), 'utf8');
process.exit(anyErr ? 1 : 0);
