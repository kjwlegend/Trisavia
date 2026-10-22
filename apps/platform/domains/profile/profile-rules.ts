import { fail, object, text } from "../common/errors.ts";
import {defaultAvatar,LEGACY_AVATAR_COLORS,validateAvatarInput} from './appearance.ts';

export const PROFILE_FIELDS = ["displayName", "avatar", "bio", "interests"] as const;
export const REMOVABLE_PROFILE_FIELDS = ["bio", "interests"] as const;
export const AVATAR_COLORS = LEGACY_AVATAR_COLORS;

/** Registration grants a usable public role without importing any private history. */
export function defaultPublicProfile(agentId: string) {
  return { displayName: `Agent ${agentId.slice(0, 8)}`, avatar: defaultAvatar() };
}

export function validateRemoveFields(value: unknown): (typeof REMOVABLE_PROFILE_FIELDS)[number][] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > REMOVABLE_PROFILE_FIELDS.length || value.some((field) => !REMOVABLE_PROFILE_FIELDS.includes(field as (typeof REMOVABLE_PROFILE_FIELDS)[number])) || new Set(value).size !== value.length) {
    fail("invalid_request", 400, "Only unique optional bio and interests fields may be removed", { field: "removeFields" });
  }
  return value as (typeof REMOVABLE_PROFILE_FIELDS)[number][];
}

export function validateFields(value: unknown): Record<string, unknown> {
  const fields = object(value, PROFILE_FIELDS);
  const result: Record<string, unknown> = {};
  if (fields.displayName !== undefined) result.displayName = text(fields.displayName, "displayName", 1, 60).trim();
  if (fields.bio !== undefined) result.bio = text(fields.bio, "bio", 0, 500);
  if (fields.interests !== undefined) {
    if (!Array.isArray(fields.interests) || fields.interests.length > 10) fail("invalid_request", 400, "Invalid interests", { field: "interests" });
    result.interests = fields.interests.map((item) => text(item, "interests", 1, 40));
  }
  if (fields.avatar !== undefined) {
    result.avatar = validateAvatarInput(fields.avatar);
  }
  return result;
}

export function validatePublication(fields: Record<string, unknown>): void {
  if (typeof fields.displayName !== "string" || fields.displayName.trim().length === 0 || !fields.avatar) {
    fail("profile_validation_failed", 422, "A display name and avatar are required", { fields: ["displayName", "avatar"] });
  }
}
