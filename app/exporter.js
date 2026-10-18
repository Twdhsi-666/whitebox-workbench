// 一键出片。两种走法：
//  本地模式：页内确定性逐帧渲染 → 一帧一图 POST 给 server.mjs → 本机 ffmpeg 编码 MP4（顺带存每镜头首帧）
//  在线模式：没有本地服务，退化成 canvas 实时录制 webm（时长准、画质弱；能不能被即梦/豆包收我没验证）
import { RATIOS } from '../engine/camera.js';
import { timeline } from './state.js';

function outSize(aspectId, scale = 1) {
  const r = RATIOS.find(x => x.id === aspectId) || RATIOS[0];
  return { w: Math.round(r.w * scale), h: Math.round(r.h * scale), id: r.id };
}

function toBlob(canvas, type, q) {
  return new Promise(res => canvas.toBlob(b => res(b), type, q));
}
export async function renderVideo({ project, vp, mode, log, aspect }) {
  window.__cancelRender = false;
  const total = timeline(project).total;
  if (!total) throw new Error('镜头表是空的，先加机位');
  const fps = project.fps || 25;
  const size = outSize(aspect);
  if (mode === 'local') return renderLocal({ project, vp, log, total, fps, size });
  return renderWebm({ project, vp, log, total, fps, size });
}

async function renderLocal({ project, vp, log, total, fps, size }) {
  const frames = Math.max(1, Math.round(total * fps));
  const starts = [];
  let acc = 0;
  for (const r of timeline(project).rows) { starts.push(Math.round(acc * fps)); acc += r.dur; }
  const name = (project.name || 'coconut').replace(/[\\/:*?"<>|]/g, '_');

  const job = await (await fetch('/api/job/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, frames, fps, w: size.w, h: size.h, shotStarts: starts })
  })).json();
  if (!job.ok) throw new Error(job.error || '任务没建起来（本地服务是不是被别的窗口占了？）');
  log(`任务 ${job.job}　${frames} 帧 @ ${size.w}×${size.h}`);

  vp.stop();
  const t0 = performance.now();
  let bytes = 0;
  const sizes = [];
  try {
    for (let i = 0; i < frames; i++) {
      if (window.__cancelRender) throw new Error('你取消了');
      const dataURL = vp.captureFrame(i / fps, size.w, size.h, 0.92);
      const blob = await (await fetch(dataURL)).blob();
      bytes += blob.size;
      sizes.push(blob.size);
      if (i === 11) {
        const uniq = new Set(sizes.slice(0, 12)).size;
        if (uniq === 1) throw new Error(`前 12 帧字节数完全一样（${sizes[0]}B），八成是全黑帧，先别浪费 ffmpeg`);
      }
      await fetch(`/api/job/frame?job=${encodeURIComponent(job.job)}&i=${i}`, { method: 'POST', body: blob });
      if (i % 25 === 0 || i === frames - 1) {
        const el = (performance.now() - t0) / 1000;
        log(`第 ${i + 1}/${frames} 帧　${el.toFixed(1)}s（${(i / Math.max(0.1, el)).toFixed(1)} 帧/秒）`);
      }
    }
    log('交给 ffmpeg 编码…');
    const enc = await (await fetch('/api/job/encode', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ job: job.job })
    })).json();
    if (!enc.ok) throw new Error(enc.error || 'ffmpeg 失败');
    log(`完成：${enc.file}（${(bytes / 1048576).toFixed(1)}MB 帧数据）`);
    return { file: enc.file, note: enc.note, frames, mode: 'local' };
  } finally {
    vp.start();
  }
}

async function renderWebm({ vp, log, total, fps, size }) {
  if (!('MediaRecorder' in window)) throw new Error('这浏览器没有 MediaRecorder');
  const supported = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
  log('在线模式：实时录制 ' + supported);
  vp.stop();
  const canvas = vp.renderer.domElement;
  const stream = canvas.captureStream(fps);
  const rec = new MediaRecorder(stream, { mimeType: supported, videoBitsPerSecond: 8_000_000 });
  const parts = [];
  rec.ondataavailable = e => e.data.size && parts.push(e.data);
  const done = new Promise(res => rec.onstop = res);
  const total2 = Math.max(0.4, total);
  const startT = performance.now();
  rec.start(250);
  await new Promise(res => {
    const loop = () => {
      const t = (performance.now() - startT) / 1000;
      if (t >= total2 || window.__cancelRender) return res();
      vp.viewMode = 'cam';
      vp.applyTime(t);
      vp.t = t;
      vp.draw();
      requestAnimationFrame(loop);
    };
    loop();
  });
  rec.stop();
  await done;
  vp.start();
  const blob = new Blob(parts, { type: supported });
  const ext = supported.includes('mp4') ? 'mp4' : 'webm';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${(vp.project.name || 'coconut')}_白膜.${ext}`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
  return { file: a.download, note: `在线录了 ${(blob.size / 1048576).toFixed(1)}MB 的 .${ext}`, frames: 0, mode: 'online' };
}
