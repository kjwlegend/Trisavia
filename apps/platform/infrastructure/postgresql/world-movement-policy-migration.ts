/** Only legal legacy/current policy pairs; no stored movement, time or receipt is rewritten. */
export const WORLD_MOVEMENT_POLICY_MIGRATION={moduleId:'world',version:6,name:'compatible_current_movement_policy',dependencies:['world'],sql:`
ALTER TABLE world.movements DROP CONSTRAINT movements_policy_version_check, DROP CONSTRAINT movements_step_interval_ms_check;
ALTER TABLE world.movements ADD CONSTRAINT movements_supported_policy CHECK((policy_version=1 AND step_interval_ms=1000) OR (policy_version=2 AND step_interval_ms=500));
`};
