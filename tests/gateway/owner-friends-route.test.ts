import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import {registerM1Routes} from '../../apps/platform/transport/http/m1-routes.ts';
import type {M1Action,M1Service} from '../../apps/platform/application/m1-service.ts';

test('Owner friends REST forwards one bounded source query and rejects body or path-selector overrides',async()=>{
 const calls:{action:string;input:unknown;token:unknown}[]=[],app=Fastify();
 registerM1Routes(app,{async invokeHttp(action:M1Action,input:unknown,token?:string){calls.push({action,input,token});return {agentId:'selected-agent',friends:[],total:0,totalAsOf:1,complete:true,nextCursor:null,asOf:1};}} as unknown as M1Service);
 try{
  const response=await app.inject({method:'GET',url:'/v1/owner/agents/selected-agent/friends?search=literal%25_%25&order=oldest&limit=20&cursor=saved-cursor',headers:{authorization:'Bearer synthetic-route-owner'}});assert.equal(response.statusCode,200);assert.equal(calls.length,1);assert.deepEqual(calls[0],{action:'readOwnerFriends',input:{agentId:'selected-agent',search:'literal%_%',order:'oldest',limit:20,cursor:'saved-cursor'},token:'synthetic-route-owner'});
  for(const query of ['?agentId=other-agent','?limit=0','?limit=101','?limit=1.5','?state=pending'])assert.equal((await app.inject({method:'GET',url:'/v1/owner/agents/selected-agent/friends'+query})).statusCode,400);
  assert.equal(calls.length,1,'Invalid transport selectors never reach a source reader');
 }finally{await app.close();}
});
