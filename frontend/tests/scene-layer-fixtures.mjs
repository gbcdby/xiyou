import { createHash } from 'node:crypto';
const sha256 = value => createHash('sha256').update(value).digest('hex');
/** 仅为加载/映射检查生成的技术SVG，绝不是水墨素材或发布目录。 */
export function sceneLayerFixtures() {
  const files = {
    '/tests/layer-base.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="1586" height="992"><rect width="1586" height="992" fill="#e7e2d2"/><rect x="1150" y="248" width="198" height="84" fill="#e3e8de"/></svg>',
    '/tests/layer-floor.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="1586" height="992"><path d="M1085 288H1150V332H1085Z" fill="#deded0"/></svg>',
    '/tests/layer-front.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="1586" height="992"><rect x="1278.7" y="277.76" width="69.3875" height="54.56" fill="#50645c"/></svg>',
    '/tests/layer-mask.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="1586" height="992"><rect x="1060" y="148" width="348" height="278" fill="white"/></svg>',
    '/tests/layer-door-closed.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="95"><rect x="5" y="5" width="70" height="85" fill="#9b7264"/></svg>',
    '/tests/layer-door-open.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="95"><path d="M5 5H20V90H5ZM60 5H75V90H60Z" fill="#75899a"/></svg>',
  };
  const asset = file => ({ file, pixelSize: { width: 1586, height: 992 }, sourceCrop: { x: 0, y: 0, width: 1586, height: 992 }, worldRect: { x: 0, y: 0, width: 1600, height: 1000 }, sha256: sha256(files[file]) });
  const scope = { contentVersion: 'gaolaozhuang-scene-v2', mapVersion: 'gaolao-layout-v1.1', sceneId: 'gaolao-courtyard' };
  const group = {
    ...scope, enabled: true, groupVersion: 'controlled-scene-layer-v1',
    source: { file: '/assets/gaolaozhuang/scenes/courtyard.png', pixelSize: { width: 1586, height: 992 }, sha256: 'f5df307eaea03188e823a279cb3df3a65b1b6a7931c329294cd6b79e4c0d510a' },
    base: asset('/tests/layer-base.svg'), floors: [asset('/tests/layer-floor.svg')],
    foreground: [{ ...asset('/tests/layer-front.svg'), id: 'rear-front-controlled', depthY: 335, bounds: { x: 1290, y: 280, width: 70, height: 55 } }],
    replaceMask: asset('/tests/layer-mask.svg'),
    door: { visualKey: 'timber-door', targetPosition: { x: 1250, y: 425 }, depthY: 395, neutralBounds: { x: 1210, y: 300, width: 80, height: 95 }, objectArtVersion: 'controlled-door-v1' },
  };
  const doorAsset = file => ({ file, width: 80, height: 95, pivot: { x: 40, y: 65 }, scale: 1, offset: { x: 0, y: -60 }, layer: 'object' });
  const objectCatalog = { 'timber-door': { ...scope, version: 'controlled-door-v1', variants: { closed: doorAsset('/tests/layer-door-closed.svg'), open: doorAsset('/tests/layer-door-open.svg') } } };
  return { group, catalog: { [scope.sceneId]: group }, objectCatalog, files };
}
