import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import {coreFixture} from '../world/runtime-fixture.ts';
import {createAgentGateway} from '../../apps/platform/application/agent-gateway.ts';
import {registerAgentGatewayRoutes} from '../../apps/platform/transport/http/agent-gateway-routes.ts';
import {object} from '../../apps/platform/domains/common/errors.ts';
import type {JsonObject} from '../../apps/platform/contracts/store.ts';
const schema:JsonObject={type:'object',additionalProperties:false,required:['topic'],properties:{topic:{type:'string',minLength:1}}};
function registry(schemaVersion=2,guideVersion=2){const f=coreFixture();return createAgentGateway({store:f.store,identity:f.identity,operations:[{id:'research.echo',moduleId:'research',schemaVersion,kind:'query',actors:['agent'],description:'Synthetic versioned module.',input:schema,output:schema,query:async(_ctx,_p,input)=>input}],publicReads:[{id:'research.public_report',moduleId:'research',schemaVersion:3,path:'/v1/research/report',description:'Module-specific public query.',input:schema,output:schema,read:async(_ctx,input)=>input}],guides:[{moduleId:'research',version:guideVersion,document:{moduleId:'research',version:guideVersion}}]});}
test('protocol one publishes the registered schema/guide versions and explicitly rejects unavailable old versions',async()=>{
 const gateway=registry(),app=Fastify({ajv:{customOptions:{coerceTypes:false,removeAdditional:false,useDefaults:false}}});registerAgentGatewayRoutes(app,gateway,{instanceId:'version-test',now:()=>1000});
 try{
  const discovery=gateway.discovery();assert.equal(discovery.protocolVersion,1);assert.equal(discovery.operations[0]!.inputSchema.version,2);assert.equal(discovery.operations[0]!.usageGuide.version,2);assert.equal(discovery.operations[1]!.inputSchema.version,3);assert.notEqual(gateway.catalogRevision,registry(3,3).catalogRevision);
  const current=await app.inject({method:'GET',url:discovery.operations[0]!.inputSchema.path});assert.equal(current.statusCode,200);const doc=current.json().data;assert.equal(doc.version,2);assert.equal(doc.document.$id,'gateway.research.echo.input@2');assert.equal(createHash('sha256').update(doc.canonicalDocument).digest('hex'),doc.digest);
  assert.equal((await app.inject({method:'GET',url:'/v1/gateway/guides/research?version=2'})).statusCode,200);
  for(const [path,code]of [['/v1/gateway/schemas/research.echo.input?version=1','schema_version_not_available'],['/v1/gateway/guides/research?version=1','guide_version_not_available']]){const old=await app.inject({method:'GET',url:path!});assert.equal(old.statusCode,404);assert.equal(old.json().error.code,code);assert.match(old.json().error.message,/rediscover/);}
  assert.equal((await app.inject({method:'GET',url:'/v1/gateway/schemas/research.echo.input'})).statusCode,400);
 }finally{await app.close();}
});
test('generic transport accepts another module registration without decoding World paths or parameters',async()=>{
 const gateway=registry(),app=Fastify({ajv:{customOptions:{coerceTypes:false,removeAdditional:false,useDefaults:false}}}),http=registerAgentGatewayRoutes(app,gateway,{instanceId:'module-test',now:()=>1000});
 http.route('GET','/v1/research/report',request=>gateway.publicRead('research.public_report',object(request.query,['topic']),http.validate(request)));
 try{const report=await app.inject({method:'GET',url:'/v1/research/report?topic=visible'});assert.equal(report.statusCode,200);assert.deepEqual(report.json().data,{topic:'visible'});assert.equal((await app.inject({method:'GET',url:'/v1/research/report?worldId=default&limit=1'})).statusCode,400);assert.equal((await app.inject({method:'GET',url:'/v1/world/scene?worldId=default'})).statusCode,404);}finally{await app.close();}
});
