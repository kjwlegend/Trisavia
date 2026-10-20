import { fail, version } from '../common/errors.ts';
import type { ArtifactRef, FeedbackActivity, FeedbackConfiguration, InteractionInvitation, InteractionPairPolicy } from './types.ts';

/** Counts the exact stored Unicode code points; no truncation or normalization. */
export function plainText(value: unknown, field: string, maximum: number, required = true): string {
  if (typeof value !== 'string' || [...value].length > maximum || required && !/\S/u.test(value)
    || /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail('invalid_request', 400, 'Invalid plain-text field', { field });
  return value;
}
export function identifier(value: unknown, field = 'id'): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) fail('invalid_request', 400, 'Invalid identifier', { field }); return value;
}
export function artifactReference(input: unknown): ArtifactRef {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['artifactId', 'revision'].includes(key))) fail('invalid_request', 400, 'Invalid artifact reference');
  const ref = input as Record<string, unknown>; return { artifactId: identifier(ref.artifactId, 'artifactId'), revision: version(ref.revision, 'revision') };
}
export function pairIds(a: string, b: string): [string, string] { return a < b ? [a, b] : [b, a]; }
export function assertConfiguration(config: FeedbackConfiguration): void {
  if (config.templateId !== 'text_feedback') fail('invalid_request', 400, 'Unsupported activity template');
  for (const [key, value] of Object.entries(config)) if (key !== 'templateId') version(value, key);
  if (config.invitationSeconds > 31_536_000 || config.feedbackSeconds > 31_536_000 || config.acknowledgementSeconds > 31_536_000) fail('invalid_request', 400, 'Unsupported activity window');
}
export function deadlineAt(now: number, seconds: number): number {
  const result = now + seconds * 1000; if (!Number.isSafeInteger(result)) fail('invalid_request', 400, 'Unsupported UTC deadline'); return result;
}
export function invitationExpired(invitation: InteractionInvitation, now: number): boolean { return invitation.state === 'pending' && now >= invitation.deadline; }
export function activityExpired(activity: FeedbackActivity, now: number): boolean {
  return activity.state === 'waiting_feedback' && now >= activity.feedbackDeadline
    || activity.state === 'waiting_ack' && activity.acknowledgementDeadline !== null && now >= activity.acknowledgementDeadline;
}
export function sharedAccess(invitation: InteractionInvitation, policy: InteractionPairPolicy | undefined): boolean {
  return !policy ? invitation.sharedGeneration === 0 : !policy.blockedByAgentIds.length && invitation.sharedGeneration === policy.sharedGeneration;
}
