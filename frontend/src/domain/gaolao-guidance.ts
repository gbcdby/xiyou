import type { Position, ProjectionV2 } from '../../../game/spatial-types.ts';
import { currentConsents } from './gaolao-actions.ts';
import { navigationScenes } from './gaolao-map-overview.ts';

export type GuidanceAction =
  | { kind: 'objects' | 'chapter' | 'inventory' | 'notebook' | 'receipts' | 'recap'; label: string }
  | { kind: 'select'; reference: string; label: string }
  | { kind: 'navigate'; sceneId: string; position: Position; label: string };
export interface GuidanceContext { online: boolean; inputReady: boolean; unknownCount: number }
export interface GaolaoGuidance {
  goal: string;
  knownProgress: string | null;
  next: { title: string; description: string; action?: GuidanceAction };
  status: { text: string; tone: 'neutral' | 'pending' | 'uncertain' | 'paused' | 'confirmed' };
}

/** 只整理当前观察者已获准的事实与入口；不推断秘密，不代发世界动作。 */
export function gaolaoGuidance(p: ProjectionV2 | null, context: GuidanceContext): GaolaoGuidance | null {
  if (!p) return null;
  const chapter = p.chapter;
  const completed = new Set(chapter?.progress.filter(field => field.value === true).map(field => field.key));
  // 已知后续事实优先；未获知早期记录不等于早期事项失败或仍未完成。
  const stage = completed.has('compared') ? 'compared' : completed.has('safe') ? 'safe' : completed.has('open') ? 'open' : 'rescue';
  const knownProgress = chapter?.progress.find(field => field.key === stage && field.value === true)?.label ?? chapter?.progress.filter(field => field.value === true).at(-1)?.label ?? null;
  const objective = p.objectives.find(value => value.status === 'active') || p.objectives.find(value => value.status === 'blocked');
  const goal = stage === 'compared' ? '听取双方的去留决定，完成归还与离庄安排。'
    : stage === 'safe' ? '核对材料，与旅伴商量后续安排。'
      : stage === 'open' ? '询问本人意愿，约定并完成安全安置。'
        : objective?.label || '与旅伴一起了解眼前情况。';
  const result: GaolaoGuidance = {
    goal, knownProgress,
    next: { title: '选择本场的人或物，走近查看', description: '地图可以定位公开地点；具体操作会在对象卡片中说明。', action: { kind: 'objects', label: '查看本场对象' } },
    status: { text: '点击场景或按方向键行走', tone: 'neutral' },
  };
  const waypoint = (anchorId: string, title: string, description: string): GaolaoGuidance['next'] | null => {
    const scenes = navigationScenes(p.scene, p.mapCatalog);
    for (const scene of scenes) {
      const anchor = scene.anchors.find(value => value.anchorId === anchorId);
      if (anchor) return { title, description, action: { kind: 'navigate', sceneId: scene.sceneId, position: { ...anchor.position }, label: `前往${anchor.label}` } };
    }
    return null;
  };
  if (p.phase === 'Finished' || p.phase === 'Aborted') {
    result.goal = p.ending?.title || '这一程已结束';
    result.next = { title: '回看这一程发生的事', description: p.ending?.summary || '查看当前获准的过程记录。', action: { kind: 'recap', label: '打开回看' } };
    result.status = { text: '本局已结束', tone: 'confirmed' };
    return result;
  }
  if (context.unknownCount > 0) {
    result.next = { title: '先确认刚才的动作结果', description: '查询原动作；需要重试时原样重试，不重复提交一份新请求。', action: { kind: 'receipts', label: '查询待确认动作' } };
    result.status = { text: context.online ? `${context.unknownCount} 项动作等待确认` : '连接中断，等待重连后查询', tone: 'uncertain' };
    return result;
  }
  if (!context.online) {
    result.next = { title: '等待连接恢复', description: '已显示的记录仍可阅读；连接恢复前不提交新的世界动作。' };
    result.status = { text: '正在连接或重连房间', tone: 'uncertain' };
    return result;
  }
  if (!context.inputReady || !p.self.canControl) {
    result.next = { title: '先恢复本人控制', description: '使用“恢复本人控制”；若另一处连接仍在控制，可明确接管。' };
    result.status = { text: '当前为只读视角', tone: 'paused' };
    return result;
  }
  if (p.paused) {
    result.next = { title: '等待旅伴恢复控制', description: '现在可以查看队伍与已知记录，场景恢复后继续。', action: { kind: 'chapter', label: '查看队伍' } };
    result.status = { text: '等待同伴，场景已暂停', tone: 'paused' };
    return result;
  }
  if (p.movement?.status === 'blocked') result.status = { text: '路线受阻，请重新选择可走地点', tone: 'paused' };
  else if (p.movement?.status === 'moving' || p.movement?.status === 'accepted') result.status = { text: '正在前往所选地点', tone: 'pending' };
  else if (p.movement?.status === 'arrived') result.status = { text: '已到达，可以查看附近操作', tone: 'confirmed' };

  const consents = chapter ? currentConsents(chapter) : [];
  const ownConsent = consents.find(value => value.subjectRef === p.self.entityRef && ['proposed', 'deferred'].includes(value.status));
  if (ownConsent) {
    result.next = { title: '有一项安排需要由你回应', description: '先查看本次地点与范围，再明确同意、拒绝或暂缓。', action: { kind: 'chapter', label: '查看并回应' } };
    return result;
  }
  if (chapter?.endProposal?.status === 'pending' && !chapter.endProposal.ownConfirmed) {
    result.next = { title: '查看旅伴提出的收尾安排', description: '这项共同选择需要你明确回应，提议本身不会结束旅程。', action: { kind: 'chapter', label: '查看共同选择' } };
    return result;
  }
  const ownRequest = chapter?.personalRequests?.slice().reverse().find(request => request.lifecycle === 'open' && consents.some(consent => consent.consentId === request.consentId && consent.requesterRef === p.self.entityRef && ['proposed', 'deferred', 'declined'].includes(consent.status)));
  if (ownRequest) {
    const consent = consents.find(value => value.consentId === ownRequest.consentId)!;
    result.next = {
      title: consent.status === 'deferred' ? '本人暂缓了这次安排' : consent.status === 'declined' ? '本人拒绝了这次安排' : '等待本人回应这次安排',
      description: ownRequest.reason || '可查看当前请求的范围和状态；没有同意前不执行后续事项。',
      action: { kind: 'chapter', label: '查看本次安排' },
    };
    return result;
  }
  const follow = chapter?.follows.find(value => value.leaderRef === p.self.entityRef && ['proposed', 'accepted', 'following', 'paused', 'arrived'].includes(value.status));
  if (follow) {
    const destination = chapter?.destinations.find(value => value.destinationId === follow.destinationId);
    result.next = follow.status === 'following' && destination
      ? { title: `带路前往${destination.label}`, description: '按约定路线同行；到达后仍须由本人确认安置。', action: { kind: 'navigate', sceneId: destination.sceneId, position: { ...destination.position }, label: `前往${destination.label}` } }
      : { title: follow.status === 'arrived' ? '等待本人确认安置' : follow.status === 'paused' ? '随行已暂停，先查看原因' : follow.status === 'proposed' ? '等待本人回应随行安排' : '查看当前随行安排', description: follow.reason || '地点、带路人和本人许可分别以当前安排为准。', action: { kind: 'chapter', label: '查看随行安排' } };
    return result;
  }
  const returnItem = chapter?.privateReturns?.find(context => p.items.some(item => item.entityRef === context.itemRef && item.location.kind === 'held' && item.location.ownerRef === p.self.entityRef));
  if (returnItem) {
    result.next = { title: '处理你正在持有的私人物件', description: '在行囊逐件查看获准的归还方式；取消安排不会自动归还。', action: { kind: 'inventory', label: '打开行囊' } };
    return result;
  }
  if ((stage === 'safe' || stage === 'compared') && chapter?.publicItems.some(item => item.borrowed && !item.returned)) {
    result.next = { title: '核对公用物的归还安排', description: '队伍记录会显示哪些物件仍待归还；以实际归还结果为准。', action: { kind: 'chapter', label: '查看收尾事项' } };
    return result;
  }
  if (stage === 'compared') {
    result.next = waypoint('C19', '去公开会面点商量收尾', '材料比较不代替双方去留决定；可查看当前会面、归还与离庄安排。')
      || { title: '查看收尾与本人决定', description: '已有比较和会面结果，接下来核对归还、双方去留与实际离庄安排。', action: { kind: 'chapter', label: '查看收尾事项' } };
    return result;
  }
  const contactKnown = p.observations.some(value => value.source?.label === '侧窗本人回应');
  const sealKnown = p.observations.some(value => value.fields.some(field => field.key === 'seal' && field.value === '铜封'));
  const archiveKnown = p.observations.some(value => value.source?.kind === 'archive');
  const witnessKnown = p.observations.some(value => value.source?.kind === 'testimony');
  const comparisonKnown = p.observations.some(value => value.source?.kind === 'comparison');
  if (stage === 'safe' && comparisonKnown) {
    const person = p.entities.find(value => value.availableOperations?.includes('gz-invite-meeting'));
    result.next = person
      ? { title: `与${person.name}商量公开会面`, description: '在手记分享已获得的材料，再向本人提出明确的会面邀请；由本人回应并实际到场。', action: { kind: 'select', reference: person.entityRef, label: `查看${person.name}` } }
      : waypoint('C19', '前往公开会面点，准备交付材料', '已获知现场比较结果；与会面者碰面后，在手记分享材料，再请本人回应会面邀请。')
        || { title: '准备向会面者交付已核对的材料', description: '查看手记中的实际来源和比较记录，走近会面者后再分享。', action: { kind: 'notebook', label: '查看手记' } };
    return result;
  }
  const support = p.cooperations.find(value => value.operationId === 'gz-lock-support');
  if (stage === 'rescue' && support && sealKnown) {
    result.next = support.phase === 'locked'
      ? { title: '支撑已提交，查看接下来的铜封处理', description: '协作完成不等于开门；仍须有相应能力的角色实际行动。可到门外检查当前情况。', action: { kind: 'objects', label: '查看门与协作状态' } }
      : { title: '与旅伴分别就位，固定门撑', description: `当前 ${support.readyCount}/${support.requiredCount} 人就位。打开协作准备，选择一个承力位置，再明确参与准备和就位。`, action: { kind: 'objects', label: '查看协作准备' } };
    return result;
  }
  if (stage === 'rescue' && chapter?.responsibilities.includes('C') && !chapter.responsibilities.includes('A') && !p.items.some(item => item.publicBorrowable && item.location.kind === 'held' && item.location.ownerRef === p.self.entityRef)) {
    const step = waypoint('C14', '到公用工具架查看开门工具', '在工具架选择物件，走近查看并借用；工具与协作准备都需要实际操作。');
    if (step) { result.next = step; return result; }
  }
  const operations = stage === 'safe'
    ? [...(!archiveKnown ? [{ id: 'gz-read-ledger', title: '查看已可阅读的材料' }] : []), ...(!witnessKnown ? [{ id: 'gz-hear-witness', title: '听听见证人的说法' }] : []), ...(archiveKnown && witnessKnown ? [{ id: 'gz-compare-sources', title: '查看可比较的来源' }] : [])]
    : stage === 'open' ? [] : [...(!contactKnown ? [{ id: 'gz-contact', title: '先联系门内的人' }] : []), { id: 'gz-check-seal', title: '查看铜封情况' }];
  for (const operation of operations) {
    const target = [...p.targets, ...p.entities].find(value => value.availableOperations?.some(id => id === operation.id));
    if (target) {
      result.next = { title: operation.title, description: '先打开对象卡片；距离、条件和本人决定仍由实际操作确认。', action: { kind: 'select', reference: target.entityRef, label: `查看${target.name}` } };
      return result;
    }
  }
  const step = stage === 'safe'
      ? !witnessKnown && (chapter?.responsibilities.includes('E') || archiveKnown)
        ? waypoint('R03', '到茶棚向见证人问询', '沿合法出口前往庄外，走近见证人后选择询问；听到的说法会进入手记。')
        : !archiveKnown
          ? waypoint('C15', '到灶房台面查阅旧饭账', '走近账册后选择阅读；材料内容只有实际获得后才会进入你的手记。')
          : waypoint('C19', '到公开会面点核对已有材料', '在对象卡片选择你实际持有的来源，不替任何人作出去留决定。')
      : stage === 'open'
        ? waypoint('C11', '查看客房接应地点，与本人商量安置', '先查看客房门口的接应位置，再从场景对象选择本人商量目的地与带路者；接受后再实际同行。')
        : contactKnown || sealKnown
          ? waypoint('C01', '到门外查看铜封和支撑条件', '选择铜封门检查现状；本人许可、支撑准备和开门分别需要实际完成。')
          : chapter?.responsibilities.includes('D') && !chapter.responsibilities.includes('A')
            ? waypoint('C15', '先到灶房台面查看账册', '你可先查阅材料并与旅伴交流，不能把未读内容写作已知。')
            : chapter?.responsibilities.includes('E') && !chapter.responsibilities.includes('A')
              ? waypoint('R03', '先到茶棚联系见证人', '在地图确认前往，经庄口出口实际到达后再与本人交谈。')
              : waypoint('C04', '先到侧窗联系门内的人', '走到侧窗外，选择联络对象并点击“联系门内的人”，先听取本人的回应。');
  if (step) result.next = step;
  return result;
}
