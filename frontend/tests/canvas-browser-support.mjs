import assert from 'node:assert/strict';

/** 比较每次真实 paint 的位置和它实际使用的插值时钟，不把稍后的画面读取时刻配给旧帧。 */
export function assertPaintContinuity(capture) {
  const paints = capture.paints;
  assert.ok(Array.isArray(paints) && paints.length >= 2, '必须捕获实际绘制，不能仅用重复读取重建动画');
  capture.continuity = []; capture.motionBoundaries = [];
  const scope = ['rendererId', 'instance', 'sceneId', 'viewId', 'controlEpoch', 'appearanceEpoch'];
  for (const paint of paints) {
    assert.ok(scope.every(key => paint[key] !== undefined) && paint.self?.ref, '每个实际绘制都须记录身份与实例边界');
    assert.ok([paint.motionAt, paint.self.position.x, paint.self.position.y, paint.self.distance].every(Number.isFinite));
  }
  for (let i = 1; i < paints.length; i++) {
    const from = paints[i - 1], to = paints[i];
    const changed = scope.filter(key => from[key] !== to[key]); if (from.self.ref !== to.self.ref) changed.push('entityRef');
    if (changed.length) { capture.motionBoundaries.push({ from, to, changed }); continue; }
    assert.equal(to.serial, from.serial + 1, '连续实例不能遗漏实际绘制或把同一serial的重复读取当新帧');
    const interval = { from, to, delta: Math.hypot(to.self.position.x - from.self.position.x, to.self.position.y - from.self.position.y), dt: to.motionAt - from.motionAt };
    interval.limit = 180 * interval.dt / 1000 + 4; capture.continuity.push(interval);
    if (interval.dt < 0 || interval.delta > interval.limit || to.self.distance < from.self.distance) capture.failedInterval = interval;
    assert.ok(interval.dt >= 0, '真实绘制插值时钟不能倒退');
    assert.ok(to.self.distance >= from.self.distance, '连续短计划步态相位不重置');
    assert.ok(interval.delta <= interval.limit, '确认段不发生超速跳点');
  }
  return capture.continuity;
}

/** late只在原捕获窗内计真实SE/S绘制；输入相位不截断已确认历史的播放。 */
export function assertLateCanvasEvidence(capture, { sceneId, viewId, controlEpoch, selfRef, selected, firstSouth }) {
  const intervals = assertPaintContinuity(capture);
  assert.deepEqual(capture.motionBoundaries, [], 'late不能跨身份或实例边界合并绘制数量');
  assert.ok(intervals.length >= 10, 'late完整paint流至少保留10个连续区间');
  const first = capture.paints[0];
  assert.deepEqual({ sceneId: first.sceneId, viewId: first.viewId, controlEpoch: first.controlEpoch, selfRef: first.self.ref },
    { sceneId, viewId, controlEpoch, selfRef }, 'late实际paint必须保持原场景和本人绑定');
  const sequence = (value, label) => {
    assert.ok(typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value), `${label}必须为十进制字符串`);
    return BigInt(value);
  };
  const anchors = Object.fromEntries([['SE', selected], ['S', firstSouth]].map(([direction, row]) => {
    assert.ok(row?.request && row.receipt, `${direction}缺少原覆盖锚点`);
    const { request, receipt } = row;
    assert.equal(typeof row.raw, 'string', `${direction}必须保留原始请求`);
    assert.deepEqual(JSON.parse(row.raw), request, `${direction}必须与原始请求一致`);
    assert.ok(request.action?.kind === 'move_direction' && request.action.direction === direction, `${direction}必须保持原方向`);
    assert.deepEqual({ sceneId: request.action.sceneId, viewId: request.viewId, controlEpoch: request.controlEpoch, selfRef: request.actorRef },
      { sceneId, viewId, controlEpoch, selfRef }, `${direction}必须保持原请求绑定`);
    assert.ok(['sessionId', 'clientActionId'].every(key => typeof request[key] === 'string' && request[key].length), `${direction}原请求绑定必须完整`);
    assert.equal(receipt.status, 'Accepted', `${direction}必须保留原Accepted收据`);
    assert.equal(receipt.sessionId, request.sessionId, `${direction}的Receipt身份必须属于原请求`);
    assert.equal(receipt.clientActionId, request.clientActionId, `${direction}的Receipt身份必须属于原请求`);
    sequence(receipt.observedSeq, `${direction}原Receipt observedSeq`);
    return [direction, { clientActionId: request.clientActionId, observedSeq: receipt.observedSeq }];
  }));
  assert.equal(selected.request.sessionId, firstSouth.request.sessionId, '两个原覆盖锚点必须属于同一房间');
  assert.notEqual(anchors.SE.clientActionId, anchors.S.clientActionId, 'A和首S必须是不同原动作');
  const qualified = capture.paints.filter(row => row.self.moving === true && ['SE', 'S'].includes(row.self.facing)
    && sequence(row.snapshotSeq, 'paint snapshotSeq') >= BigInt(anchors[row.self.facing].observedSeq));
  assert.ok(qualified.length >= 10, 'late原捕获窗内至少10次已覆盖原A/首S的真实SE/S运动paint');
  const phaseCounts = {};
  for (const row of qualified) phaseCounts[row.phase] = (phaseCounts[row.phase] ?? 0) + 1;
  return { unit: 'actual-paint', binding: { sceneId, viewId, controlEpoch, selfRef,
    rendererId: first.rendererId, instance: first.instance, appearanceEpoch: first.appearanceEpoch }, anchors,
    totalPaints: capture.paints.length, qualifiedPaints: qualified.length, continuityIntervals: intervals.length, phaseCounts };
}

