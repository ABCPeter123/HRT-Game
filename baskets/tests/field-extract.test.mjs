import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {performance} from "node:perf_hooks";
const script=readFileSync(new URL("../bridge/extension/field-extract.js",import.meta.url),"utf8");
const capture=readFileSync(new URL("../bridge/extension/capture.js",import.meta.url),"utf8");
function setup(){
 const context={};
 vm.runInNewContext(script,context);
 return context.__BasketsFieldExtractor;
}
function element(text,{attribute={},visible=true,value,hidden=false}={}){
 const node={
   innerText:text,textContent:text,
   getAttribute:key=>attribute[key]??null,
   getClientRects:()=>visible?[{}]:[],
   closest:selector=>hidden?{}:null
 };
 if(value!==undefined)node.value=value;
 return node;
}
function doc(mapping){
 return {querySelectorAll(selector){
   if(selector==="invalid[")throw new Error("Invalid CSS");
   return mapping[selector]||[];
 }};
}
test("parser extracts currency, thousands separators, negatives and decimals",()=>{
 const {tokens}=setup();
 assert.deepEqual(Array.from(tokens("Bid: $1,399.50, Ask: $1,400.00, Position: −25")),
   [1399.5,1400,-25]);
});
test("single pure-number element needs no ordinal",()=>{
 const {preview}=setup();
 const result=preview("#grid",doc({"#grid":[element("399.50")]}));
 assert.equal(result.ok,true);
 assert.equal(result.value,399.5);
 assert.equal(result.numberIndex,0);
});
test("several numbers inside a parent must be explicitly selected",()=>{
 const {preview}=setup(),source=doc({".quotes":[element("Bid $399.50 Ask $400.50 Size 100")]});
 const ambiguous=preview(".quotes",source);
 assert.equal(ambiguous.ok,false);
 assert.match(ambiguous.error,/Multiple numbers/);
 assert.deepEqual(Array.from(ambiguous.values),[399.5,400.5,100]);
 const chosen=preview({selector:".quotes",numberIndex:1},source);
 assert.equal(chosen.ok,true);assert.equal(chosen.value,400.5);
});
test("repeated CSS matches require explicit element number and reveal options",()=>{
 const {preview}=setup();
 const source=doc({".price":[element("$399.50"),element("$400.50"),element("$401.00")]});
 const ambiguous=preview(".price",source);
 assert.equal(ambiguous.ok,false);
 assert.match(ambiguous.error,/Multiple elements/);
 assert.equal(ambiguous.elements,3);
 assert.equal(ambiguous.elementOptions[1].values[0],400.5);
 const chosen=preview({selector:".price",elementIndex:2},source);
 assert.equal(chosen.ok,true);assert.equal(chosen.value,401);
});
test("element and numeric indices can be combined in a table row",()=>{
 const {preview}=setup();
 const source=doc({".row":[element("GRID bid 399.5 ask 400.5"),
   element("CURE bid 400 ask 401")]});
 const chosen=preview({selector:".row",elementIndex:1,numberIndex:1},source);
 assert.equal(chosen.ok,true);assert.equal(chosen.value,401);
});
test("numeric attributes are supported without reading arbitrary DOM fields",()=>{
 const {preview,ruleOf}=setup();
 const source=doc({".quote":[element("Price unavailable",{attribute:{
   "aria-label":"Best ask $401.00","data-price":"$400.50","data-secret":"TOKEN-ABC"
 }})]});
 assert.equal(preview({selector:".quote",attribute:"aria-label"},source).value,401);
 assert.equal(preview({selector:".quote",attribute:"data-price"},source).value,400.5);
 assert.equal(ruleOf({selector:".quote",attribute:"onclick"}).attribute,undefined);
});
test("input value is available even if its text content is blank",()=>{
 const {preview}=setup();
 const source=doc({"#qty":[element("",{value:"-25"})]});
 assert.equal(preview("#qty",source).value,-25);
});
test("hidden elements are excluded and ambiguous selectors fail closed",()=>{
 const {preview}=setup();
 const source=doc({".bid":[element("$20",{visible:false}),element("$399.5")]});
 assert.equal(preview(".bid",source).value,399.5);
 assert.equal(preview("invalid[",source).ok,false);
 assert.equal(preview(".not-there",source).ok,false);
});
test("stale element and number indices do not silently fall back to first value",()=>{
 const {preview}=setup();
 const original=doc({".price":[element("399 401"),element("400 402")]});
 const rule={selector:".price",elementIndex:1,numberIndex:1};
 assert.equal(preview(rule,original).value,402);
 const updated=doc({".price":[element("399 401")]});
 assert.equal(preview(rule,updated).ok,false);
 const changed=doc({".price":[element("399 401"),element("400")]});
 assert.equal(preview(rule,changed).ok,false);
});
test("extremely broad selectors are refused, no large document scans",()=>{
 const {preview}=setup();
 const many=Array.from({length:70},()=>element("100"));
 const result=preview(".all",doc({".all":many}));
 assert.equal(result.ok,false);assert.match(result.error,/too many/);
});
test("older plain-string selector mappings remain compatible",()=>{
 const {ruleOf,preview}=setup();
 assert.equal(ruleOf("#ask").selector,"#ask");
 assert.equal(preview("#ask",doc({"#ask":[element("401")]})).value,401);
});
test("capturer sends only unambiguous mapped values and reacts to DOM updates",()=>{
 const messages=[],selectors={
   "#grid":[element("Best bid $399.5 Ask $400.5")],
   "#safe":[element("401.0")],
   "#ambiguous":[element("400 401")]
 };
 const context={
   window:null,
   document:doc(selectors),
   setInterval:()=>1,clearInterval:()=>{},
   chrome:{runtime:{
     onMessage:{addListener(callback){context.onMessage=callback;}},
     sendMessage(message,callback){messages.push(message);callback?.();}
   }},
   CSS:{escape:x=>x},Element:class{}
 };
 context.window=context;
 vm.runInNewContext(script,context);
 vm.runInNewContext(capture,context);
 const mapping={
  GRID:{bid:{selector:"#grid",numberIndex:0},ask:{selector:"#grid",numberIndex:1}},
  SAFE:{bid:"#safe"},
  CURE:{ask:"#ambiguous"}
 };
 context.onMessage({type:"CONFIG",selectors:mapping,enabled:true},null,()=>{});
 assert.equal(messages.length,1);
 assert.equal(messages[0].books.GRID.bid,399.5);
 assert.equal(messages[0].books.GRID.ask,400.5);
 assert.equal(messages[0].books.SAFE.bid,401);
 assert.equal(messages[0].books.CURE,undefined,"Ambiguous fields must never leave the tab");
 selectors["#grid"][0]=element("Best bid $398.5 Ask $399.5");
 context.onMessage({type:"CONFIG",selectors:mapping},null,()=>{});
 assert.equal(messages.length,2);
 assert.equal(messages[1].books.GRID.bid,398.5);
});
test("repeated preview work is responsive in Node tests",()=>{
 const {preview}=setup();
 const source=doc({".book":[element("GRID Bid 399.50 Ask 400.50 Volume 10")]});
 const start=performance.now();
 for(let i=0;i<1200;i++)
   assert.equal(preview({selector:".book",numberIndex:1},source).value,400.5);
 assert.ok(performance.now()-start<1000,"Repeated DOM extraction was too slow");
});
