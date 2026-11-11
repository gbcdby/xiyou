import { readFile } from 'node:fs/promises';
import { parseProposedIntent, intentSemanticDigestSync, validateContract } from '../../protocol/node.mjs';

let outputs = 0; let events = 0; let receipts = 0;
for (const name of ['network', 'orchestrator', 'crash']) {
  const data = JSON.parse(await readFile(`backend/evidence/ai/captures/${name}.json`, 'utf8'));
  for (const run of data.runs) {
    validateContract('DecisionRecord', run.decision);
    if (run.semantic_digest) {
      const actual = intentSemanticDigestSync(parseProposedIntent(run.output_raw, run.decision_id));
      if (actual !== run.semantic_digest) throw new Error('归档原文摘要不匹配。');
      outputs++;
    }
    for (const receipt of [run.outcome?.receipt, run.outcome?.fallback].filter(Boolean)) { validateContract('ClientReceipt', receipt); receipts++; }
  }
  for (const event of data.events) { validateContract('WorldEvent', event); events++; }
}
console.log(JSON.stringify({ status: 'PASS', 原文摘要: outputs, 事件: events, 收据: receipts }));
