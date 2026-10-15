import test from "node:test";
import assert from "node:assert/strict";
import { createAiClient } from "./ai.js";
import { AI_PROVIDERS, type AiProvider } from "../../shared/aiProviders.js";
test("LLM calls route each role to its provider key, model and thinking parameters", async ()=>{
  const original = globalThis.fetch;
  const calls: {url:string;body:Record<string,unknown>;key:string|null}[]=[];
  globalThis.fetch = async (url,init)=>{calls.push({url:String(url),body:JSON.parse(String(init?.body)),key:new Headers(init?.headers).get("authorization") || new Headers(init?.headers).get("api-key")});return new Response(JSON.stringify({choices:[{message:{content:"ok"}}]}));};
  const client = createAiClient({
    loadAiSettings: async ()=>({value:{enabled:false,baseUrl:AI_PROVIDERS.deepseek.baseUrl,model:AI_PROVIDERS.deepseek.model,provider:"deepseek",providers:(Object.keys(AI_PROVIDERS) as AiProvider[]).map((provider)=>({provider,...AI_PROVIDERS[provider],apiKeyConfigured:true}))},encryptedApiKey:"deepseek-key",providerKeys:{deepseek:"deepseek-key",bailian:"bailian-key",mimo:"mimo-key",volcengine:"volcengine-key"}}),
    decryptAiApiKey:(value)=>value
  });
  try {
    for(const provider of Object.keys(AI_PROVIDERS) as AiProvider[]) await client.callLlm([{role:"user",content:"hello"}],{provider});
    for(const [index,provider] of (Object.keys(AI_PROVIDERS) as AiProvider[]).entries()) {
      assert.equal(calls[index].url,`${AI_PROVIDERS[provider].baseUrl}/chat/completions`);
      assert.equal(calls[index].key,provider === "mimo" ? "mimo-key" : `Bearer ${provider}-key`); assert.equal(calls[index].body.model,AI_PROVIDERS[provider].model);
    }
    assert.equal(calls[1].body.enable_thinking,false); assert.equal("thinking" in calls[3].body,false);
  } finally {globalThis.fetch=original;}
});
