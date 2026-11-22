/*
 * Activated by the user in the competition tab.
 * Only user-mapped visible numbers are captured. Never submits game actions.
 */
(()=>{
"use strict";
if(window.__basketsLocalCapture?.installed)return;
const extract=globalThis.__BasketsFieldExtractor;
if(!extract)throw new Error("Baskets extractor was not loaded.");
const FIELDS=["bid","ask","bidSize","askSize","position","openBuys","openSells"];
const SYMBOLS=["GRID","CURE","SAFE"];
let mapping={},running=false,interval=null,picking=null,lastPayload="",lastSent=0;
function valid(field,value){
 if(!Number.isFinite(value))return false;
 if(field==="bid"||field==="ask")return value>=0&&value<=800&&Math.abs(value*2-Math.round(value*2))<1e-7;
 if(field==="position")return Number.isInteger(value)&&Math.abs(value)<=1000;
 return Number.isSafeInteger(value)&&value>=0;
}
function capture(){
 if(!running||picking)return;
 const books={};
 for(const sym of SYMBOLS){
   const fields={};
   for(const field of FIELDS){
     const rule=mapping?.[sym]?.[field];
     if(!rule)continue;
     const result=extract.preview(rule,document,{sym,field});
     if(result.ok&&valid(field,result.value))fields[field]=result.value;
   }
   if(Object.keys(fields).length)books[sym]=fields;
 }
 if(!Object.keys(books).length)return;
 const payload=JSON.stringify(books);
 if(payload===lastPayload && Date.now()-lastSent<1600)return;
 lastPayload=payload;lastSent=Date.now();
 chrome.runtime.sendMessage({type:"MARKET_CAPTURE",books},()=>void chrome.runtime.lastError);
}
function configure(rules,enable){
 mapping=rules&&typeof rules==="object"?rules:{};
 if(enable===true)running=true;
 if(interval)clearInterval(interval);
 interval=setInterval(capture,650);
 if(running)capture();
}
function esc(s){return CSS.escape(String(s));}
function cssPath(target){
 const root=target.getRootNode();
 if(root!==document)return null; // Iframe/ShadowRoot need a separate adapter.
 let current=target;
 while(current&&current!==document.body){
   const id=current.getAttribute?.("id");
   if(id){
     const selector="#"+esc(id);
     if(document.querySelectorAll(selector).length===1)return selector;
   }
   const testid=current.getAttribute?.("data-testid");
   if(testid){
     const selector='[data-testid="'+esc(testid)+'"]';
     if(document.querySelectorAll(selector).length===1)return selector;
   }
   current=current.parentElement;
 }
 const steps=[];
 current=target;
 while(current && current.nodeType===1 && steps.length<60){
   let label=current.localName;
   if(current.id){label+="#"+esc(current.id);steps.unshift(label);break;}
   const parent=current.parentElement;
   if(parent){
     const same=Array.from(parent.children).filter(child=>child.localName===current.localName);
     if(same.length>1)label+=":nth-of-type("+(same.indexOf(current)+1)+")";
   }
   steps.unshift(label);
   if(current===document.documentElement)break;
   current=parent;
 }
 const selector=steps.join(" > ");
 return selector&&selector.length<=500?selector:null;
}
function cancelPick(){
 if(!picking)return;
 document.removeEventListener("click",picking.click,true);
 document.removeEventListener("mouseover",picking.hover,true);
 document.removeEventListener("keydown",picking.key,true);
 if(picking.last)picking.last.style.outline=picking.oldOutline;
 picking.banner?.remove();
 picking=null;
}
function beginPick(sym,field){
 cancelPick();
 const banner=document.createElement("div");
 banner.textContent="BASKETS: click "+sym+" "+field+" on the game page. ESC cancels.";
 Object.assign(banner.style,{position:"fixed",top:"8px",left:"8px",zIndex:"2147483647",
   background:"#0b4136",color:"#fff",border:"2px solid #69e6ba",borderRadius:"7px",
   padding:"12px 16px",font:"700 13px system-ui,sans-serif",pointerEvents:"none"});
 document.documentElement.appendChild(banner);
 const pick={banner,last:null,oldOutline:"",click:null,hover:null,key:null};
 pick.hover=event=>{
   if(pick.last)pick.last.style.outline=pick.oldOutline;
   const el=event.target;
   if(!(el instanceof Element))return;
   pick.last=el;pick.oldOutline=el.style.outline;
   el.style.outline="3px solid #69e6ba";
 };
 pick.click=event=>{
   event.preventDefault();
   event.stopImmediatePropagation(); // Picking never triggers a game trade.
   const element=event.target instanceof Element?event.target:null;
   const suggestion=element?.getRootNode()===document?
     extract.suggestSymbolRule(element,sym,field,document):null;
   const fallback=element?cssPath(element):null;
   cancelPick();
   if(!suggestion?.rule && !fallback){
     alert("Baskets reader: Cannot identify an accessible HTML field. Try a visible value or manual dynamic row selector.");return;
   }
   if(!suggestion?.rule){
     alert("Symbol lock could not be configured automatically. The picker saved a legacy position-based selector. Switch to Follow symbol and supply a Row CSS selector to make it reorder-safe.");
   }else if(!suggestion.verified){
     alert("The "+sym+" row is locked by symbol, but this field needs a matching label, table header, or scoped Field CSS selector. Open the extension and click Check.");
   }
   chrome.runtime.sendMessage({type:"FIELD_PICKED",sym,field,
     rule:suggestion?.rule||{selector:fallback}},
     ()=>void chrome.runtime.lastError);
 };
 pick.key=event=>{if(event.key==="Escape"){event.preventDefault();cancelPick();}};
 picking=pick;
 document.addEventListener("mouseover",pick.hover,true);
 document.addEventListener("click",pick.click,true);
 document.addEventListener("keydown",pick.key,true);
}
function stop(){
 running=false;
 if(interval){clearInterval(interval);interval=null;}
 cancelPick();
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message?.type==="CONFIG"){
   configure(message.selectors,message.enabled);
   reply({ok:true,active:running});return;
 }
 if(message?.type==="PICK"){
   if(!SYMBOLS.includes(message.sym)||!FIELDS.includes(message.field)){reply({ok:false});return;}
   beginPick(message.sym,message.field);reply({ok:true});return;
 }
 if(message?.type==="PREVIEW"){
   const result=extract.preview(message.rule,document,{sym:message.sym,field:message.field});
   reply(result);return;
 }
 if(message?.type==="STOP"){
   stop();reply({ok:true});return;
 }
});
window.__basketsLocalCapture={installed:true,stop};
})();
