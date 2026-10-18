// 零依赖本地服务：静态喂页面 + 收帧 + 调 ffmpeg 编码。只绑 127.0.0.1，不对外。
// 跑法：node server.mjs [--port=8951] [--no-open]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const PORT = Number(arg('port', 8951));
const NO_OPEN = argv.includes('--no-open');
const FFMPEG = 'A:/xc/EEE/FlyingMouse Format/resources/ffmpeg/ffmpeg.exe';
const OUT_ROOT = path.join(ROOT, '输出');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.md': 'text/markdown; charset=utf-8', '.map': 'application/json'
};

fs.mkdirSync(OUT_ROOT, { recursive: true });
const jobs = new Map();

const safeStatic = rel => {
  const p = path.normalize(path.join(ROOT, rel));
  return p.startsWith(ROOT) ? p : null;
};

const readBody = req => new Promise((res, rej) => {
  const chunks = [];
  req.on('data', c => { chunks.push(c); if (Buffer.concat(chunks).length > 40_000_000) { rej(new Error('body 太大')); req.destroy(); } });
  req.on('end', () => res(Buffer.concat(chunks)));
  req.on('error', rej);
});

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

const run = (cmd, args, cwd) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { cwd, windowsHide: true });
  let err = '';
  p.stderr.on('data', d => { err += d.toString(); });
  p.on('error', rej);
  p.on('close', code => code === 0 ? res(err) : rej(new Error(`${cmd} 退出码 ${code}：` + err.slice(-400))));
});

async function encode(job) {
  const out = path.join(job.dir, job.name + '.mp4');
  await run(FFMPEG, [
    '-y', '-framerate', String(job.fps), '-start_number', '0',
    '-i', path.join(job.dir, 'frames', 'f%04d.jpg'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', out
  ], job.dir);
  // 顺手把每个镜头的第一帧存成图，喂生成模型时当分镜参考图
  const firsts = path.join(job.dir, '首帧');
  fs.mkdirSync(firsts, { recursive: true });
  job.shotStarts.forEach((fi, i) => {
    const src = path.join(job.dir, 'frames', `f${String(fi).padStart(4, '0')}.jpg`);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(firsts, `镜头${i + 1}.jpg`));
  });
  const size = fs.statSync(out).size;
  return { out, size };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  try {
    if (p === '/api/ping') return json(res, 200, { ok: true, root: ROOT, ffmpeg: fs.existsSync(FFMPEG), jobs: jobs.size });

    if (p === '/api/job/start' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      if (!b.frames || !b.w || !b.h) return json(res, 400, { ok: false, error: '缺 frames/w/h' });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
      const id = stamp + '-' + Math.random().toString(36).slice(2, 7);
      const dir = path.join(OUT_ROOT, (String(b.name || 'clip').replace(/[^\w一-龥-]/g, '_')) + '_' + id);
      fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
      jobs.set(id, { id, dir, name: String(b.name || 'clip').replace(/[^\w一-龥-]/g, '_'), frames: Number(b.frames), fps: Number(b.fps) || 25, shotStarts: Array.isArray(b.shotStarts) ? b.shotStarts : [], got: 0 });
      return json(res, 200, { ok: true, job: id, dir });
    }

    if (p === '/api/job/frame' && req.method === 'POST') {
      const id = url.searchParams.get('job');
      const i = Number(url.searchParams.get('i'));
      const job = jobs.get(id);
      if (!job) return json(res, 404, { ok: false, error: '没有这个任务' });
      if (!Number.isInteger(i) || i < 0 || i >= job.frames) return json(res, 400, { ok: false, error: '帧号不对' });
      const buf = await readBody(req);
      if (buf.length < 500) return json(res, 400, { ok: false, error: `第 ${i} 帧太小（${buf.length}B），多半是黑屏` });
      fs.writeFileSync(path.join(job.dir, 'frames', `f${String(i).padStart(4, '0')}.jpg`), buf);
      job.got++;
      return json(res, 200, { ok: true, got: job.got });
    }

    if (p === '/api/job/encode' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const job = jobs.get(b.job);
      if (!job) return json(res, 404, { ok: false, error: '没有这个任务' });
      if (!fs.existsSync(FFMPEG)) return json(res, 500, { ok: false, error: '找不到 ffmpeg：' + FFMPEG });
      const r = await encode(job);
      return json(res, 200, { ok: true, file: r.out, note: `${job.got} 帧 → ${(r.size / 1048576).toFixed(2)}MB MP4`, firsts: path.join(job.dir, '首帧') });
    }

    if (p === '/api/models') {
      const dir = path.join(ROOT, 'models');
      fs.mkdirSync(dir, { recursive: true });
      const files = fs.readdirSync(dir).filter(f => /\.html?$/i.test(f)).map(f => {
        const st = fs.statSync(path.join(dir, f));
        return { name: f, bytes: st.size, mtime: st.mtime.toISOString().slice(0, 16).replace('T', ' ') };
      });
      return json(res, 200, { ok: true, files });
    }

    if (p === '/api/model/save' && req.method === 'POST') {
      const raw = String(url.searchParams.get('name') || 'scene.html');
      const name = (raw.replace(/[^\w.\-一-龥]/g, '_').slice(0, 70) || 'scene') .replace(/\.?html?$/i, '') + '.html';
      const buf = await readBody(req);
      if (buf.length < 40) return json(res, 400, { ok: false, error: '内容太小' });
      if (buf.length > 20_000_000) return json(res, 400, { ok: false, error: '超过 20MB，不像一个白膜页面' });
      const dir = path.join(ROOT, 'models');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), buf);
      return json(res, 200, { ok: true, name, url: '/models/' + encodeURIComponent(name), bytes: buf.length });
    }

    if (p === '/api/jobs') return json(res, 200, { ok: true, jobs: [...jobs.values()].map(j => ({ id: j.id, dir: j.dir, got: j.got, frames: j.frames })) });

    // 静态
    let rel = decodeURIComponent(p === '/' ? '/index.html' : p);
    const file = safeStatic(rel);
    if (!file) { res.writeHead(403); return res.end('no'); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('404 ' + rel); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    json(res, 500, { ok: false, error: String(e && e.message || e).slice(0, 300) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`椰子工作台 http://127.0.0.1:${PORT}/  根目录 ${ROOT}`);
  console.log(`ffmpeg ${fs.existsSync(FFMPEG) ? '在' : '不在'}：${FFMPEG}`);
  if (!NO_OPEN) {
    const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    if (fs.existsSync(edge)) spawn(edge, ['--new-window', url], { detached: true, stdio: 'ignore' }).unref();
  }
});
