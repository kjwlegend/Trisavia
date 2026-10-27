import type {GatewayGuide} from './agent-gateway.ts';
import {approvedWorldGuide} from './agent-approved-current-guides.ts';
import {placeProfileGuideSection} from './agent-gateway-place-profiles.ts';

/** New current exact guide only; published World24 and earlier remain unchanged. */
export const placeProfileWorldGuide:GatewayGuide={...approvedWorldGuide,version:25,document:{...approvedWorldGuide.document,version:25,placeProfiles:structuredClone(placeProfileGuideSection)}};
