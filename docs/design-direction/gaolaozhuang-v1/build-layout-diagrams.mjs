// 只生成 #28 的设计标注图；不提供正式导航、碰撞或服务端逻辑。
import { readFile, writeFile } from 'node:fs/promises';
const data = JSON.parse(await readFile(new URL('spatial-layout.json', import.meta.url), 'utf8'));
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const points = list => list.map(pair => pair.join(',')).join(' ');
const fill = { walkable: '#e3f0d5', safe_room: '#fff0a4', private_room: '#eee3f1', conditional: '#ffe0ad' };
for (const scene of data.scenes) {
  const items = [];
  items.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1600" height="1810" viewBox="0 0 1600 1810" role="img" aria-labelledby="title desc">
  <title id="title">${esc(scene.label)}空间标注图</title><desc id="desc">1600乘1000逻辑地图的设计输入；绿色可走、赭红障碍、黄色自由出口安置区、紫色内室。不是已验证导航。</desc>
  <defs><pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M100 0H0V100" fill="none" stroke="#465c5640" stroke-width="1"/></pattern><pattern id="blocked" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M-3 3L3-3M0 12L12 0M9 15L15 9" stroke="#97543f66" stroke-width="2"/></pattern><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#276b63"/></marker><marker id="free-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#9c642b"/></marker></defs>
  <style>text{font-family:'Noto Sans CJK SC',sans-serif;fill:#332c23}.heading{font-size:32px;font-weight:600}.sub{font-size:18px}.small{font-size:16px}.anchor{font-size:13px;font-weight:700;text-anchor:middle;dominant-baseline:central}.code{font-size:17px;font-weight:600}.label{font-size:17px}.area-label{font-size:18px;font-weight:600;paint-order:stroke;stroke:#fff9eb;stroke-width:5px;stroke-linejoin:round}</style>
  <rect width="1600" height="1810" fill="#f8f2e5"/>
  <text x="30" y="50" class="heading">${esc(scene.label)} · 空间输入 v1.1</text>
  <text x="30" y="84" class="sub">地图 1600 × 1000；原点左上。圆点＝可接近/站立脚底点；◇＝对象图上位置，不作导航终点。</text>
  <text x="30" y="116" class="small">青绿：可走范围　赭红斜线：主要障碍　淡黄：安置内室　淡紫：后宅内室　橙色：有条件通道</text>
  <text x="30" y="143" class="small">实线：当前样例下一段　虚线：完整设计路线　点线：自由退出；所有路线仍须正式碰撞与导航验证。</text>
  <g transform="translate(0 160)"><rect width="1600" height="1000" fill="#dcd6c8"/><image href="${esc(scene.background)}" width="1600" height="1000" preserveAspectRatio="none" opacity=".6"/>`);
  for (const obstacle of scene.obstacles) {
    items.push(`<polygon points="${points(obstacle.polygon)}" fill="#b97c6150" stroke="#97543f" stroke-width="2"/><polygon points="${points(obstacle.polygon)}" fill="url(#blocked)"/>`);
  }
  for (const area of scene.walkable_areas) {
    items.push(`<polygon points="${points(area.polygon)}" fill="${fill[area.kind] || fill.walkable}" fill-opacity="${area.kind.includes('room') ? '.95' : '.55'}" stroke="${area.kind === 'conditional' ? '#a46b2f' : '#4f7560'}" stroke-width="2"/>`);
  }
  // 桌凳、花圃等仍覆盖通行区；屋体的明确内室/门道是剖面开口。
  for (const obstacle of scene.obstacles.filter(item => !item.except_areas)) {
    items.push(`<polygon points="${points(obstacle.polygon)}" fill="url(#blocked)" stroke="#97543f" stroke-width="2"/>`);
  }
  items.push('<rect width="1600" height="1000" fill="url(#grid)"/>');
  for (let x = 0; x <= 1500; x += 200) items.push(`<text x="${x + 6}" y="20" class="small">${x}</text>`);
  for (let y = 200; y <= 800; y += 200) items.push(`<text x="6" y="${y - 5}" class="small">${y}</text>`);
  for (const route of [...scene.routes].sort((a, b) => Number(a.kind === 'sample_route') - Number(b.kind === 'sample_route'))) {
    const style = route.kind === 'sample_route' ? 'stroke-width="5"' : route.kind === 'free_exit' ? 'stroke-width="5" stroke-dasharray="2 10" opacity=".8"' : 'stroke-width="3" stroke-dasharray="10 7" opacity=".65"';
    items.push(`<polyline points="${points(route.points)}" fill="none" stroke="${route.kind === 'free_exit' ? '#9c642b' : '#276b63'}" ${style} stroke-linecap="round" stroke-linejoin="round" marker-end="url(#${route.kind === 'free_exit' ? 'free-arrow' : 'arrow'})"/>`);
  }
  if (scene.id === 'gaolao-courtyard') {
    items.push('<text x="530" y="260" class="area-label">前院客房 · 剖面</text><text x="1172" y="243" class="area-label">后宅内室 · 剖面</text><path d="M1080 415L1125 315" stroke="#756086" stroke-width="3" stroke-dasharray="3 7"/><text x="940" y="306" class="area-label">侧窗只联络</text>');
  } else {
    items.push('<text x="500" y="202" class="area-label">茶棚后间 · 剖面</text><text x="1270" y="205" class="area-label">洞外；不扩展洞内</text>');
  }
  for (const old of scene.historical_points) {
    const [x, y] = old.position;
    items.push(`<path d="M${x - 8} ${y - 8}L${x + 8} ${y + 8}M${x - 8} ${y + 8}L${x + 8} ${y - 8}" stroke="#665c4b" stroke-width="3"/><text x="${x + 16}" y="${y + 5}" class="area-label">旧点停用</text>`);
  }
  for (const a of scene.anchors) {
    const [px, py] = a.position;
    if (a.visual_object) {
      const [ox, oy] = a.visual_object;
      items.push(`<path d="M${px} ${py}L${ox} ${oy}" stroke="#76572e" stroke-width="1.5" stroke-dasharray="3 4"/><path d="M${ox} ${oy - 6}L${ox + 6} ${oy}L${ox} ${oy + 6}L${ox - 6} ${oy}Z" fill="#fff8e9" stroke="#76572e" stroke-width="2"/>`);
    }
    const [dx, dy] = a.diagram_label_offset || [0, 0];
    const x = px + dx, y = py + dy;
    if (dx || dy) items.push(`<path d="M${px} ${py}L${x} ${y}" stroke="#365e52" stroke-width="1.5"/><circle cx="${px}" cy="${py}" r="4" fill="#365e52"/>`);
    items.push(`<g><circle cx="${x}" cy="${y}" r="17" fill="#fff9eb" stroke="#365e52" stroke-width="2"/><text x="${x}" y="${y}" class="anchor">${esc(a.id)}</text></g>`);
  }
  items.push('<rect width="1600" height="1000" fill="none" stroke="#88785b" stroke-width="2"/></g>');
  items.push('<text x="30" y="1202" class="heading">锚点索引</text>');
  const rows = Math.ceil(scene.anchors.length / 3);
  scene.anchors.forEach((a, index) => {
    const column = Math.floor(index / rows), row = index % rows;
    const x = 30 + column * 526, y = 1240 + row * 34;
    items.push(`<text x="${x}" y="${y}" class="code">${esc(a.id)}</text><text x="${x + 48}" y="${y}" class="label">${esc(a.label)} (${a.position.join(', ')})</text>`);
  });
  items.push('<path d="M30 1550H1570" stroke="#ac9873"/>');
  scene.diagram_notes.forEach((note, i) => items.push(`<text x="30" y="${1587 + i * 34}" class="small">${esc(note)}</text>`));
  items.push('<text x="30" y="1755" class="small">精确多边形、障碍尺度、条件和引用以 spatial-layout.json 为准；本图不授予玩家全知视野。</text><text x="30" y="1785" class="small">设计自查与正式运行分开；图像缺失时，原生标注仍可审阅，不能声称原背景已恢复。</text></svg>');
  const name = scene.id === 'gaolao-courtyard' ? 'layout-courtyard.svg' : 'layout-road.svg';
  await writeFile(new URL(name, import.meta.url), items.join('\n'));
  console.log(`已生成 ${name}`);
}
