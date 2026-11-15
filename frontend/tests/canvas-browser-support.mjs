import assert from 'node:assert/strict';

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
