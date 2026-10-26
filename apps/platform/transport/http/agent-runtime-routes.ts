import type {FastifyInstance} from 'fastify';
import type {AgentRuntimeGuideProvider} from '../../application/agent-runtime-guide.ts';
import {currentAgentRuntime} from '../../application/agent-runtime-publication.ts';
import {M1Error,object} from '../../domains/common/errors.ts';
/** Same-origin plain public instructions only. Never authenticates or changes a host job. */
export function registerAgentRuntimeRoute(app:FastifyInstance,provider:AgentRuntimeGuideProvider,instanceId:string){app.get('/agent/runtime.md',async(request,reply)=>{reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('X-Instance-Id',instanceId).header('Referrer-Policy','no-referrer');try{object(request.query,[]);const s=await currentAgentRuntime(provider);return reply.type('text/plain; charset=utf-8').header('X-Agent-Runtime-Version',String(s.ruleVersion)).header('X-Agent-Runtime-Digest',s.digest).send(s.text);}catch(e){const error=e instanceof M1Error?e:new M1Error('runtime_rules_unavailable',503,'Runtime rules are unavailable');return reply.code(error.statusCode).send({error:{code:error.code,message:error.message}});}});}
