/** Append only after the real friendships@3 consent source and life_assets@3 participants exist. */
export const LIFE_C_GIFT_SOURCE_MIGRATION={moduleId:'life_assets',version:4,name:'c_gift_effects_and_reservations_require_real_consent_sources',dependencies:['life_assets','friendships'],sql:`
ALTER TABLE life_assets.c_gift_reservations ADD CONSTRAINT c_gift_reservations_gift_source_fk
 FOREIGN KEY(gift_id) REFERENCES relationships.gifts(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE life_assets.effects ADD COLUMN c_gift_id text GENERATED ALWAYS AS(CASE WHEN kind IN ('c.gift.reserve','c.gift.settle') THEN source_id END) STORED;
ALTER TABLE life_assets.effects ADD CONSTRAINT effects_c_gift_source_fk
 FOREIGN KEY(c_gift_id) REFERENCES relationships.gifts(id) DEFERRABLE INITIALLY DEFERRED;
`};
