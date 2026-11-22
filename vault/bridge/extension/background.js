/*
 * Read-only extension relay. Writes only selected numeric fields to localhost.
 * Never submits an order, scrapes credentials or proxies game traffic.
 */
const SERVER="http://127.0.0.1:8766";
const SUPPORTED_FIELDS=new Set(["bid","ask","bidSize","askSize","position","workingBuys","workingSells"]);
const SUPPORTED_SYMBOLS=new Set(["VAULT","G5","PUB"]);
const ATTRIBUTE=/^(?:aria-[a-z0-9_-]+|data-[a-z0-9_-]+|title|content)$/i;
async function sourceInfo(tabId){
 const tab=await chrome.tabs.get(tabId);
 let url;
 try{url=new URL(tab.url);}catch{throw new Error("Open the game trading page first.");}
 if(!["http:","https:"].includes(url.protocol)||["localhost","127.0.0.1"].includes(url.hostname))
   throw new Error("Select a normal competition web tab, not the local Vault panel.");
 return {tab,origin:url.origin};
}
function mappingKey(origin){return "vault:mapping:"+origin;}
async function inject(tabId){
 try{
   await chrome.scripting.executeScript({target:{tabId},
     files:["field-extract.js","capture.js"]});
 }catch{
   throw new Error("Cannot inspect this tab. Try a normal HTTPS competition page.");
 }
}
function sanitizeRule(raw,sym=null,field=null){
 const value=typeof raw==="string"?{selector:raw}:raw;
 if(!value||typeof value!=="object")return null;
 const selector=String(value.selector??"").trim().slice(0,500);
 if(value.mode==="symbol"){
   if(!SUPPORTED_SYMBOLS.has(sym)||!SUPPORTED_FIELDS.has(field) ||
      (value.symbol && value.symbol!==sym) ||
      (value.field && value.field!==field))
     throw new Error("Symbol lock does not match the mapped field.");
   const source=["auto","label","header","selector"].includes(value.source)?value.source:"auto";
   const rowSelector=String(value.rowSelector??"").trim().slice(0,500);
   if(source==="selector"&&!selector)throw new Error("Field selector is required for scoped selector mode.");
   const attr=String(value.attribute??"").trim().slice(0,70);
   return {mode:"symbol",symbol:sym,field,source,rowSelector,selector,
     ...(ATTRIBUTE.test(attr)?{attribute:attr}:{})};
 }
 if(!selector)return null;
 const rule={selector};
 if(Number.isInteger(value.elementIndex)&&value.elementIndex>=0&&value.elementIndex<60)
   rule.elementIndex=value.elementIndex;
 if(Number.isInteger(value.numberIndex)&&value.numberIndex>=0&&value.numberIndex<32)
   rule.numberIndex=value.numberIndex;
 const attribute=String(value.attribute??"").trim().slice(0,70);
 if(ATTRIBUTE.test(attribute))rule.attribute=attribute;
 return rule;
}
async function sendConfig(tabId,origin,enabled=false){
 const saved=await chrome.storage.local.get(mappingKey(origin));
 await chrome.tabs.sendMessage(tabId,{type:"CONFIG",
   selectors:saved[mappingKey(origin)]||{},enabled});
}
async function start(tabId){
 const {origin}=await sourceInfo(tabId);
 await inject(tabId);
 await chrome.storage.session.set({activeSourceTabId:tabId,activeOrigin:origin});
 await sendConfig(tabId,origin,true);
 return {ok:true,origin};
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 (async()=>{
   if(message.type==="START")return await start(message.tabId);
   if(message.type==="STOP"){
     await chrome.storage.session.remove(["activeSourceTabId","activeOrigin"]);
     const tabId=Number(message.tabId);
     if(Number.isInteger(tabId))try{await chrome.tabs.sendMessage(tabId,{type:"STOP"});}catch{}
     return {ok:true};
   }
   if(message.type==="PICK"){
     if(!SUPPORTED_SYMBOLS.has(message.sym)||!SUPPORTED_FIELDS.has(message.field))
       throw new Error("Invalid mapping field.");
     await sourceInfo(message.tabId);
     await inject(message.tabId);
     await chrome.tabs.sendMessage(message.tabId,{type:"PICK",sym:message.sym,field:message.field});
     return {ok:true};
   }
   if(message.type==="SET_RULE"||message.type==="FIELD_PICKED"){
     const tabId=message.type==="FIELD_PICKED"?sender.tab?.id:message.tabId;
     if(!Number.isInteger(tabId))throw new Error("Source tab unavailable.");
     const {origin}=await sourceInfo(tabId);
     if(!SUPPORTED_SYMBOLS.has(message.sym)||!SUPPORTED_FIELDS.has(message.field))
       throw new Error("Invalid symbol or market field.");
     const rule=sanitizeRule(message.rule??message.selector,message.sym,message.field);
     const key=mappingKey(origin);
     const saved=await chrome.storage.local.get(key),map=saved[key]||{};
     map[message.sym]??={};
     if(rule)map[message.sym][message.field]=rule;
     else delete map[message.sym][message.field];
     await chrome.storage.local.set({[key]:map});
     await inject(tabId);
     await sendConfig(tabId,origin);
     return {ok:true,rule};
   }
   if(message.type==="PREVIEW"){
     await sourceInfo(message.tabId);
     await inject(message.tabId);
     // Only the chosen field's numeric candidates come back, not page text.
     if(!SUPPORTED_SYMBOLS.has(message.sym)||!SUPPORTED_FIELDS.has(message.field))
       throw new Error("Select a valid field first.");
     const rule=sanitizeRule(message.rule,message.sym,message.field);
     if(!rule)return {ok:false,error:"No field mapping yet",elements:0,values:[]};
     return await chrome.tabs.sendMessage(message.tabId,{
       type:"PREVIEW",rule,sym:message.sym,field:message.field});
   }
   if(message.type==="MARKET_CAPTURE"){
     const session=await chrome.storage.session.get(["activeSourceTabId","activeOrigin"]);
     if(!sender.tab||sender.tab.id!==session.activeSourceTabId)
       return {ok:false,error:"Activate this game tab to start the reader."};
     const url=new URL(sender.tab.url);
     if(url.origin!==session.activeOrigin)
       return {ok:false,error:"Game origin changed. Start capture again."};
     const saved=await chrome.storage.local.get("vaultBridgeKey"),key=String(saved.vaultBridgeKey??"");
     if(!/^[0-9a-f]{36}$/.test(key))return {ok:false,error:"Configure the local bridge key."};
     const response=await fetch(SERVER+"/snapshot",{
       method:"POST",headers:{"content-type":"application/json","x-bridge-key":key},
       body:JSON.stringify({books:message.books,host:url.hostname})
     });
     if(!response.ok)return {ok:false,error:"Local bridge returned "+response.status};
     return {ok:true};
   }
   if(message.type==="STATUS"){
     const session=await chrome.storage.session.get(["activeSourceTabId","activeOrigin"]);
     let bridgeUp=false;
     try{bridgeUp=(await fetch(SERVER+"/health")).ok;}catch{}
     return {...session,bridgeUp};
   }
   throw new Error("Unknown extension command.");
 })().then(reply).catch(error=>reply({ok:false,error:error.message}));
 return true;
});
