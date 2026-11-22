import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const extractorScript=readFileSync(new URL("../bridge/extension/field-extract.js",import.meta.url),"utf8");
const captureScript=readFileSync(new URL("../bridge/extension/capture.js",import.meta.url),"utf8");
function setup(){
 const context={CSS:{escape:x=>x}};
 vm.runInNewContext(extractorScript,context);
 return context.__VaultFieldExtractor;
}
function node(text,{attrs={},children=[],tag="DIV",classes="",values={},visible=true,hasValue=false}={}){
 const x={tagName:tag,localName:tag.toLowerCase(),className:classes,
  innerText:String(text),textContent:String(text),children,parentElement:null,
  getAttribute:key=>attrs[key]??null,hasAttribute:key=>attrs[key]!=null,
  getClientRects:()=>visible?[{}]:[],
  querySelectorAll:selector=>values[selector]||[],
  closest:selector=>selector==="table"?x.table||null:null,
  contains:target=>target===x||children.some(y=>y===target||y.contains?.(target))};
 if(hasValue)x.value=text;
 for(const child of children)child.parentElement=x;
 return x;
}
function row(symbol,bid,ask,{text=true}={}){
 const cells=[node(symbol,{tag:"TD"}),node(String(bid),{tag:"TD"}),node(String(ask),{tag:"TD"})];
 return node(text?symbol+" Bid "+bid+" Ask "+ask:symbol+" "+bid+" "+ask,
   {tag:"TR",classes:"quote-row",children:cells});
}
function documentRows(rows){
 return {body:null,documentElement:null,querySelectorAll:s=>
   s==="tr"||s===".quote-row"||s==='[role="row"]'?rows:[]};
}
function locked(sym,field,source="label"){
 return {mode:"symbol",symbol:sym,field,source,rowSelector:"tr",selector:""};
}
function attachHeaders(rows,headings=["Symbol","Bid","Ask"]){
 const head=headings.map(s=>node(s,{tag:"TH"}));
 const table={querySelectorAll:s=>
   s==="thead th, thead [role=columnheader]"?head:[]};
 for(const x of rows)x.table=table;
 return table;
}
test("Vault extractor recognizes decimal prices and negative positions",()=>{
 const {tokens,symbolSet}=setup();
 assert.deepEqual(Array.from(tokens("Bid $165.25 Ask $170.50 Position −20")),
    [165.25,170.5,-20]);
 assert.deepEqual(Array.from(symbolSet("VAULT G5 PUB")),["VAULT","G5","PUB"]);
});
test("VAULT, G5, PUB stay attached to their names after rows move",()=>{
 const ext=setup();
 const rows=[row("VAULT",161.25,162.5),row("G5",12.1,12.5),row("PUB",105.25,106.5)];
 const dom=documentRows(rows);
 assert.equal(ext.preview(locked("VAULT","bid"),dom).value,161.25);
 assert.equal(ext.preview(locked("G5","ask"),dom).value,12.5);
 assert.equal(ext.preview(locked("PUB","bid"),dom).value,105.25);
 rows.reverse();
 assert.equal(ext.preview(locked("VAULT","ask"),dom).value,162.5);
 assert.equal(ext.preview(locked("G5","bid"),dom).value,12.1);
 rows[2].innerText="VAULT Ask 165.5 Bid 164.25";
 assert.equal(ext.preview(locked("VAULT","bid"),dom).value,164.25);
 assert.equal(ext.preview(locked("VAULT","ask"),dom).value,165.5);
});
test("table header mode continues to work when columns reorder",()=>{
 const ext=setup(),r=row("PUB",105.25,106.5,{text:false});
 attachHeaders([r]);
 const dom=documentRows([r]);
 assert.equal(ext.preview(locked("PUB","ask","header"),dom).value,106.5);
 r.children.splice(1,2,r.children[2],r.children[1]);
 attachHeaders([r],["Symbol","Ask","Bid"]);
 assert.equal(ext.preview(locked("PUB","ask","header"),dom).value,106.5);
});
test("working order sizes and position read from labels without numeric indices",()=>{
 const ext=setup();
 const r=node("G5 Working buys 18 Working sells 42 Position -29");
 const dom=documentRows([r]);
 assert.equal(ext.preview(locked("G5","workingBuys"),dom).value,18);
 assert.equal(ext.preview(locked("G5","workingSells"),dom).value,42);
 assert.equal(ext.preview(locked("G5","position"),dom).value,-29);
});
test("rejects duplicate row, absent row and wrong instrument context",()=>{
 const ext=setup(),one=row("VAULT",161.25,162.5),two=row("VAULT",165,166.25);
 let result=ext.preview(locked("VAULT","bid"),documentRows([one,two]));
 assert.equal(result.ok,false);assert.match(result.error,/More than one VAULT/);
 result=ext.preview(locked("VAULT","bid"),documentRows([row("G5",12,12.3)]));
 assert.equal(result.ok,false);assert.match(result.error,/No visible row uniquely identifies VAULT/);
 result=ext.preview(locked("VAULT","bid"),documentRows([one]),{sym:"PUB",field:"bid"});
 assert.equal(result.ok,false);assert.match(result.error,/does not match/);
 result=ext.preview(locked("VAULT","bid"),documentRows([node("VAULT 165 PUB 105")]));
 assert.equal(result.ok,false);
});
test("auto mode rejects conflicting label and table header readings",()=>{
 const ext=setup(),r=row("VAULT",151.25,152.5);
 attachHeaders([r],["Symbol","Ask","Bid"]);
 const result=ext.preview(locked("VAULT","bid","auto"),documentRows([r]));
 assert.equal(result.ok,false);assert.match(result.error,/disagree/);
});
test("selector mode never reads a different contract's row",()=>{
 const ext=setup();
 const bid=node("102.25",{attrs:{"data-field":"bid"}}),ask=node("103.50",{attrs:{"data-field":"ask"}});
 const r=node("PUB",{tag:"TR",children:[bid,ask],
   values:{'[data-field="ask"]':[ask]}});
 const rules={...locked("PUB","ask","selector"),selector:'[data-field="ask"]'};
 assert.equal(ext.preview(rules,documentRows([r])).value,103.5);
 const bad=ext.preview({...rules,symbol:"G5"},documentRows([r]));
 assert.equal(bad.ok,false);
});
test("clicked field creates verified symbol-locked rule or refuses wrong row",()=>{
 const ext=setup(),r=row("G5",12.1,12.6),other=row("PUB",101.25,102.5);
 const dom=documentRows([r,other]);
 const picked=ext.suggestSymbolRule(r.children[1],"G5","bid",dom);
 assert.equal(picked.verified,true);
 assert.equal(picked.rule.mode,"symbol");
 assert.equal(ext.preview(picked.rule,dom).value,12.1);
 const wrong=ext.suggestSymbolRule(other.children[1],"G5","bid",dom);
 assert.equal(wrong.rule,null);assert.equal(wrong.mismatch,true);
 assert.match(wrong.error,/belongs to PUB/);
});
test("legacy selectors remain available but not reorder-safe",()=>{
 const ext=setup();
 const source={querySelectorAll:selector=>
    selector===".price"?[node("100.25"),node("102.5")]:[]};
 const ambiguous=ext.preview({selector:".price"},source);
 assert.equal(ambiguous.ok,false);
 assert.equal(ext.preview({selector:".price",elementIndex:1},source).value,102.5);
 assert.equal(ext.ruleOf(locked("VAULT","bid")).elementIndex,undefined);
});
test("Vault capture rebinds named quotes after reordering without sending unrelated fields",()=>{
 const messages=[];
 const rows=[row("VAULT",161.25,162.5),row("G5",12.1,12.5),row("PUB",101.25,103.5)];
 const context={window:null,document:documentRows(rows),
  setInterval:()=>1,clearInterval:()=>{},CSS:{escape:x=>x},Element:class{},
  chrome:{runtime:{onMessage:{addListener(cb){context.listener=cb;}},
    sendMessage(data,cb){messages.push(data);cb?.();}}}};
 context.window=context;
 vm.runInNewContext(extractorScript,context);
 vm.runInNewContext(captureScript,context);
 const selectors=Object.fromEntries(["VAULT","G5","PUB"].map(sym=>
   [sym,{bid:locked(sym,"bid"),ask:locked(sym,"ask")}]));
 context.listener({type:"CONFIG",selectors,enabled:true},null,()=>{});
 assert.equal(messages.length,1);
 assert.equal(messages[0].books.VAULT.bid,161.25);
 assert.equal(messages[0].books.G5.ask,12.5);
 assert.equal(messages[0].books.PUB.bid,101.25);
 rows.reverse();
 rows[0].innerText="PUB Ask 106.5 Bid 105.25";
 rows[2].innerText="VAULT Ask 166.5 Bid 165.25";
 context.listener({type:"CONFIG",selectors},null,()=>{});
 assert.equal(messages.length,2);
 assert.equal(messages[1].books.VAULT.bid,165.25);
 assert.equal(messages[1].books.VAULT.ask,166.5);
 assert.equal(messages[1].books.PUB.bid,105.25);
 assert.equal(messages[1].books.G5.ask,12.5);
});
test("Vault capture rejects invalid ticks even if field extraction succeeds",()=>{
 const messages=[],rows=[row("G5",12.15,12.55)];
 const context={window:null,document:documentRows(rows),setInterval:()=>1,clearInterval:()=>{},
   CSS:{escape:x=>x},Element:class{},
   chrome:{runtime:{onMessage:{addListener(cb){context.listener=cb;}},
     sendMessage(data,cb){messages.push(data);cb?.();}}}};
 context.window=context;
 vm.runInNewContext(extractorScript,context);
 vm.runInNewContext(captureScript,context);
 context.listener({type:"CONFIG",selectors:{G5:{
    bid:locked("G5","bid"),ask:locked("G5","ask")}},enabled:true},null,()=>{});
 assert.equal(messages.length,0);
 rows[0].innerText="G5 Bid 12.1 Ask 12.5";
 context.listener({type:"CONFIG",selectors:{G5:{
    bid:locked("G5","bid"),ask:locked("G5","ask")}}},null,()=>{});
 assert.equal(messages.length,1);
});
