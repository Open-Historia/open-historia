/*! Open Historia - N034 bounded AI history regressions. AGPL-3.0-or-later. */
import test from "node:test";
import assert from "node:assert/strict";
import { buildCampaignLore } from "../../runtime/campaignLore.js";
import { planCampaignChronicle, generateCampaignChronicle, validateCampaignChronicle, campaignChronicleMarkdown, CHRONICLE_MAX_INPUT_BYTES } from "./campaignChronicle.js";

const fixture=()=>({metadata:{name:"Rome",apiKey:"key-secret"},game:{country:"Rome",gameDate:"-0200-01-01",round:20},
  events:[{id:"early",date:"-0300-01-01",title:"First",description:"Recorded first."},{id:"late",date:"-0200-01-01",title:"Second",description:"Recorded second."},{id:"hidden",audience:["Other"],title:"private-secret"}],
  advisor:[{role:"advisor",text:"advisor-secret"}]});
const answer={sections:[{title:"The record",text:"Recorded developments.",references:["E2","E1","E1"]}]};
test("chronicle uses exactly the native selected record, with stable source references and no excluded material",async()=>{
  const input=fixture(),before=JSON.stringify(input),lore=buildCampaignLore(input),plan=planCampaignChronicle(lore);
  assert.equal(plan.fits,true); assert.doesNotMatch(plan.input,/key-secret|private-secret|advisor-secret/);
  assert.deepEqual(JSON.parse(plan.input).sources.map(s=>s.ref),["C1","E1","E2","S1"]);
  let calls=0,requests=0;
  const signal=new AbortController().signal;
  const result=await generateCampaignChronicle(plan,{signal,onRequest:()=>requests++,call:async(system,history,options)=>{
    calls++; assert.match(system,/untrusted quoted data/); assert.equal(history[0].parts[0].text,plan.input);
    assert.equal(options.taskKey,"campaignChronicle"); assert.equal(options.tool.name,"submit_campaign_chronicle"); assert.equal(options.maxTokens,8192); assert.equal(options.signal,signal);
    options.onRequest(); return {toolInput:answer};
  }});
  assert.equal(calls,1); assert.equal(requests,1);
  assert.deepEqual(result.sections[0].references,["E2","E1"]); assert.equal(result.sections[0].sourceFrom,"-0300-01-01"); assert.equal(result.sections[0].sourceThrough,"-0200-01-01");
  assert.equal(result.referencedCount,2); assert.equal(result.suppliedCount,4);
  assert.match(campaignChronicleMarkdown(result),/AI-generated chronicle/); assert.match(campaignChronicleMarkdown(result),/canonical ID early/);
  assert.equal(JSON.stringify(input),before);
});
test("unknown or absent references and excessive output fail closed",()=>{
  const plan=planCampaignChronicle(buildCampaignLore(fixture()));
  for(const refs of [[],["E999"],[null]])assert.throws(()=>validateCampaignChronicle({sections:[{title:"x",text:"y",references:refs}]},plan),/references/);
  assert.throws(()=>validateCampaignChronicle({sections:[]},plan),/valid chronicle/);
  assert.throws(()=>validateCampaignChronicle({sections:Array.from({length:6},()=>({title:"x",text:"y".repeat(7000),references:["E1"]}))},plan),/output limit/);
});
test("oversize Unicode source is not sliced or sent to a provider",async()=>{
  const input=fixture(); input.events[0].description="語".repeat(CHRONICLE_MAX_INPUT_BYTES);
  const lore=buildCampaignLore(input),plan=planCampaignChronicle(lore);
  assert.equal(plan.fits,false);assert.equal(plan.input,"");assert.equal(lore.events[0].description,input.events[0].description);
  await assert.rejects(generateCampaignChronicle(plan,{call:()=>assert.fail("provider must not be called")}),/too large/);
});
test("native provider cancellation and malformed responses do not produce a chronicle",async()=>{
  const plan=planCampaignChronicle(buildCampaignLore(fixture())),c=new AbortController();
  c.abort(); await assert.rejects(generateCampaignChronicle(plan,{signal:c.signal,call:()=>assert.fail("aborted")}),{name:"AbortError"});
  const d=new AbortController();
  await assert.rejects(generateCampaignChronicle(plan,{signal:d.signal,call:async()=>{d.abort();return {toolInput:answer};}}),{name:"AbortError"});
  await assert.rejects(generateCampaignChronicle(plan,{call:async()=>({toolInput:{sections:[]}})}),/valid chronicle/);
  await assert.rejects(generateCampaignChronicle(plan,{call:async()=>{throw new Error("provider unavailable");}}),/provider unavailable/);
  assert.deepEqual((await generateCampaignChronicle(plan,{call:async()=>JSON.stringify(answer)})).sections[0].references,["E2","E1"]);
});

test("N034 live GLM contract: omitted presentation titles do not discard cited prose",async()=>{
  const plan=planCampaignChronicle(buildCampaignLore(fixture()));
  const raw={sections:[{references:["E1"],text:"Recorded first."},{references:["E2"],text:"Recorded second."}]};
  const result=await generateCampaignChronicle(plan,{call:async(_s,_h,opts)=>{
    assert.deepEqual(opts.tool.schema.properties.sections.items.required,["text","references"]);
    return {toolInput:raw};
  }});
  assert.deepEqual(result.sections.map(s=>s.title),["Section 1","Section 2"]);
  assert.deepEqual(result.sections.map(s=>s.text),raw.sections.map(s=>s.text));
  assert.deepEqual(result.sections.map(s=>s.references),raw.sections.map(s=>s.references));
  assert.equal(validateCampaignChronicle({sections:[{title:"Original",text:"Recorded",references:["E1"]}]},plan).sections[0].title,"Original");
  assert.throws(()=>validateCampaignChronicle({sections:[{text:"Recorded",references:["E999"]}]},plan),/references/);
  assert.throws(()=>validateCampaignChronicle({sections:[{references:["E1"]}]},plan),/section text/);
  assert.throws(()=>validateCampaignChronicle({sections:[{title:42,text:"Recorded",references:["E1"]}]},plan),/section heading/);
  assert.throws(()=>validateCampaignChronicle({sections:[{title:"x".repeat(181),text:"Recorded",references:["E1"]}]},plan),/section heading/);
});
