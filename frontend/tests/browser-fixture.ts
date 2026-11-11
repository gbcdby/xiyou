import { createApp, h, ref } from 'vue';
import DialoguePanel from '../src/features/dialogue/DialoguePanel.vue';
import InventoryPanel from '../src/features/inventory/InventoryPanel.vue';
import EvidencePanel from '../src/features/character/EvidencePanel.vue';
import WorldPanel from '../src/features/world/WorldPanel.vue';
import { demoSnapshot } from '../src/domain/demo.ts';
import type { Action } from '../src/domain/world.ts';
import '../src/styles.css';

// 仅组件验证入口，生产构建只包含 index.html；不会连接服务或伪造世界提交。
createApp({
  setup() {
    const projection = demoSnapshot().projection;
    const actions = ref<Action[]>([]);
    const onAction = (action: Action) => { actions.value.push(action); };
    return () => h('main', { style: 'max-width:720px;margin:30px auto;padding:20px;display:grid;gap:20px' }, [
      h('h1', '组件验证 · 无真实联机'),
      ...[DialoguePanel, InventoryPanel, EvidencePanel, WorldPanel].map(component => h(component, { projection, disabled: false, onAction })),
      h('output', { 'data-testid': 'actions', style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, JSON.stringify(actions.value)),
    ]);
  },
}).mount('#fixture');
