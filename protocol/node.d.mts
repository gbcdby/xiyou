// 本文件由 protocol/scripts/generate.mjs 从 schema.mjs 生成，请修改唯一字段源后重新生成。
export * from './index.mjs';
import type { ClientAction, ProposedIntent } from '../game/types.js';
export function actionSemanticDigestSync(value: ClientAction): string;
export function intentSemanticDigestSync(value: ProposedIntent): string;
