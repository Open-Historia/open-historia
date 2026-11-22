import test from "node:test";
import assert from "node:assert/strict";
import {normalizeFinanceDraft,reviewRecordedLoan} from "./projectFinanceReview.js";
const event={date:"1912-02-09",title:"Signed loan",description:"France signed a loan for 140 million lev at 4% interest, with maturity in 24 months. The first disbursement tranche was wired to Krupp."};
test("read-only AI review extracts recorded terms; missing tranche and independently assessed equivalent remain absent",async()=>{
 const result=await reviewRecordedLoan(event,{call:async(system,history,opts)=>{
   assert.match(system,/Never estimate an unstated tranche/);
   assert.equal(opts.taskKey,"projectFinanceReview");
   assert.deepEqual(JSON.parse(history[0].parts[0].text),event);
   return {toolInput:{lender:"France",currency:"lev",originalLimit:"140000000",annualRate:"4",maturityMonths:"24",supplier:"Krupp",evidence:"France signed a loan for 140 million lev at 4% interest",limit:"999999999"}};
 }});
 assert.equal(result.originalDraw,"");
 assert.equal(result.originalLimit,"140000000");assert.equal(result.maturity,"1914-02-09");
 assert.equal(result.limit,undefined);
 assert.throws(()=>normalizeFinanceDraft({evidence:"invented quotation"},event),/quote the selected source/);
 assert.equal(normalizeFinanceDraft({evidence:"",originalDraw:"70000000"},event).originalDraw,"");
});
test("cancelled and oversized finance review never sends a request",async()=>{
 const abort=new AbortController();abort.abort();
 await assert.rejects(reviewRecordedLoan(event,{signal:abort.signal,call:()=>assert.fail("provider called")}),{name:"AbortError"});
 await assert.rejects(reviewRecordedLoan({...event,description:"x".repeat(40000)},{call:()=>assert.fail("provider called")}),/too large/);
});
