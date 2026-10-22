/** Forward only: no rule/Avatar/movement row is rewritten by this migration. */
export const WORLD_TOPOLOGY_MIGRATION={moduleId:'world',version:4,name:'signed_bounded_town_topology_and_committed_motion',dependencies:['world'],sql:`
ALTER TABLE world.rulesets ADD COLUMN min_x integer NOT NULL DEFAULT 0, ADD COLUMN min_y integer NOT NULL DEFAULT 0,
 ADD COLUMN map_manifest jsonb CHECK(jsonb_typeof(map_manifest)='object' AND octet_length(map_manifest::text)<=65536);
ALTER TABLE world.blocked_cells ADD COLUMN cell_kind text NOT NULL DEFAULT 'physical' CHECK(cell_kind IN ('physical','unopened'));
ALTER TABLE world.avatars ADD COLUMN motion jsonb CHECK(jsonb_typeof(motion)='object' AND octet_length(motion::text)<=4096);
ALTER TABLE world.rulesets DROP CONSTRAINT rulesets_spawn_x_check,DROP CONSTRAINT rulesets_spawn_y_check,DROP CONSTRAINT rulesets_check;
ALTER TABLE world.rulesets ADD CONSTRAINT rulesets_signed_bounds CHECK(min_x BETWEEN -100000 AND 100000 AND min_y BETWEEN -100000 AND 100000 AND min_x+width-1 BETWEEN -100000 AND 100000 AND min_y+height-1 BETWEEN -100000 AND 100000 AND width::bigint*height<=16384 AND spawn_x>=min_x AND spawn_x<min_x+width AND spawn_y>=min_y AND spawn_y<min_y+height);
${[['blocked_cells','x'],['blocked_cells','y'],['places','bound_left'],['places','bound_top'],['avatars','x'],['avatars','y'],['movements','origin_x'],['movements','origin_y'],['movement_steps','x'],['movement_steps','y']].map(([table,column])=>`ALTER TABLE world.${table} DROP CONSTRAINT ${table}_${column}_check; ALTER TABLE world.${table} ADD CONSTRAINT ${table}_${column}_check CHECK(${column} BETWEEN -100000 AND 100000);`).join('\n')}
ALTER TABLE world.places ADD CONSTRAINT places_signed_right_bottom CHECK(bound_right BETWEEN -100000 AND 100000 AND bound_bottom BETWEEN -100000 AND 100000);
`};
