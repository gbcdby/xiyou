import { createHash } from 'node:crypto';
import { canonicalActionPayload, canonicalIntentPayload } from './index.mjs';
export * from './index.mjs';
export const actionSemanticDigestSync = value => createHash('sha256').update(canonicalActionPayload(value), 'utf8').digest('hex');
export const intentSemanticDigestSync = value => createHash('sha256').update(canonicalIntentPayload(value), 'utf8').digest('hex');
