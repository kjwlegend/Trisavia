/** Independent append: the already-fixed source/effect migration remains byte-identical. */
export const LIFE_COMMERCE_READ_MIGRATION={moduleId:'life_assets',version:2,name:'available_items_actor_capture_order',dependencies:['life_assets'],sql:`
CREATE INDEX life_asset_available_order ON life_assets.instances(actor_kind,actor_id,issued_at,id COLLATE "C") WHERE state='available';
`};
