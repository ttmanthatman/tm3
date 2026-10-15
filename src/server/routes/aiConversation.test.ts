import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { DEFAULT_AI_CONVERSATION } from "../../shared/aiConversation.js";
import { registerAiConversationRoutes } from "./aiConversation.js";

function harness() {
  const settings = new Map<string,string>();
  const sent: string[] = [];
  const config = { ...DEFAULT_AI_CONVERSATION, enabled:true, characterIds:[1,2], maxMessages:1 };
  const app = Fastify();
  app.setErrorHandler((error,_request,reply)=>reply.code(error instanceof z.ZodError ? 400 : 500).send({message:"invalid"}));
  const prisma = {
    account: {findUnique: async ({where}:{where:{id:number}})=>({role:where.id===2 ? "admin":"member",isGuest:where.id===5})},
    channelMember: {findUnique: async ({where}:{where:{channelId_accountId:{accountId:number}}})=>({role:[1,5].includes(where.channelId_accountId.accountId) ? "owner" : where.channelId_accountId.accountId===4 ? "admin":"member"})},
    channel: {findUnique: async ()=>({id:7,kind:"standard",isPrivate:true,isDefault:false,directKey:null})},
    virtualCharacter: {findMany: async ()=>[1,2,3].map((id)=>({id,actorId:id,enabled:true,config:{invitedChannels:id===3 ? []:[7]},actor:{username:`bot${id}`,displayName:`角色${id}`,status:"active"}}))},
    message: {findMany: async ()=>[]},
    setting: {
      findUnique: async ({where}:{where:{key:string}})=>settings.has(where.key) ? {value:settings.get(where.key)}:null,
      upsert: async ({where,update}:{where:{key:string};update:{value:string}})=>{settings.set(where.key,update.value);}
    }
  } as unknown as PrismaClient;
  const controller = registerAiConversationRoutes(app, {
    prisma, requireAuth: async (request,reply)=>{if(!request.headers.authorization) return reply.code(401).send({message:"login"}); Object.assign(request,{auth:{accountId:Number(request.headers.authorization)}});},
    canAccessChannel: async (id)=>id !== 99,
    loadAiSettings: async ()=>({value:{enabled:true,baseUrl:"https://api.deepseek.com",model:"test"},encryptedApiKey:"fake"}),
    decryptAiApiKey: ()=>"fake",
    io: {} as never, log: ()=>{},
    createMessageFromActor: async ({content})=>{sent.push(content);return {id:sent.length};}
  });
  const send = (account:number,action:string,bodyConfig:unknown=config)=>app.inject({method:"POST",url:"/api/channels/7/ai-conversation",headers:{authorization:String(account)},payload:{action,...(bodyConfig ? {config:bodyConfig}:{})}});
  return {app,config,settings,controller,sent,send};
}
test("AI channel reads and controls enforce authentication, membership and owner authority", async ()=>{
  const {app,send} = harness();
  try {
    assert.equal((await app.inject({url:"/api/channels/7/ai-conversation"})).statusCode,401);
    assert.equal((await app.inject({url:"/api/channels/7/ai-conversation",headers:{authorization:"99"}})).statusCode,403);
    for(const id of [3,4,5]) assert.equal((await send(id,"save")).statusCode,403);
    for(const id of [1,2]) assert.equal((await send(id,"save")).statusCode,200);
    const snapshot = (await app.inject({url:"/api/channels/7/ai-conversation",headers:{authorization:"3"}})).json();
    assert.equal(snapshot.canControl,false); assert.deepEqual(snapshot.characters.map((row:{id:number})=>row.id),[1,2]);
  } finally {await app.close();}
});
test("configuration validates roles and budgets before persistence", async ()=>{
  const {app,send,config,settings} = harness();
  try {
    for(const patch of [{characterIds:[1,3]},{characterIds:[1,1]},{characterIds:[1]},{maxMessages:0},{maxDurationSeconds:0},{maxContextChars:0},{contextMessages:101},{intervalSeconds:0}]) {
      assert.equal((await send(1,"save",{...config,...patch})).statusCode,400);
      assert.equal(settings.size,0);
    }
    assert.equal((await send(1,"start",{...config,enabled:false})).statusCode,400);
    assert.equal((await send(1,"save")).statusCode,200);
    const snapshot = (await app.inject({url:"/api/channels/7/ai-conversation",headers:{authorization:"1"}})).json();
    assert.deepEqual(snapshot.config,config); assert.equal(snapshot.status.state,"idle");
  } finally {await app.close();}
});
test("start invokes the selected roles autonomously and rejects duplicate starts or active edits", async ()=>{
  const {app,send,controller,sent} = harness(); const original = globalThis.fetch;
  let release: (()=>void)|undefined;
  globalThis.fetch = async (_url,options)=>new Promise<Response>((resolve,reject)=>{
    release=()=>resolve(new Response(JSON.stringify({choices:[{message:{content:"自动发言"}}]}),{status:200}));
    options?.signal?.addEventListener("abort",()=>reject(new Error("aborted")),{once:true});
  });
  try {
    assert.equal((await send(1,"start")).statusCode,200);
    assert.equal((await send(1,"start")).statusCode,409);
    assert.equal((await send(1,"save")).statusCode,409);
    for(let i=0;i<50&&!release;i++) await new Promise((resolve)=>setTimeout(resolve,2));
    assert.ok(release); release();
    for(let i=0;i<50&&controller.status(7).state!=="completed";i++) await new Promise((resolve)=>setTimeout(resolve,2));
    assert.deepEqual(sent,["自动发言"]); assert.equal(controller.status(7).messages,1);
    assert.equal((await send(1,"stop",null)).statusCode,200);
  } finally {await app.close();globalThis.fetch=original;}
});
