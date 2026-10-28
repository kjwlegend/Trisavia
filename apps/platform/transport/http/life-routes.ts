import type {AgentGateway} from '../../application/agent-gateway.ts';
import type {GatewayHttpTransport} from './agent-gateway-routes.ts';
import type {JsonObject} from '../../contracts/store.ts';
import {M1Error,object} from '../../domains/common/errors.ts';
export function registerLifeObservationRoutes(gateway:AgentGateway,http:GatewayHttpTransport,revision=1){http.route('GET','/v1/world/life/actions',request=>{object(request.query,[]);return gateway.publicRead('life.public_actions',{},http.validate(request));});if(revision>=2)http.route('GET','/v1/world/life/shop/quote',request=>gateway.publicRead('life.public_quote',object(request.query,['side','itemId']),http.validate(request)));if(revision===3)http.route('GET','/v1/world/life/books',request=>{const input=object(request.query,['bookId','bookVersion']);return gateway.publicRead('life.public_book',{bookId:input.bookId!,bookVersion:input.bookVersion==='1'?1:input.bookVersion!},http.validate(request));});}

/** No locale selector, new capability or anonymous handbook path is introduced. */
export function registerHumanBookRoutes(gateway:AgentGateway,http:GatewayHttpTransport){
 const human=(envelope:JsonObject):JsonObject=>{const data=envelope.data as JsonObject,result:JsonObject={schema:'human-book',version:1,original:{...envelope,data:data.originalData!},presentation:data.presentation!};if(Buffer.byteLength(JSON.stringify(result),'utf8')>128*1024)throw new M1Error('source_unavailable',503,'The human book response exceeds its bounded representation');return result;};
 http.route('GET','/v1/human/life/books',request=>{const input=object(request.query,['bookId','bookVersion']);return gateway.humanBookRead('public',{bookId:input.bookId!,bookVersion:input.bookVersion==='1'?1:input.bookVersion!},http.validate(request));},human);
 http.route('POST','/v1/human/life/books',request=>{const header=request.headers.authorization;if(typeof header!=='string'||!header.startsWith('Bearer '))throw new M1Error('authentication_failed',401,'Bearer authentication is required');return gateway.humanBookRead('authenticated',request.body,http.validate(request),header.slice(7));},human);
}
