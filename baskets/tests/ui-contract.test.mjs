import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const html=read("../index.html");
const app=read("../app.js");
const desk=read("../desk-ui.js");
const build=read("../../scripts/build-site.mjs");
const sw=read("../../sw.js");
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
const known=new Set(ids);
const dynamicIds=new Set([...desk.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
test("every static element referenced by both Baskets controllers exists",()=>{
 const references=[...app.matchAll(/\$\("([^"]+)"\)/g),...desk.matchAll(/\$\("([^"]+)"\)/g)]
   .map(m=>m[1]);
 for(const id of references)assert.ok(known.has(id)||dynamicIds.has(id),
   "Missing static or dynamically created HTML element #"+id);
 assert.ok(references.length>45);
});
test("new UI elements have unique IDs, status buttons and human review actions",()=>{
 assert.equal(ids.length,known.size,"Duplicated HTML IDs");
 for(const name of ["deskView","signalsView","analysisView","signalPrompt",
  "deskCallList","callTeammate","teammateReply","applyTeammateReply",
  "signalHistory","signalInspector","alertTicks","enableDesktopAlerts",
  "reviewSignalNow","deferSignal","undoTeammateStatus"])
   assert.ok(known.has(name),"Missing workflow UI #"+name);
 assert.match(html,/data-workflow-tab="desk"/);
 assert.match(html,/data-workflow-tab="analysis"/);
 assert.match(html,/data-workflow-tab="signals"/);
 assert.match(html,/Copy instruction \+ queue call/);
 assert.match(html,/Review and classify/);
});
test("build and offline cache include both workflow modules",()=>{
 for(const file of ["desk-ui.js","desk-engine.js"]){
   assert.ok(build.includes('"baskets/'+file+'"'),"Build omits "+file);
   assert.ok(sw.includes('"./baskets/'+file+'"'),"Service worker omits "+file);
 }
});
test("the status interface cannot submit actual exchange requests",()=>{
 assert.ok(!desk.includes("fetch("),"Execution desk must not access the exchange");
 assert.ok(!desk.includes("XMLHttpRequest"),"Execution desk must not access the exchange");
 assert.match(desk,/navigator\.clipboard/);
 assert.match(desk,/classifyPriceAlert/);
});
