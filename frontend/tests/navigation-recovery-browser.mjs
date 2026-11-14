import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer as createVite } from 'vite';
import { chromium } from 'playwright';
import { startTestPostgres } from '../../backend/test-support/postgres.mjs';
import { createAuthorityServer } from '../../backend/server.mjs';
import { rescue } from '../../backend/test-support/gaolao-room.mjs';
import { repository, sourceIdentity, saveJSON, until, sleep } from './network-support.mjs';
import { browserRoom, snapshot, clientState, closeReading } from './gaolao-real-support.mjs';

const mode = process.env.NAV_SCENARIO || 'delayed', output = resolve(process.env.NAV_EVIDENCE_DIR || resolve(repository, '.agent-output/nav-recovery', mode + '-' + Date.now()));
assert.ok(['map', 'natural', 'delayed'].includes(mode));
await mkdir(output, { recursive: true });
const report = { workId: 'R-34-NAV-RECOVERY-001', mode, scope: mode === 'map' ? '真实Vue SpatialMap组件，公开DTO fixture；仅检验同号不同计划的视觉事件身份，不是服务端事实验收' : '真实PG/HTTP/Socket/Vue双账号、显式旧v1合法救援fixture、正常玩家可见操作；只延迟原首段进入提交700ms（delayed），不改请求/世界/规则', source: await sourceIdentity(), startedAt: new Date().toISOString(), humanActions: [], npcActions: [], recapResponses: [], pageErrors: [], frames: [], samples: [], submits: [], visualConfirms: [], phases: [] };
let db, server, vite, browser, room, capture = false, arm = false;
const mark = name => { report.phases.push({ name, at: Date.now() }); console.log(JSON.stringify({ phase: name })); };
const cleanFrame = value => String(value).replace(/"token"\s*:\s*"[^"]*"/g, '"token":"[redacted]"');
function decode(value) { try { return JSON.parse(String(value).slice(String(value).indexOf('['))); } catch { return []; } }
const fixtureSource = `
import {createApp,h,shallowRef} from 'vue';
import SpatialMap from '/src/features/world/SpatialMap.vue';
import {spatialSnapshot} from '/tests/spatial-fixture.mjs';
const ref=letter=>'R'+letter.repeat(32),oldId=ref('h'),newId=ref('a'),initial=spatialSnapshot();
initial.projection.self.controlEpoch='4';initial.projection.self.position={x:200,y:100};
initial.projection.movement={movementId:oldId,planVersion:'5',movementCommandSeq:'1',sceneId:'yard',mapVersion:'gray-map-v1',goal:{x:200,y:100},path:[{x:200,y:100},{x:200,y:100}],acceptedAtSceneTime:1000,status:'arrived'};
const value=shallowRef(initial),events=[];
window.__navMap={events,oldId,newId,replace(){const next=structuredClone(value.value);next.snapshotSeq='11';next.projection.self.movementCommandHighWater='1';next.projection.movement={...next.projection.movement,movementId:newId,planVersion:'6'};value.value=next;},repeat(){value.value={...structuredClone(value.value),snapshotSeq:'12'};}};
createApp({setup(){return()=>h(SpatialMap,{snapshot:value.value,disabled:false,onSettled:message=>events.push(structuredClone(message))});}}).mount('#fixture');
`;
const fixturePlugin = {
    name: 'navigation-recovery-component-fixture',
    resolveId(id) { if (id === '/navigation-map-fixture.js') return '\0navigation-map-fixture'; },
    load(id) { if (id === '\0navigation-map-fixture') return fixtureSource; },
    configureServer(v) { v.middlewares.use((req, res, next) => { if (req.url !== '/navigation-map-fixture') return next(); res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="zh-CN"><head><style>.spatial-map-viewport{width:900px;height:600px}</style></head><body><div id="fixture"></div><script type="module" src="/navigation-map-fixture.js"></script></body></html>'); }); },
};
try {
    if (process.env.NAV_REQUIRE_CLEAN === '1') assert.equal(report.source.status, '', '冻结候选检查要求工作区干净');
    process.env.VITE_GAOLAO_CONTENT_VERSION = 'gaolaozhuang-v1';
    let origin;
    if (mode !== 'map') {
        db = await startTestPostgres('navigation-recovery', { outputSubdirectory: 'nav-recovery' });
        server = await createAuthorityServer({ pool: db.pool });
        const submit = server.runtime.submit.bind(server.runtime);
        server.runtime.submit = async (handle, raw) => {
            const request = JSON.parse(raw), row = { at: Date.now(), raw, request };
            if (capture) report.submits.push(row);
            if (arm && request.action.kind === 'move_to' && request.action.anchorId === 'C20') {
                arm = false; row.delayMs = mode === 'delayed' ? 700 : 0;
                if (row.delayMs) await sleep(row.delayMs);
                row.releasedAt = Date.now();
            }
            const receipt = await submit(handle, raw); row.receipt = receipt; row.returnedAt = Date.now(); return receipt;
        };
        const address = await server.listen(0); origin = 'http://127.0.0.1:' + address.port;
    }
    vite = await createVite({ root: resolve(repository, 'frontend'), configFile: resolve(repository, 'frontend/vite.config.mjs'), configLoader: 'native', cacheDir: resolve(output, 'vite-cache'), plugins: [fixturePlugin], server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] }, ...(origin ? { proxy: { '/api': { target: origin }, '/socket.io': { target: origin, ws: true } } } : {}) } });
    await vite.listen();
    const baseURL = 'http://127.0.0.1:' + vite.httpServer.address().port;
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium', args: [] });
    report.browserVersion = browser.version();
    if (mode === 'map') {
        const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
        page.on('pageerror', error => report.pageErrors.push(error.message));
        await page.goto(baseURL + '/navigation-map-fixture');
        await until(() => page.evaluate(() => window.__navMap?.events.length), '旧同号计划实际产生站定事件');
        report.before = await page.evaluate(() => structuredClone(window.__navMap.events));
        await page.evaluate(() => window.__navMap.replace());
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        report.after = await page.evaluate(() => structuredClone(window.__navMap.events));
        assert.equal(report.after.length, 2, '同视图/epoch/seq/脚点但不同movementId必须产生新的真实显示确认');
        assert.deepEqual(report.after.map(e => e.movementId), await page.evaluate(() => [window.__navMap.oldId, window.__navMap.newId]));
        await page.evaluate(() => window.__navMap.repeat()); await sleep(60);
        assert.equal(await page.evaluate(() => window.__navMap.events.length), 2, '同一计划重复投影不重复发视觉到达');
        report.status = 'PASS';
    } else {
        const makeContext = browser.newContext.bind(browser); let pageIndex = 0;
        browser.newContext = async options => {
            const context = await makeContext(options);
            context.on('page', page => {
                const index = pageIndex++;
                page.on('websocket', socket => {
                    for (const [event, direction] of [['framesent', 'sent'], ['framereceived', 'received']]) socket.on(event, frame => {
                        if (capture && index === 1) report.frames.push({ at: Date.now(), direction, raw: cleanFrame(frame.payload) });
                    });
                });
            }); return context;
        };
        mark('实际双客户端开局与合法救援');
        room = await browserRoom({ server, browser, baseURL, count: 2, contentVersion: 'gaolaozhuang-v1', report });
        report.sessionId = room.sessionId;
        await rescue(room);
        const page = room.pages[1]; await room.go(1, room.C('C18')); await closeReading(page);
        const close = page.getByRole('button', { name: '关闭对象区', exact: true }); if (await close.isVisible()) await close.click();
        await page.getByTestId('spatial-map').scrollIntoViewIfNeeded();
        // 权威到达不等于相机已跟完插值；先等实绘脚点，才换算下一次真实点地坐标。
        await until(() => page.locator('[data-spatial-self="true"]').evaluate(e => e.getAttribute('transform') === 'translate(950 650)'), 'C18实绘站定');
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const point = await page.getByTestId('spatial-map').evaluate(svg => { const p = new DOMPoint(850, 820).matrixTransform(svg.getScreenCTM()), hit = document.elementFromPoint(p.x, p.y); return { x: p.x, y: p.y, map: hit?.closest('svg.spatial-map') === svg, person: !!hit?.closest('.spatial-person'), button: !!hit?.closest('button') }; });
        report.startPoint = point; report.beforeStartPoint = await snapshot(page);
        assert.ok(point.map && !point.person && !point.button, '原850,820起点必须由真正空地点地');
        await page.mouse.click(point.x, point.y);
        await until(async () => { const p = (await snapshot(page)).projection; return p.movement?.status === 'arrived' && p.self.position.x === 850 && p.self.position.y === 820; }, '实际到达原失败起点');
        report.beforeReload = await snapshot(page); capture = true;
        mark('真实刷新与控制恢复');
        await page.reload(); await page.getByRole('button', { name: '恢复本人控制', exact: true }).click();
        await until(async () => (await clientState(page)).inputReady && !(await snapshot(page)).projection.paused, '恢复确认新输入源');
        report.afterReload = await snapshot(page);
        assert.equal(report.afterReload.projection.contentVersion, 'gaolaozhuang-v1');
        assert.equal(report.afterReload.projection.self.movementCommandHighWater, '0');
        assert.notEqual(report.afterReload.projection.self.controlEpoch, report.beforeReload.projection.self.controlEpoch);
        assert.equal(report.afterReload.projection.movement.movementId, report.beforeReload.projection.movement.movementId);
        await page.evaluate(async () => {
            const store = await import('/src/state/spatial-store.ts'), original = store.spatialClient.confirmDisplayedArrival;
            window.__navVisualConfirms = [];
            store.spatialClient.confirmDisplayedArrival = function(value) { window.__navVisualConfirms.push({ at: Date.now(), value }); return Reflect.apply(original, this, [value]); };
        });
        await closeReading(page);
        const objects = page.getByRole('button', { name: '附近对象与出口', exact: true }); if (await objects.isVisible()) await objects.click();
        const ids = (await clientState(page)).actions.map(a => a.id); arm = true; report.clickedAt = Date.now();
        mark('真实点击C20两阶段出口');
        await page.getByRole('button', { name: '走向出口 · 去庄外短路', exact: true }).click();
        const first = await until(async () => (await clientState(page)).actions.find(a => !ids.includes(a.id) && JSON.parse(a.raw).action.anchorId === 'C20'), '原首段从真实UI发出');
        report.firstRequest = JSON.parse(first.raw);
        const sample = async () => { const state = await clientState(page), s = await snapshot(page); report.samples.push({ at: Date.now(), queuedAction: state.queuedAction, inputReady: state.inputReady, snapshotSeq: s.snapshotSeq, viewId: s.viewId, self: s.projection.self, movement: s.projection.movement }); return { state, s }; };
        report.firstReceipt = await until(async () => { const { state } = await sample(); return state.actions.find(a => a.id === first.id)?.receipt; }, '保留原首段Receipt计时起点');
        assert.equal(report.firstReceipt.status, 'Accepted'); report.firstReceiptAt = Date.now(); report.deadlineAt = report.firstReceiptAt + 15000;
        try {
            await until(async () => (await sample()).s.projection.self.sceneId === 'gaolao-village-road', '原首段Receipt后15秒内权威跨场景', 15000);
            report.crossedAt = Date.now(); await sleep(600);
        } finally {
            report.finalSnapshot = await snapshot(page); report.finalClient = await clientState(page);
            report.visualConfirms = await page.evaluate(() => window.__navVisualConfirms);
            report.authority = await server.runtime.replay(room.sessionId);
            await page.screenshot({ path: resolve(output, report.crossedAt ? 'crossed.png' : 'not-crossed.png'), fullPage: true });
        }
        const actions = report.frames.filter(f => f.direction === 'sent').map(f => decode(f.raw)).filter(a => a[0] === 'player.action.request').map(a => JSON.parse(a[1]));
        report.exitRequests = actions.filter(a => a.controlEpoch === report.firstRequest.controlEpoch && (a.action.anchorId === 'C20' || a.action.sceneId === 'gaolao-village-road'));
        const crossing = report.exitRequests.filter(a => a.action.sceneId === 'gaolao-village-road');
        assert.equal(crossing.length, 1, '只能发送一次第二段，不能换ID重试或重复跨场景');
        assert.equal(crossing[0].action.movementCommandSeq, '2');
        assert.equal(report.firstRequest.action.movementCommandSeq, '1');
        assert.equal(crossing[0].controlEpoch, report.firstRequest.controlEpoch);
        assert.equal(report.crossedAt <= report.deadlineAt, true);
        const firstSubmit = report.submits.find(s => s.request.clientActionId === report.firstRequest.clientActionId);
        assert.equal(firstSubmit.raw, first.raw); assert.deepEqual(firstSubmit.receipt, report.firstReceipt);
        report.crossedAfterServerReceiptMs = report.crossedAt - firstSubmit.returnedAt;
        assert.ok(report.crossedAfterServerReceiptMs <= 15000, '从原提交返回Receipt起也须在15秒内跨场景');
        if (mode === 'delayed') {
            assert.equal(firstSubmit.delayMs, 700);
            const waiting = report.samples.filter(s => s.at < firstSubmit.releasedAt && s.self.movementCommandHighWater === '0');
            assert.ok(waiting.length > 0); assert.ok(waiting.every(s => s.queuedAction), '首段进入提交前普通批次不能清除新队列');
        }
        report.status = 'PASS';
    }
    assert.deepEqual(report.pageErrors, []);
} catch (error) {
    report.status = 'FAIL'; report.error = { message: error.message, stack: error.stack }; console.error(error);
    if (room?.pages[1]) {
        try { report.failureSnapshot = await snapshot(room.pages[1]); report.failureClient = await clientState(room.pages[1]); }
        catch (diagnostic) { report.diagnosticError = diagnostic.message; }
    }
}
finally {
    await room?.close(); await browser?.close(); await vite?.close(); await server?.close(); await db?.stop();
    report.resourcesClosed = true; report.finishedAt = new Date().toISOString(); report.sourceEnd = await sourceIdentity();
    await saveJSON(resolve(output, 'result.json'), report);
}
console.log(JSON.stringify({ mode, status: report.status, output, crossedAfterReceiptMs: report.crossedAt ? report.crossedAt - report.firstReceiptAt : null }));
process.exitCode = report.status === 'PASS' ? 0 : 1;
