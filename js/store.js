/* ============================================================
 * 白膜工作台 · 本地存储（localStorage）
 * ============================================================ */

const KEY = 'whitebox.workbench.v1';

export const store = {
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data.scenes) ? data.scenes : [];
    } catch (e) { return []; }
  },

  save(scenes) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ app: 'whitebox-workbench', version: 1, scenes }));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  },

  exportProject(scenes) {
    return JSON.stringify({
      app: 'whitebox-workbench', version: 1, exportedAt: new Date().toISOString(),
      scenes: scenes.map(s => s.type === 'native'
        ? { type: 'native', title: s.title, data: s.data, thumb: s.thumb || null, createdAt: s.createdAt }
        : {
            tier: s.tier, originalName: s.originalName, manifest: s.manifest,
            html: s.html, thumb: s.thumb || null,
          }),
    }, null, 2);
  },
};
