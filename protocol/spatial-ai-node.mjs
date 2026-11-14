import { createHash } from 'node:crypto';
import { canonicalSpatialIntentPayload } from './spatial-ai.mjs';
export * from './spatial-ai.mjs';
export const spatialIntentSemanticDigestSync = value => createHash('sha256').update(canonicalSpatialIntentPayload(value), 'utf8').digest('hex');
