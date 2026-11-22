/*
 * Runs only when the user activates the extension in the competition tab.
 * Reads user-selected DOM fields. No fetch, form submission, or game action.
 */
(()=>{
 if(window.__basketsLocalCapture?.installed)return;
 const FIELD_KEYS=["bid","ask","bidSize","askSize","position","openBuys","openSells"];
 const SYMBOLS=["GRID","CURE","SAFE"];
 let selectors={},running=false,interval=null,picking=null,lastPayload="",lastStatus="";
 function getValue(selector){
   let element;
   try{element=document.querySelector(selector);}catch{return null;}
   if(!element||!element.getClientRects().length)return null;
   const raw=("value" in element?element.value:element.textContent)||"";
   // Only a single visible number. Never ship surrounding page content.
   const number=String(raw).trim().replace(/\u2212/g,"-").replace(/[$,\s]/g,"");
   if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(number))return null;
   const n=Number(number);
   return Number.isFinite(n)?n:null;
 }
 function capture(){
   // Keep reading when the user switches to the local Baskets decision tab.
   // Background timers may be throttled by Chrome, so status reports staleness.
   if(!running || picking)return;
   const books={};
   for(const symbol of SYMBOLS){
     const fields={};
     for(const field of FIELD_KEYS){
       const css=selectors?.[symbol]?.[field];
       if(!css)continue;
       const value=getValue(css);
       if(value!==null)fields[field]=value;
     }
     if(Object.keys(fields).length)books[symbol]=fields;
   }
   if(!Object.keys(books).length)return;
   const payload=JSON.stringify(books);
   if(payload===lastPayload && Date.now()-lastStatus<1600)return;
   lastPayload=payload;lastStatus=Date.now();
   chrome.runtime.sendMessage({type:"MARKET_CAPTURE",books},()=>void chrome.runtime.lastError);
 }
 function stop(){
   running=false;
   if(interval){clearInterval(interval);interval=null;}
   cancelPick();
 }
 function start(config){
   selectors=config&&typeof config==="object"?config:{};
   running=true;
   if(interval)clearInterval(interval);
   interval=setInterval(capture,650);
   capture();
 }
 function escapeCss(s){return CSS.escape(String(s));}
 function cssPath(element){
   let node=element;
   while(node&&node!==document.body){
     const id=node.getAttribute?.("id");
     if(id&&document.querySelectorAll("#"+escapeCss(id)).length===1)return "#"+escapeCss(id);
     const testId=node.getAttribute?.("data-testid");
     if(testId){
       const selector='[data-testid="'+escapeCss(testId)+'"]';
       if(document.querySelectorAll(selector).length===1)return selector;
     }
     node=node.parentElement;
   }
   const pieces=[];
   node=element;
   while(node&&node.nodeType===1&&pieces.length<9){
     let chunk=node.localName;
     if(node.id){chunk+="#"+escapeCss(node.id);pieces.unshift(chunk);break;}
     const parent=node.parentElement;
     if(parent){
       const siblings=Array.from(parent.children).filter(el=>el.localName===node.localName);
       if(siblings.length>1)chunk+=":nth-of-type("+(siblings.indexOf(node)+1)+")";
     }
     pieces.unshift(chunk);
     node=parent;
   }
   return pieces.join(" > ");
 }
 function cancelPick(){
   if(!picking)return;
   document.removeEventListener("click",picking.click,true);
   document.removeEventListener("mouseover",picking.hover,true);
   document.removeEventListener("keydown",picking.key,true);
   if(picking.last)picking.last.style.outline=picking.previousOutline;
   if(picking.message)picking.message.remove();
   picking=null;
 }
 function beginPick(symbol,field){
   cancelPick();
   const label=document.createElement("div");
   label.textContent="BASKETS READER: Click the "+symbol+" "+field+" number. ESC to cancel.";
   Object.assign(label.style,{position:"fixed",top:"7px",left:"7px",zIndex:"2147483647",
     color:"#f3fffc",background:"#0a3831",font:"bold 13px sans-serif",
     border:"2px solid #66e5bc",padding:"10px 13px",borderRadius:"6px",
     pointerEvents:"none"});
   document.documentElement.appendChild(label);
   const pick={message:label,last:null,previousOutline:"",click:null,hover:null,key:null};
   pick.hover=event=>{
     if(pick.last)pick.last.style.outline=pick.previousOutline;
     const target=event.target;
     if(!(target instanceof Element))return;
     pick.last=target;pick.previousOutline=target.style.outline;
     target.style.outline="3px solid #40e6be";
   };
   pick.click=event=>{
     event.preventDefault();event.stopImmediatePropagation();
     const target=event.target instanceof Element?event.target:null;
     const selector=target?cssPath(target):"";
     cancelPick();
     if(selector){
       chrome.runtime.sendMessage({type:"FIELD_PICKED",sym:symbol,field,selector},
         ()=>void chrome.runtime.lastError);
     }
   };
   pick.key=event=>{if(event.key==="Escape"){event.preventDefault();cancelPick();}};
   picking=pick;
   document.addEventListener("mouseover",pick.hover,true);
   document.addEventListener("click",pick.click,true);
   document.addEventListener("keydown",pick.key,true);
 }
 chrome.runtime.onMessage.addListener((message,sender,reply)=>{
   if(message.type==="CONFIG"){start(message.selectors);reply({ok:true});return;}
   if(message.type==="PICK"){beginPick(message.sym,message.field);reply({ok:true});return;}
   if(message.type==="STOP"){stop();reply({ok:true});return;}
 });
 window.__basketsLocalCapture={installed:true,stop};
})();
