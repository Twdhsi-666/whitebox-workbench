// 预设清单。新增预设：在 presets/ 放一个符合 Schema 的 js 文件，然后在这里登记一行。
export const PRESETS = [
  { id: 'city_street', label: '城市街道', group: '室外' },
  { id: 'dusk_city_rooftop', label: '黄昏天台', group: '室外' },
  { id: 'classroom', label: '教室', group: '室内' },
  { id: 'restaurant', label: '中餐馆', group: '室内' },
  { id: 'bedroom', label: '卧室', group: '室内' },
  { id: 'example_living_room', label: '客厅（范本）', group: '室内' },
  { id: 'office', label: '开放办公室', group: '室内' }
];

export async function loadPreset(id) {
  const mod = await import(`./${id}.js`);
  return mod.default;
}
