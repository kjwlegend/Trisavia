import {accountMessage} from '../owner-i18n.js';
// Presentation labels are selected by the existing finite identity, never by
// matching or rewriting catalog text. Original art metadata remains unchanged.
const looks=Object.freeze({
 'sunnyside-human-shorthair':'avatar.look.sunnyside-human-shorthair',
 'sunnyside-human-longhair':'avatar.look.sunnyside-human-longhair',
 'sunnyside-human-curlyhair':'avatar.look.sunnyside-human-curlyhair',
 'sunnyside-human-bowlhair':'avatar.look.sunnyside-human-bowlhair',
 'sunnyside-human-mophair':'avatar.look.sunnyside-human-mophair',
 'sunnyside-human-spikeyhair':'avatar.look.sunnyside-human-spikeyhair',
});
const colors=Object.freeze({hair:Object.freeze({original:'avatar.color.hair.original',chestnut:'avatar.color.hair.chestnut',ink:'avatar.color.hair.ink',ash:'avatar.color.hair.ash',blue:'avatar.color.hair.blue'}),clothing:Object.freeze({original:'avatar.color.clothing.original',forest:'avatar.color.clothing.forest',clay:'avatar.color.clothing.clay',cream:'avatar.color.clothing.cream'})});
export function appearanceLookLabel(look){const key=looks[look?.key];return key?accountMessage(key):look?.label||'';}
export function appearanceColorLabel(kind,option){const key=colors[kind]?.[option?.id];return key?accountMessage(key):option?.displayName||'';}
