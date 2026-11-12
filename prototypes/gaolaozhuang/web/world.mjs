// 仅负责场景绘制与屏幕坐标换算，不改变任何游戏事实。
import { MAP } from './engine.mjs';
import { gaocaiDirection, gaocaiFrameIndex } from './gaocai-animation.mjs';

const palette = {
  gaocai: ['#618e88','#395e5d','#c6dcd0'], carpenter: ['#b28a65','#6d5848','#e8cfaa'],
  wukong: ['#d3aa56','#8b6a40','#f3dc91'], cuilan: ['#ca9a93','#8d656c','#ead0c5'],
  tangseng: ['#b47859','#7c483d','#e4cc9f'], bajie: ['#918b76','#63594d','#c7baa0'],
  cook: ['#8a9b78','#596c53','#c8d0b1'],
};

export function createRenderer(canvas, game, onAssetError) {
  const ctx = canvas.getContext('2d');
  let width = 0, height = 0, scale = 1, offsetX = 0, offsetY = 0, cameraX = 800;
  let hoverId = null, clickMark = null;
  const background = new Image();
  background.onerror = () => onAssetError?.({ kind: 'background' });
  background.src = './assets/courtyard.png';
  const font = '"Noto Serif CJK SC", "Songti SC", STSong, serif';
  let gaocaiSprites = null, characterErrorReported = false;

  function characterAssetError() {
    if (characterErrorReported) return;
    characterErrorReported = true;
    onAssetError?.({ kind: 'character', characterId: 'gaocai' });
  }

  async function preloadGaocai() {
    try {
      const manifestUrl = new URL('./assets/gaocai/manifest.json', import.meta.url);
      const response = await fetch(manifestUrl);
      if (!response.ok) throw new Error('高才动画清单未载入');
      const manifest = await response.json();
      const groups = ['s', 'se', 'e', 'ne', 'n'].map(direction => manifest.native[direction]);
      // 只校验实际绘制会消费的字段；坏清单整包回退旧人物，不能进入逐帧 draw 后才抛错。
      const usableFrame = frame => typeof frame?.file === 'string' && frame.file.length > 0
        && [frame.width, frame.height, frame.scale].every(value => Number.isFinite(value) && value > 0)
        && Number.isFinite(frame.footPivot?.x) && Number.isFinite(frame.footPivot?.y);
      if (groups.some(group => !usableFrame(group?.idle) || !Array.isArray(group?.walk?.frames)
        || group.walk.frames.length !== 8 || !group.walk.frames.every(usableFrame)
        || !Number.isFinite(group.walk.frameDurationMs) || group.walk.frameDurationMs <= 0)) {
        throw new Error('高才动画清单字段无效');
      }
      const frames = groups.flatMap(group => [group.idle, ...group.walk.frames]);
      const images = new Map();
      await Promise.all(frames.map(async frame => {
        try {
          const picture = new Image();
          await new Promise((resolve, reject) => {
            picture.onload = resolve;
            picture.onerror = reject;
            picture.src = new URL(frame.file, manifestUrl).href;
          });
          // 浏览器支持时等解码结束；现有 Image 测试替身不需要提供 decode。
          if (typeof picture.decode === 'function') await picture.decode();
          images.set(frame.file, picture);
        } catch { characterAssetError(); }
      }));
      // 预载完成前继续旧绘制。某个方向缺行走帧时，整组降为同方向站姿。
      gaocaiSprites = { manifest, images };
    } catch { characterAssetError(); }
  }

  function drawGaocaiSprite(actor) {
    if (!gaocaiSprites) return false;
    const { manifest, images } = gaocaiSprites;
    const direction = gaocaiDirection(actor.facing);
    const group = manifest.native[direction.nativeDirection];
    const frames = group.walk.frames;
    const canWalk = frames.length === 8 && frames.every(frame => images.has(frame.file));
    const frame = actor.moving && canWalk
      ? frames[gaocaiFrameIndex(actor.walkDistance, group.walk.frameDurationMs, frames.length)]
      : group.idle;
    const picture = images.get(frame.file);
    if (!picture) return false;
    ctx.save();
    ctx.scale(direction.mirrorX ? -1 : 1, 1);
    // scale 已包含来源组的等比缩放；镜像中心是脚底落点，不能再乘 groupScale。
    ctx.drawImage(picture, -frame.footPivot.x * frame.scale, -frame.footPivot.y * frame.scale,
      frame.width * frame.scale, frame.height * frame.scale);
    ctx.restore();
    return true;
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width; height = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scale = Math.max(width / 1600, height / 1000);
  }

  function projection(dt) {
    const actor = game.state.actors[game.state.activeId];
    const half = width / scale / 2;
    const wanted = Math.max(half, Math.min(1600 - half, actor.x));
    cameraX += (wanted - cameraX) * Math.min(1, dt * 5);
    if (width / height > 1.2) cameraX = 800;
    offsetX = width / 2 - cameraX * scale;
    offsetY = (height - 1000 * scale) / 2;
  }

  function toWorld(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return {x:(clientX-r.left-offsetX)/scale, y:(clientY-r.top-offsetY)/scale};
  }

  function hitTest(p) {
    // 可见但暂不可执行的对象仍可询问原因，避免点击被误判成地面。
    const targets = game.getTargets().filter(t => t.visible !== false && t.id !== game.state.activeId && !(t.id === 'door' && t.completed));
    // 头像比脚下交互圈高，人物点击容忍覆盖整身。
    // 等距重叠按实际绘制先后命中上层人物；开门后消失的门障不再截获脚边点击。
    return targets.map((t, order) => {
      const actor = game.state.actors[t.id];
      const dy = actor ? p.y - (t.y - 28) : p.y - t.y;
      return {t, order, d: Math.hypot(p.x-t.x, dy * (actor ? .72 : 1))};
    }).filter(v => v.d < 43).sort((a,b)=>a.d-b.d || b.t.y-a.t.y || b.order-a.order)[0]?.t || null;
  }

  function line(points, color, lw=2) {
    ctx.beginPath(); points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
    ctx.strokeStyle=color;ctx.lineWidth=lw;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();
  }

  function ellipse(x,y,rx,ry,fill,stroke) {
    ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1.3;ctx.stroke();}
  }

  function shape(points, fill, stroke='#48574796', lw=1.4) {
    ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=stroke;ctx.lineWidth=lw;ctx.lineJoin='round';ctx.stroke();
  }

  function label(text,x,y,{active=false,small=false}={}) {
    ctx.save();ctx.font=`${small?13:15}px ${font}`;ctx.textAlign='center';ctx.textBaseline='middle';
    const w=ctx.measureText(text).width+20;
    ctx.fillStyle=active?'#f5f6e8f5':'#f7f4e5df';ctx.strokeStyle=active?'#527c668f':'#89987960';ctx.lineWidth=.8;
    ctx.beginPath();ctx.roundRect(x-w/2,y-12,w,24,3);ctx.fill();ctx.stroke();
    ctx.fillStyle=active?'#3e6a56':'#596850';ctx.fillText(text,x,y+.5);ctx.restore();
  }

  function drawFallback() {
    const grad=ctx.createLinearGradient(0,0,0,1000);grad.addColorStop(0,'#d9e0cf');grad.addColorStop(.45,'#f2eedf');grad.addColorStop(1,'#e8e8d2');ctx.fillStyle=grad;ctx.fillRect(0,0,1600,1000);
    ctx.fillStyle='#e5deca';ctx.fillRect(100,300,1400,640);
    for(let row=0;row<16;row++)for(let col=0;col<23;col++){ctx.strokeStyle='#b9c2a930';ctx.lineWidth=1;ctx.strokeRect(110+col*61+(row%2)*24,325+row*38,59,36);}
    [[100,100,400,250],[610,65,440,240],[1060,100,390,240]].forEach(([x,y,w,h])=>{
      shape([[x,y+45],[x+w,y+45],[x+w,y+h],[x,y+h]],'#f8f4e4');
      shape([[x-30,y+40],[x+w/2,y-60],[x+w+30,y+40],[x+w,y+70],[x,y+70]],'#6f8072','#51665a');
      line([[x-30,y+40],[x+w/2,y-60],[x+w+30,y+40]],'#405f55',5);
      ctx.fillStyle='#a49274';ctx.fillRect(x+w*.42,y+h-90,60,90);
    });
    ellipse(555,480,72,47,'#7e9c7160','#7f9b6b');
    shape([[748,487],[893,487],[912,553],[742,553]],'#b1b2a0','#7c8b72');
    line([[769,552],[764,581]],'#7e8973',12);line([[883,552],[888,581]],'#7e8973',12);
    for(let i=0;i<8;i++){const x=70+i*20;line([[x,700],[x+8,460]],'#789565',3);for(let j=0;j<5;j++){line([[x+4,500+j*33],[x+25,487+j*33]],'#70916b',6);}}
  }

  function drawRoute(actor, time) {
    if(!actor.path?.length) return;
    ctx.save();ctx.beginPath();ctx.moveTo(actor.x,actor.y);
    for(const p of actor.path) ctx.lineTo(p.x ?? p[0],p.y ?? p[1]);
    ctx.strokeStyle=actor.id===game.state.activeId?'#567e688b':'#9483684d';ctx.lineWidth=2;ctx.setLineDash([5,9]);ctx.lineDashOffset=-time*10;ctx.stroke();
    const last=actor.path.at(-1);ellipse(last.x??last[0],last.y??last[1],10,5,null,'#69856380');ctx.restore();
  }

  function drawDoor() {
    // 底图保留敞开的门洞；原型木障独立覆盖，开门事实成立后才移走。
    if(game.state.facts.doorOpen)return;
    shape([[1194,240],[1301,243],[1303,359],[1190,358]],'#827254ed','#665e43',2);
    for(let i=0;i<6;i++)line([[1198+i*18,246],[1195+i*18,353]],'#6c644dc0',1.5);
    line([[1188,296],[1306,318]],'#aa8d60',11);
    line([[1193,344],[1302,274]],'#907d55',9);
    line([[1190,300],[1304,322]],'#c4b18a',1);
    label('后屋 · 门扇受损',1250,219,{small:true});
  }

  function drawObject(t,time) {
    const active = t.enabled;
    ctx.save();ctx.translate(t.x,t.y);
    const pulse = 1+Math.sin(time*3)*.09;
    if(active){ellipse(0,2,20*pulse,10*pulse,'#f8f5dc80','#79926890');}
    if(t.id==='wood'){
      for(let n=0;n<4;n++){shape([[-23+n*3,-7-n*4],[18+n*3,-13-n*4],[23+n*3,-6-n*4],[-19+n*3,0-n*4]],'#ad8b60','#6a6b4e');}
    } else if(t.id==='ledger'){
      shape([[-17,-23],[13,-25],[18,-4],[-12,0]],'#e0cd91','#7c805a');shape([[-17,-23],[-13,-23],[-8,0],[-12,0]],'#92a28a');
      line([[-7,-18],[9,-20]],'#7e825d',1);line([[-5,-13],[9,-15]],'#7e825d',1);line([[-3,-8],[9,-10]],'#7e825d',1);
    } else if(t.id==='left-support'||t.id==='right-support'){
      const installed = t.completed || (t.id==='left-support'?game.state.facts.leftInstalled:game.state.facts.rightInstalled);
      if(installed){line([[-16,5],[9,-60]],'#7f6b48',8);line([[18,5],[-7,-60]],'#99805b',7);line([[-13,-15],[16,-15]],'#7a6948',5);}
      else{ctx.setLineDash([3,5]);ellipse(0,1,18,9,null,'#7a917581');ctx.setLineDash([]);line([[-7,-12],[0,-20],[7,-12]],'#7f9374',2);}
    } else if(t.id==='safe'){
      ellipse(0,0,52,23,'#a7bea027','#829a6a88');
      if(!game.state.facts.cuilanSafe){line([[-7,-6],[0,-12],[7,-6]],'#789367',2);}
    } else if(t.id==='meeting'){
      ellipse(0,0,50,24,'#c6b78219','#ac956877');
    }
    if(active && !['door','safe','meeting'].includes(t.id)){
      ctx.fillStyle='#f5eed9';ctx.strokeStyle='#889971';ctx.lineWidth=1;ctx.beginPath();ctx.arc(0,-39,9,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#758d5c';ctx.font=`13px ${font}`;ctx.textAlign='center';ctx.fillText(t.id==='ledger'?'录':t.id==='wood'?'料':'支',0,-34);
    }
    ctx.restore();
    const named = {'wood':'支架木料','ledger':'旧饭账','left-support':'左支架','right-support':'右支架','safe':'前庭安置处','meeting':'会面处'};
    if(named[t.id] && (active || t.id===hoverId)) label(named[t.id],t.x,t.y+28,{small:true});
  }

  function drawActor(actor, time) {
    if(actor.hidden || actor.visible===false) return;
    if(actor.id==='bajie' && !game.state.facts.cuilanSafe) return;
    const [base,deep,light]=palette[actor.id]||palette.gaocai;
    const active=actor.id===game.state.activeId;
    const isHuman=['gaocai','carpenter'].includes(actor.id);
    const bob=actor.moving?Math.sin(time*13)*1.8:Math.sin(time*1.5+actor.x)*.35;
    const step=actor.moving?Math.sin(time*13)*5:0;
    ctx.save();ctx.translate(actor.x,actor.y);
    ellipse(0,1,21,7,'#536c4c27');
    if(active){ellipse(0,0,25,10,'#6f9b7030','#4f896bbf');ellipse(0,0,29,12,null,'#acc49d70');}
    if(actor.id===hoverId)ellipse(0,0,25,10,'#bfc59c35','#9c9b6d99');
    ctx.save();
    if (!(actor.id === 'gaocai' && drawGaocaiSprite(actor))) {
      const next=actor.path?.[0];const direction=next?Math.sign((next.x??next[0])-actor.x)||1:1;
      ctx.scale(direction,1);ctx.translate(0,bob);
      // 墨线勾勒的小幅人物只承担原型辨识；不是正式八方向动画资产。
      line([[-7,-8],[-10-step*.55,0]],'#4e5145',5);line([[7,-8],[9+step*.55,0]],'#4e5145',5);
      if(actor.id==='wukong'){ctx.beginPath();ctx.moveTo(-10,-20);ctx.bezierCurveTo(-40,-17,-32,-38,-24,-34);ctx.strokeStyle=deep;ctx.lineWidth=4;ctx.stroke();}
      const robeBottom=actor.id==='cuilan'?20:17;
      shape([[-12,-47],[12,-47],[robeBottom,-9],[-robeBottom,-9]],base,deep,1.5);
      shape([[-10,-45],[0,-37],[-3,-13],[-14,-11]],light,'#70766155',.7);
      shape([[0,-37],[9,-45],[15,-10],[7,-11]],base,'#70766166',.8);
      const arm=step*.3;shape([[-13,-45],[-23,-25+arm],[-15,-20+arm],[-6,-37]],base,deep,.8);shape([[12,-45],[23,-26-arm],[15,-22-arm],[6,-36]],base,deep,.8);
      ellipse(-17,-22+arm,3.4,3.7,'#e3c9a6');ellipse(17,-23-arm,3.4,3.7,'#e3c9a6');
      line([[-12,-29],[13,-29]],deep,3);line([[1,-28],[5,-12]],light,1.2);
      if(actor.id==='tangseng'){
        shape([[-12,-44],[13,-38],[15,-12],[4,-13]],'#bc7059','#8c5948',.8);
        for(let j=0;j<3;j++)line([[0,-37+j*9],[12,-34+j*9]],'#dcb182',.8);
      }
      ellipse(0,-55,10,12,'#ead2b1',deep);
      if(actor.id==='bajie'){
        ellipse(-12,-58,7,10,'#bcaa8b',deep);ellipse(12,-58,7,10,'#bcaa8b',deep);
        ellipse(5,-53,7,4.5,'#d3b694',deep);ctx.fillStyle='#77674f';ctx.fillRect(4,-54,1.5,1.7);ctx.fillRect(8,-54,1.5,1.7);
      }
      ctx.fillStyle='#444b40';ctx.beginPath();ctx.ellipse(0,-63,10,6.5,0,Math.PI,Math.PI*2);ctx.fill();
      if(actor.id==='tangseng'){
        shape([[-11,-64],[-9,-79],[-4,-72],[0,-83],[5,-72],[10,-78],[11,-63]],'#d8bb77','#9c8156',1);line([[-8,-66],[8,-66]],'#bc8c54',2);
      }else if(actor.id==='wukong'){
        line([[-10,-61],[10,-61]],'#cfa746',2.5);ellipse(0,-71,5,4,deep);
      }else if(actor.id==='cuilan'){
        ellipse(-8,-65,5,8,'#454a40');ellipse(6,-68,5,4,'#454a40');line([[-11,-69],[10,-72]],'#ab7d70',2);ellipse(10,-72,2,2,'#d6b498');
      }else if(actor.id==='cook'){
        shape([[-11,-63],[-9,-72],[8,-72],[11,-62]],'#a5b28e',deep,.8);
      }else if(actor.id==='carpenter'){
        shape([[-12,-63],[-10,-70],[8,-72],[12,-63]],'#896f4c',deep,.8);
      }else{ellipse(0,-70,4.8,4.4,'#414e41');line([[-6,-64],[7,-64]],base,3);}
      line([[3,-56],[5,-56]],'#68604c',1);line([[3,-50],[6,-50]],'#aa8566',.8);
    }
    // 小小包袱让拿到物件的状态在场景中可见。
    const holds=Object.values(game.state.items||{}).some(item=>item.owner===actor.id);
    if(holds){ellipse(-13,-31,6,8,'#b9a57a','#7e815b');line([[-8,-44],[-13,-31]],'#d4c9a5',2);}
    ctx.restore();
    ctx.restore();
    label(actor.name+(active?' · 你':''),actor.x,actor.y+22,{active,small:!isHuman});
    if(isHuman){ctx.save();ctx.fillStyle=active?'#568063':'#b1956a';ctx.beginPath();ctx.arc(actor.x,actor.y-83,3.2,0,Math.PI*2);ctx.fill();ctx.restore();}
  }

  function draw(time,dt) {
    if(!width||!height) resize();
    projection(dt);
    ctx.clearRect(0,0,width,height);
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);
    if(background.complete && background.naturalWidth)ctx.drawImage(background,0,0,1600,1000);else drawFallback();
    drawDoor();
    for(const actor of Object.values(game.state.actors))if(['gaocai','carpenter'].includes(actor.id))drawRoute(actor,time);
    const targets=game.getTargets();
    for(const t of targets)if(!game.state.actors[t.id])drawObject(t,time);
    if(clickMark){const age=time-clickMark.at;if(age<.8){ctx.globalAlpha=1-age/.8;ellipse(clickMark.x,clickMark.y,10+age*20,5+age*10,null,'#668c70');ctx.globalAlpha=1;}else clickMark=null;}
    if(game.state.facts.doorOpen){label('门已开',1250,342,{small:true});}
    Object.values(game.state.actors).sort((a,b)=>a.y-b.y).forEach(actor=>drawActor(actor,time));
    ctx.restore();
  }

  resize();
  void preloadGaocai();
  return {draw,resize,toWorld,hitTest,setHover(id){hoverId=id;},mark(point,time){clickMark={...point,at:time};}};
}
