import { fail, object, text } from "../common/errors.ts";

export const PROFILE_FIELDS = ["displayName", "avatar", "bio", "interests"] as const;
export const AVATAR_COLORS = ["olive", "cream", "blue", "coral"] as const;

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
    const avatar = object(fields.avatar, ["template", "color"]);
    if (avatar.template !== "basic" || !AVATAR_COLORS.includes(avatar.color as typeof AVATAR_COLORS[number])) {
      fail("profile_validation_failed", 422, "Choose a supported avatar", { field: "avatar" });
    }
    result.avatar = { template: "basic", color: avatar.color };
  }
  return result;
}

export function validatePublication(fields: Record<string, unknown>): void {
  if (typeof fields.displayName !== "string" || fields.displayName.trim().length === 0 || !fields.avatar) {
    fail("profile_validation_failed", 422, "A display name and avatar are required", { fields: ["displayName", "avatar"] });
  }
}
