import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {performance} from "node:perf_hooks";
const script=readFileSync(new URL("../bridge/extension/field-extract.js",import.meta.url),"utf8");
const capture=readFileSync(new URL("../bridge/extension/capture.js",import.meta.url),"utf8");
function setup(){
 const context={CSS:{escape:x=>x}};
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

function fakeNode(text,{attrs={},children=[],tagName="DIV",classes="",parent=null,values=null}={}){
 const node={
  tagName,localName:tagName.toLowerCase(),className:classes,parentElement:parent,
  innerText:text,textContent:text,children,
  getAttribute:k=>attrs[k]??null,hasAttribute:k=>attrs[k]!=null,
  getClientRects:()=>[{}],closest:s=>s==="table"?parent?.table||null:null,
  querySelectorAll:s=>values?.[s]||[],
  contains:child=>{
    if(child===node)return true;
    return children.some(x=>x===child||x.contains?.(child));
  }
 };
 for(const child of children)child.parentElement=node;
 return node;
}
function fakeRow(symbol,bid,ask,{rowClass="quote-row",asText=true}={}){
 const cells=[fakeNode(symbol,{tagName:"TD"}),
  fakeNode(String(bid),{tagName:"TD"}),fakeNode(String(ask),{tagName:"TD"})];
 return fakeNode(asText?symbol+" Bid "+bid+" Ask "+ask:symbol+" "+bid+" "+ask,{
   tagName:"TR",classes:rowClass,children:cells});
}
function fakeTable(rows,headings=["Symbol","Bid","Ask"]){
 const th=headings.map(x=>fakeNode(x,{tagName:"TH"}));
 const table={querySelectorAll:selector=>
   selector==="thead th, thead [role=columnheader]"?th:[]};
 for(const row of rows)row.table=table;
 for(const row of rows)row.closest=selector=>selector==="table"?table:null;
 return table;
}
function domRows(rows){
 return {body:null,documentElement:null,querySelectorAll:s=>
   s==="tr"||s===".quote-row"||s==='[role="row"]'?rows:[]};
}
test("symbol lock follows GRID after rows reorder and updates values, without numerical position",()=>{
 const ext=setup(),rule={mode:"symbol",symbol:"GRID",field:"bid",rowSelector:"tr",source:"label"};
 const grid=fakeRow("GRID",399.5,400.5),cure=fakeRow("CURE",398.5,401);
 const safe=fakeRow("SAFE",399,402),rows=[grid,cure,safe],dom=domRows(rows);
 assert.equal(ext.preview(rule,dom,{sym:"GRID",field:"bid"}).value,399.5);
 rows.reverse();
 assert.equal(ext.preview(rule,dom,{sym:"GRID",field:"bid"}).value,399.5);
 rows.splice(rows.indexOf(grid),1);
 rows.unshift(fakeRow("GRID",397.5,398.5));
 assert.equal(ext.preview(rule,dom,{sym:"GRID",field:"bid"}).value,397.5);
 const ask={...rule,field:"ask"};
 assert.equal(ext.preview(ask,dom,{sym:"GRID",field:"ask"}).value,398.5);
});
test("reordered bid and ask labels retain identity independent of numeric sequence",()=>{
 const ext=setup();
 const row=fakeNode("CURE Ask 401.5 Position -15 Bid 399.5");
 const doc=domRows([row]);
 const bid={mode:"symbol",symbol:"CURE",field:"bid",rowSelector:"tr",source:"label"};
 assert.equal(ext.preview(bid,doc,{sym:"CURE",field:"bid"}).value,399.5);
 assert.equal(ext.preview({...bid,field:"ask"},doc,{sym:"CURE",field:"ask"}).value,401.5);
 row.innerText="CURE Bid 400 Ask 402 Position -15";
 assert.equal(ext.preview(bid,doc,{sym:"CURE",field:"bid"}).value,400);
});
test("header-locked extraction follows live table column reorder",()=>{
 const ext=setup(),row=fakeRow("SAFE",401,402,{asText:false});
 fakeTable([row],["Symbol","Bid","Ask"]);
 const rule={mode:"symbol",symbol:"SAFE",field:"ask",rowSelector:"tr",source:"header"};
 assert.equal(ext.preview(rule,domRows([row]),{sym:"SAFE",field:"ask"}).value,402);
 row.children.splice(1,2,row.children[2],row.children[1]);
 fakeTable([row],["Symbol","Ask","Bid"]);
 assert.equal(ext.preview(rule,domRows([row]),{sym:"SAFE",field:"ask"}).value,402);
});
test("a duplicate symbol row is ambiguous and cannot silently use the first",()=>{
 const ext=setup(),rows=[fakeRow("GRID",399,401),fakeRow("GRID",390,393)];
 const result=ext.preview({mode:"symbol",symbol:"GRID",field:"bid",rowSelector:"tr",source:"label"},domRows(rows));
 assert.equal(result.ok,false);assert.match(result.error,/More than one GRID/);
});
test("container with two basket labels is never misidentified as one symbol",()=>{
 const ext=setup();
 const container=fakeNode("GRID 400 401 CURE 399 402");
 const result=ext.preview({mode:"symbol",symbol:"GRID",field:"bid",rowSelector:"tr",source:"label"},
  domRows([container]));
 assert.equal(result.ok,false);
});
test("missing named basket never falls back to CURE or SAFE price",()=>{
 const ext=setup();
 const result=ext.preview({mode:"symbol",symbol:"GRID",field:"bid",rowSelector:"tr",source:"label"},
  domRows([fakeRow("CURE",401,402),fakeRow("SAFE",399,400)]));
 assert.equal(result.ok,false);
 assert.match(result.error,/No visible row uniquely identifies GRID/);
});
test("lock refuses wrong symbol context even when the row exists",()=>{
 const ext=setup();
 const rule={mode:"symbol",symbol:"GRID",field:"bid",rowSelector:"tr",source:"label"};
 const result=ext.preview(rule,domRows([fakeRow("GRID",399,401)]),{sym:"CURE",field:"bid"});
 assert.equal(result.ok,false);
 assert.match(result.error,/does not match/);
});
test("auto method compares labels with headers and refuses disagreement",()=>{
 const ext=setup(),row=fakeRow("GRID",399,401);
 fakeTable([row],["Symbol","Ask","Bid"]);
 const rule={mode:"symbol",symbol:"GRID",field:"bid",rowSelector:"tr",source:"auto"};
 const result=ext.preview(rule,domRows([row]));
 assert.equal(result.ok,false);
 assert.match(result.error,/disagree/);
});
test("symbol mode supports a scoped data field selector inside a reordered row",()=>{
 const ext=setup();
 const priceA=fakeNode("$399.50",{attrs:{"data-field":"bid"}});
 const priceB=fakeNode("$400.50",{attrs:{"data-field":"ask"}});
 const row=fakeNode("GRID",{
  children:[priceA,priceB],values:{'[data-field="ask"]':[priceB]}
 });
 const rule={mode:"symbol",symbol:"GRID",field:"ask",rowSelector:"tr",
  source:"selector",selector:'[data-field="ask"]'};
 assert.equal(ext.preview(rule,domRows([row])).value,400.5);
 const replacement=fakeNode("$402.50",{attrs:{"data-field":"ask"}});
 row.children.reverse();row.querySelectorAll=()=>[replacement];
 assert.equal(ext.preview(rule,domRows([row])).value,402.5);
});
test("number-index legacy mappings remain available but symbol-lock rules omit them",()=>{
 const ext=setup();
 const legacy=ext.ruleOf({selector:".row",elementIndex:1,numberIndex:2});
 assert.equal(legacy.elementIndex,1);
 assert.equal(legacy.numberIndex,2);
 const newRule=ext.ruleOf({mode:"symbol",symbol:"GRID",field:"bid",
   rowSelector:"tr",source:"label",selector:""});
 assert.equal(newRule.elementIndex,undefined);
 assert.equal(newRule.mode,"symbol");
});
test("capturer binds current prices to named instruments despite reordered DOM",()=>{
 const messages=[],rows=[fakeRow("GRID",399.5,400.5),
  fakeRow("CURE",398.5,400.5),fakeRow("SAFE",400.5,402.5)];
 const game=domRows(rows);
 const context={
  window:null,document:game,setInterval:()=>1,clearInterval:()=>{},
  chrome:{runtime:{onMessage:{addListener(cb){context.onMessage=cb;}},
    sendMessage(message,cb){messages.push(message);cb?.();}}},
  CSS:{escape:x=>x},Element:class{}
 };
 context.window=context;
 vm.runInNewContext(script,context);
 vm.runInNewContext(capture,context);
 const mk=(symbol,field)=>({mode:"symbol",symbol,field,rowSelector:"tr",source:"label"});
 const config=Object.fromEntries(["GRID","CURE","SAFE"].map(symbol=>
  [symbol,{bid:mk(symbol,"bid"),ask:mk(symbol,"ask")}]));
 context.onMessage({type:"CONFIG",selectors:config,enabled:true},null,()=>{});
 assert.equal(messages.length,1);
 assert.equal(messages[0].books.GRID.bid,399.5);
 assert.equal(messages[0].books.CURE.ask,400.5);
 rows.reverse();
 rows[0].innerText="SAFE Bid 403.5 Ask 404.5";
 rows[2].innerText="GRID Ask 402.5 Bid 401.5";
 context.onMessage({type:"CONFIG",selectors:config},null,()=>{});
 assert.equal(messages.length,2);
 assert.equal(messages[1].books.GRID.bid,401.5);
 assert.equal(messages[1].books.GRID.ask,402.5);
 assert.equal(messages[1].books.SAFE.ask,404.5);
});

test("picker detects a movable table row from clicked price and creates a symbol lock",()=>{
 const ext=setup(),row=fakeRow("GRID",399.5,400.5);
 const clicked=row.children[1],game=domRows([row,fakeRow("CURE",402,404)]);
 const suggested=ext.suggestSymbolRule(clicked,"GRID","bid",game);
 assert.equal(suggested.verified,true);
 assert.equal(suggested.rule.mode,"symbol");
 assert.equal(suggested.rule.rowSelector,"tr");
 assert.equal(ext.preview(suggested.rule,game).value,399.5);
});
test("picker refuses to claim another basket's row when clicked on a different symbol",()=>{
 const ext=setup(),row=fakeRow("SAFE",401,402);
 const suggested=ext.suggestSymbolRule(row.children[1],"GRID","bid",domRows([row]));
 assert.equal(suggested.rule,null);
 assert.equal(suggested.mismatch,true);
 assert.match(suggested.error,/belongs to SAFE/);
});
