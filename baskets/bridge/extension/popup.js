const $=id=>document.getElementById(id);
const SYMS=["GRID","CURE","SAFE"];
const ESSENTIAL=["bid","ask"];
const ADVANCED=["bidSize","askSize","position","openBuys","openSells"];
const LABEL={bid:"Bid",ask:"Ask",bidSize:"Bid size",askSize:"Ask size",
 position:"Position",openBuys:"Open buys",openSells:"Open sells"};
let tab=null,origin=null,mapping={};
function show(message,good=false){$("status").textContent=message;$("status").className=good?"ok":"bad";}
function send(message){return new Promise(resolve=>chrome.runtime.sendMessage(message,response=>
 resolve(chrome.runtime.lastError?{ok:false,error:chrome.runtime.lastError.message}:response||{ok:false})));}
async function load(){
 const tabs=await chrome.tabs.query({active:true,currentWindow:true});
 tab=tabs[0];
 try{origin=new URL(tab?.url).origin;}catch{}
 $("tabName").textContent=tab?.title||"No active web tab";
 if(!origin||!/^https?:/.test(origin)){
   $("tabName").textContent="Switch to the actual competition tab before mapping.";
   $("start").disabled=true;return;
 }
 const key="mapping:"+origin;
 const saved=await chrome.storage.local.get(["bridgeKey",key]);
 $("bridgeKey").value=saved.bridgeKey||"";
 mapping=saved[key]||{};
 draw();
 const state=await send({type:"STATUS"});
 show(state.bridgeUp?"Local bridge is running.":"Local bridge offline. Start its Node server first.",state.bridgeUp);
}
function draw(){
 const drawList=fields=>SYMS.flatMap(sym=>fields.map(field=>{
   const selector=mapping?.[sym]?.[field]||"";
   const row=document.createElement("div");row.className="mapping-row";
   const title=document.createElement("strong");title.textContent=sym;
   const label=document.createElement("label");label.textContent=LABEL[field];
   const input=document.createElement("input");input.value=selector;
   input.placeholder="CSS selector or Pick";
   input.setAttribute("aria-label",sym+" "+field+" CSS selector");
   input.addEventListener("change",async()=>{
     const res=await send({type:"SET_SELECTOR",tabId:tab.id,sym,field,selector:input.value.trim()});
     if(res.ok){mapping[sym]??={};mapping[sym][field]=input.value.trim();show("Saved selector",true);}
     else show(res.error||"Selector not saved");
   });
   const button=document.createElement("button");button.textContent="Pick";button.className="pick";
   button.addEventListener("click",async()=>{
     const res=await send({type:"PICK",tabId:tab.id,sym,field});
     if(!res.ok){show(res.error||"Cannot pick field");return;}
     window.close();
   });
   row.append(title,label,input,button);
   return row;
 })).filter(Boolean);
 $("essential").replaceChildren(...drawList(ESSENTIAL));
 $("advanced").replaceChildren(...drawList(ADVANCED));
}
$("saveKey").addEventListener("click",async()=>{
 const key=$("bridgeKey").value.trim().toLowerCase();
 if(!/^[0-9a-f]{36}$/.test(key)){show("Use the 36-character key printed by the Node bridge.");return;}
 await chrome.storage.local.set({bridgeKey:key});
 show("Session key saved in this Chrome profile.",true);
});
$("start").addEventListener("click",async()=>{
 if(!tab)return;
 const key=$("bridgeKey").value.trim().toLowerCase();
 if(!/^[0-9a-f]{36}$/.test(key)){show("Paste the bridge key first.");return;}
 await chrome.storage.local.set({bridgeKey:key});
 const result=await send({type:"START",tabId:tab.id});
 show(result.ok?"Capture active. Keep this game tab open.":result.error||"Capture failed",result.ok);
});
$("stop").addEventListener("click",async()=>{
 const result=await send({type:"STOP",tabId:tab?.id});
 show(result.ok?"Capture stopped.":"Could not stop capture.",result.ok);
});
load().catch(error=>show(error.message));
