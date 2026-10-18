// 用 GitHub Git Data API 推送（本机 git 走 443 经常连不通，api.github.com 稳定）。
// 跑法：node tools/push.mjs <分支名> [--parent=<sha>] [--msg=提交信息]
//   不带 --parent = 孤儿提交（新分支，不动别人的历史）
//   带 --parent   = 接在指定提交之后（快进，不覆盖）
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = 'Twdhsi-666/whitebox-workbench';
const argv = process.argv.slice(2);
const BRANCH = argv[0];
if (!BRANCH || BRANCH.startsWith('--')) { console.log('用法: node tools/push.mjs <分支名> [--parent=sha] [--msg=...]'); process.exit(2); }
const arg = (k, d) => { const a = argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=').slice(1).join('=') : d; };
const MSG = arg('msg', `椰子工作台：白膜预演引擎 + 运镜台 + 逐帧出片`);
const PARENT = arg('parent', '');

const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
if (!token) { console.log('拿不到 gh token'); process.exit(1); }

const api = (method, p, body) => {
  const args = ['api', method === 'GET' ? `-X` : `-X`, method, `repos/${REPO}/${p}`, '-H', 'Accept: application/vnd.github+json'];
  if (body) args.push('--input', '-');
  const input = body ? JSON.stringify(body) : '';
  const out = execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  return out.trim() ? JSON.parse(out) : {};
};

// git ls-files 默认会把中文路径转义成 "docs\345\206\263..." 导致读不到文件，-z 用 NUL 分隔原样输出
const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
console.log(`本地 ${files.length} 个文件待上传`);

const entries = [];
for (const f of files) {
  const buf = fs.readFileSync(path.join(ROOT, f));
  const blob = api('POST', 'git/blobs', { content: buf.toString('base64'), encoding: 'base64' });
  entries.push({ path: f, mode: '100644', type: 'blob', sha: blob.sha });
  process.stdout.write(`  blob ${f} (${buf.length}B)\n`);
}

const parents = [];
if (PARENT) parents.push(PARENT);
else {
  // 分支已存在就自动接在它后面（否则每次都是孤儿提交，第二次推会 not a fast forward）
  try {
    const cur = api('GET', `git/ref/heads/${BRANCH}`);
    if (cur && cur.object) { parents.push(cur.object.sha); console.log(`接在现有 ${BRANCH} → ${cur.object.sha.slice(0, 7)} 之后`); }
  } catch (e) { console.log(`新建分支 ${BRANCH}`); }
}
const tree = api('POST', 'git/trees', { tree: entries });
// 不显式传 author/committer 时，GitHub 拿账号主邮箱兜底 → 会把私人邮箱烤进公开提交记录
const IDENT = { name: 'Twdhsi-666', email: '340561342+Twdhsi-666@users.noreply.github.com' };
const commit = api('POST', 'git/commits', { message: MSG + `\n\n推送方式：Git Data API（本机 git 到 github:443 不稳）`, tree: tree.sha, parents, author: IDENT, committer: IDENT });
try {
  const ref = api('POST', 'git/refs', { ref: `refs/heads/${BRANCH}`, sha: commit.sha });
  console.log(`分支已建 ${ref.ref} → ${commit.sha.slice(0, 7)}`);
} catch (e) {
  console.log('分支已存在，改为快进更新');
  const ref = api('PATCH', `git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false });
  console.log(`已更新 → ${ref.object.sha.slice(0, 7)}`);
}
console.log(`https://github.com/${REPO}/tree/${BRANCH}`);