/** 读取生产渲染器刚完成的真实Canvas帧；不创建隐藏SVG或按测试需要重画场景。 */
export async function canvasFrame(page) {
  const frame = await page.getByTestId('spatial-map').evaluate(async canvas => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('主场景必须是真实Canvas');
    return (await import('/src/rendering/spatial-canvas.ts')).readCanvasFrame(canvas);
  });
  assert.ok(frame, '实际画布已完成至少一次合成');
  return frame;
}

export async function worldPixel(page, position, { round = false } = {}) {
  return page.getByTestId('spatial-map').evaluate(async (canvas, { position, round }) => {
    const frame = (await import('/src/rendering/spatial-canvas.ts')).readCanvasFrame(canvas);
    if (!frame || !(canvas instanceof HTMLCanvasElement)) throw new Error('场景画布尚未完成绘制');
    const box=canvas.getBoundingClientRect(),fit=frame.fit;
    const x=box.left+fit.x+position.x*fit.scale,y=box.top+fit.y+position.y*fit.scale;
    const pixel={x:round?Math.round(x):x,y:round?Math.round(y):y};
    const hit=document.elementFromPoint(pixel.x,pixel.y);
    return {pixel,click:{x:pixel.x-box.left,y:pixel.y-box.top},mappedWorld:{x:Math.round((pixel.x-box.left-fit.x)/fit.scale),y:Math.round((pixel.y-box.top-fit.y)/fit.scale)},scale:fit.scale,hit:{tag:hit?.tagName,class:hit?.getAttribute('class'),label:hit?.closest('button')?.getAttribute('aria-label')||null}};
  }, { position, round });
}

/** 独立检查真实像素与DPR尺寸；帧清单本身不充当像素或动效验收。 */
export async function canvasPixels(page) {
  const result=await page.getByTestId('spatial-map').evaluate(canvas=>{
    const box=canvas.getBoundingClientRect(),data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,colors=new Set();
    let opaque=0,samples=0,hash=2166136261;
    const stride=Math.max(1,Math.floor(Math.sqrt(canvas.width*canvas.height/10000)));
    for(let y=0;y<canvas.height;y+=stride)for(let x=0;x<canvas.width;x+=stride){const i=(y*canvas.width+x)*4;samples++;if(data[i+3])opaque++;const color=((data[i]<<24)|(data[i+1]<<16)|(data[i+2]<<8)|data[i+3])>>>0;colors.add(color);hash=Math.imul(hash^color,16777619)>>>0;}
    return {width:canvas.width,height:canvas.height,css:{width:box.width,height:box.height},dpr:devicePixelRatio,colors:colors.size,opaque,samples,hash,entityDOM:document.querySelectorAll('.spatial-map svg,.spatial-map .spatial-person,.spatial-map .spatial-item,.spatial-map .spatial-target,.spatial-map image').length};
  });
  assert.ok(result.width>0&&result.height>0&&result.css.width>0&&result.css.height>0);
  assert.ok(Math.abs(result.width-result.css.width*result.dpr)<=1&&Math.abs(result.height-result.css.height*result.dpr)<=1,'CSS尺寸与DPR backing尺寸一致');
  assert.ok(result.opaque/result.samples>.95&&result.colors>8,'实际合成像素非空且具有场景层次');
  assert.equal(result.entityDOM,0,'主场景没有逐实体DOM/SVG绘图');
  return result;
}
