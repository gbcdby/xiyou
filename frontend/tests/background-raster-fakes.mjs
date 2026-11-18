export const format = { alpha: true, colorSpace: 'srgb', colorType: 'unorm8', desynchronized: false, willReadFrequently: false };
export const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
export const picture = (src = '/base.png') => ({ complete: true, naturalWidth: 1586, naturalHeight: 992, src, currentSrc: src });
export function context(attributes = format) {
  const states = [], operations = [], draws = [];
  return { canvas: { width: 1226, height: 684 }, matrix: { ...identity }, operations, draws, reads: 0, clipToken: 'root',
    globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none', shadowColor: 'rgba(0, 0, 0, 0)', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, imageSmoothingEnabled: true, imageSmoothingQuality: 'low',
    stateDepth: () => states.length, resetNativeState() { states.length=0; this.matrix={...identity}; this.clipToken='root'; this.globalAlpha=1; }, beginPath() { this.pendingRect = null; }, rect(...args) { this.pendingRect = { args, matrix: { ...this.matrix } }; }, clip() { this.clipToken += '|' + JSON.stringify(this.pendingRect); },
    getContextAttributes: () => ({ ...attributes }), getTransform() { this.reads++; return { ...this.matrix }; },
    save() { states.push({ matrix: { ...this.matrix }, clipToken: this.clipToken, globalAlpha: this.globalAlpha }); },
    restore() { Object.assign(this, states.pop()); },
    setTransform(a, b, c, d, e, f) { this.matrix = { a, b, c, d, e, f }; operations.push(['setTransform', a, b, c, d, e, f]); },
    translate(x, y) { const m = this.matrix; m.e += m.a*x+m.c*y; m.f += m.b*x+m.d*y; operations.push(['translate', x, y]); },
    scale(x, y) { const m = this.matrix; m.a *= x; m.b *= x; m.c *= y; m.d *= y; operations.push(['scale', x, y]); },
    clearRect(...args) { operations.push(['clearRect', ...args]); },
    drawImage(...args) { draws.push({ args, matrix: { ...this.matrix }, clipToken: this.clipToken }); operations.push(['drawImage', ...args]); },
  };
}
export const transform = () => ({ viewport: { width: 1226, height: 684, dpr: 1 }, fit: { x: 65.8, y: 0, scale: .684 } });
export const bounds = () => ({ x: 0, y: 0, width: 1600, height: 1000 });
export function apply(target, value) { const { viewport, fit } = value; target.setTransform(viewport.dpr,0,0,viewport.dpr,0,0); target.translate(fit.x,fit.y); target.scale(fit.scale,fit.scale); }
export function facility() { const surfaces = []; return { surfaces, create() { const ctx = context(), canvas = { width: 0, height: 0, ctx, getContext: () => ctx }; ctx.canvas = canvas; surfaces.push(canvas); return canvas; } }; }
