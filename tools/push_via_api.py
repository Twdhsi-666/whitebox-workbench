# -*- coding: utf-8 -*-
"""通过 GitHub Git Data API 推送本地仓库（绕过被封锁的 git 协议通道）。"""
import subprocess, json, base64, os, sys, urllib.request, urllib.error, time

REPO = "Twdhsi-666/whitebox-workbench"
BRANCH = "main"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# GitHub 账号主邮箱会被 Git Data API 拿去当提交作者兜底，必须显式写死 noreply
PUB_EMAIL = "340561342+Twdhsi-666@users.noreply.github.com"
IDENT = {"name": "Twdhsi-666", "email": PUB_EMAIL}
MSG = subprocess.run(["git", "log", "-1", "--pretty=%B"],
                     capture_output=True, text=True).stdout.strip() or "update"

os.chdir(ROOT)

token = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True).stdout.strip()
if not token:
    sys.exit("no gh token")

def api(method, path, body=None, retry=3):
    url = "https://api.github.com/repos/%s/%s" % (REPO, path)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    last = None
    for i in range(retry):
        try:
            req = urllib.request.Request(url, data=data, method=method)
            req.add_header("Authorization", "token " + token)
            req.add_header("Accept", "application/vnd.github+json")
            req.add_header("X-GitHub-Api-Version", "2022-11-28")
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body_txt = e.read().decode("utf-8", "replace")
            if e.code in (403, 422, 409) and "retry" not in body_txt.lower():
                # 403 可能是限流，等待后重试；其余直接抛
                if e.code == 403 and "rate limit" in body_txt.lower():
                    last = e
                    time.sleep(10 * (i + 1))
                    continue
                raise RuntimeError("HTTP %s %s: %s" % (e.code, path, body_txt[:500]))
            last = e
            time.sleep(3 * (i + 1))
        except Exception as e:
            last = e
            time.sleep(3 * (i + 1))
    raise RuntimeError("failed after retries: %s" % last)

# 0. 空仓库引导：Git Data API 拒绝在无 ref 的仓库上建 blob，
#    先用 Contents API 落一个初始提交激活仓库
head_sha = None
try:
    head_sha = api("GET", "git/refs/heads/" + BRANCH)["object"]["sha"]
    print("repo already has " + BRANCH)
except RuntimeError:
    with open("README.md", "rb") as fh:
        rd = base64.b64encode(fh.read()).decode("ascii")
    api("PUT", "contents/README.md",
        {"message": "init", "content": rd, "branch": "main"})
    print("repo bootstrapped via contents api")

# 1. 文件清单（UTF-8 原始字节路径，含中文）
raw = subprocess.run(["git", "ls-files", "-z"], capture_output=True).stdout
paths = [p.decode("utf-8") for p in raw.split(b"\0") if p]
print("files:", len(paths))

# 2. 逐个创建 blob
tree = []
for p in paths:
    with open(p, "rb") as fh:
        content = base64.b64encode(fh.read()).decode("ascii")
    blob = api("POST", "git/blobs", {"encoding": "base64", "content": content})
    tree.append({"path": p, "mode": "100644", "type": "blob", "sha": blob["sha"]})
    print("  blob %-40s %s" % (p, blob["sha"][:10]))

# 3. tree
t = api("POST", "git/trees", {"tree": tree})
print("tree:", t["sha"][:10])

# 4. commit
body = {"message": MSG, "tree": t["sha"], "author": IDENT, "committer": IDENT}
if head_sha:
    body["parents"] = [head_sha]
c = api("POST", "git/commits", body)
print("commit:", c["sha"][:10])

# 5. 创建或更新 main 引用
try:
    api("PATCH", "git/refs/heads/" + BRANCH, {"sha": c["sha"], "force": False})
    print("ref: updated (fast-forward)")
except RuntimeError as e:
    if "404" in str(e):
        api("POST", "git/refs", {"ref": "refs/heads/" + BRANCH, "sha": c["sha"]})
        print("ref: created")
    else:
        raise

print("DONE https://github.com/%s" % REPO)
