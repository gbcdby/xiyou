// 页面输入与到达动作的薄协调层；游戏事实仍只经引擎动作改变。
import { MAP } from './engine.mjs';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const arrivalRadius=target=>['safe','meeting'].includes(target.id)?5:MAP.interactionRadius-3;

export function createNavigation(game) {
  let pending=null;
  function stop() {
    const actorId=pending?.actorId??game.state.activeId;
    pending=null;
    if(game.stop)return game.stop(actorId);
    const actor=game.state.actors[actorId];
    return actorId===game.state.activeId?game.moveTo(actor.x,actor.y):{ok:true};
  }
  function select(id) {
    if(id!==game.state.activeId)stop();
    return game.select(id);
  }
  function move(x,y) {
    stop();
    return game.moveTo(x,y);
  }
  function complete(command,target) {
    stop();
    const result=command.guideOnly?{ok:true,message:'已经到附近了，选择下方动作。'}:game.interact(target.id,command.actionId??undefined);
    return {...result,arrived:true,targetId:target.id,guideOnly:command.guideOnly};
  }
  function approach(targetId,actionId=null,guideOnly=false) {
    stop();
    const target=game.getTargets().find(item=>item.id===targetId);
    if(!target)return {ok:false,message:'这件事已经变化，看看当前任务吧。'};
    const actor=game.state.actors[game.state.activeId];
    const command={actorId:actor.id,targetId,actionId,guideOnly,lastX:target.x,lastY:target.y};
    if(distance(actor,target)<=arrivalRadius(target))return complete(command,target);
    const result=game.moveTo(target.x,target.y);
    if(!result.ok)return result;
    pending=command;
    return {ok:true,message:`${guideOnly?'前往':'先走近'}${target.name}`,arrived:false};
  }
  function update() {
    if(!pending)return null;
    if(pending.actorId!==game.state.activeId){stop();return {ok:false,message:'已取消上一位同伴的排队动作。'};}
    const target=game.getTargets().find(item=>item.id===pending.targetId);
    if(!target){stop();return {ok:false,message:'目标状态已变化，这次行动已取消。'};}
    const actor=game.state.actors[pending.actorId];
    if(distance(actor,target)<=arrivalRadius(target))return complete(pending,target);
    if(Math.hypot(target.x-pending.lastX,target.y-pending.lastY)>35){
      const result=game.moveTo(target.x,target.y);
      pending.lastX=target.x;pending.lastY=target.y;
      if(!result.ok){stop();return result;}
    }else if(!actor.moving&&!actor.path.length){stop();return {ok:false,message:'还需要再靠近一点。'};}
    return null;
  }
  return {get pending(){return pending;},approach,select,move,stop,update};
}
