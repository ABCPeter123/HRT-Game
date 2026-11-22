/*
 * Background relay: never sends orders or navigates the game.
 * The only external connection is a token-protected loopback endpoint.
 */
const SERVER="http://127.0.0.1:8765";
const SUPPORTED_FIELDS=new Set(["bid","ask","bidSize","askSize","position","openBuys","openSells"]);
const SUPPORTED_SYMBOLS=new Set(["GRID","CURE","SAFE"]);
async function sourceInfo(tabId){
  const tab=await chrome.tabs.get(tabId);
  let url;
  try{url=new URL(tab.url);}catch{throw new Error("Open the actual trading page before starting.");}
  if(!["http:","https:"].includes(url.protocol)||
    ["localhost","127.0.0.1"].includes(url.hostname))throw new Error("Open the GAME tab, not the local Baskets panel.");
  return {tab,origin:url.origin};
}
function mappingKey(origin){return "mapping:"+origin;}
async function inject(tabId){
  try{await chrome.scripting.executeScript({target:{tabId},files:["capture.js"]});}
  catch(error){throw new Error("Cannot read this page. Use a normal HTTPS competition tab, not Chrome settings or a restricted page.");}
}
async function sendConfig(tabId,origin){
  const saved=await chrome.storage.local.get(mappingKey(origin));
  await chrome.tabs.sendMessage(tabId,{type:"CONFIG",selectors:saved[mappingKey(origin)]||{}});
}
async function start(tabId){
  const {origin}=await sourceInfo(tabId);
  await inject(tabId);
  await chrome.storage.session.set({activeSourceTabId:tabId,activeOrigin:origin});
  await sendConfig(tabId,origin);
  return {ok:true,origin};
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  (async()=>{
    if(message.type==="START"){
      return await start(message.tabId);
    }
    if(message.type==="STOP"){
      await chrome.storage.session.remove(["activeSourceTabId","activeOrigin"]);
      const tabId=Number(message.tabId);
      if(Number.isInteger(tabId))try{await chrome.tabs.sendMessage(tabId,{type:"STOP"});}catch{}
      return {ok:true};
    }
    if(message.type==="PICK"){
      if(!SUPPORTED_SYMBOLS.has(message.sym)||!SUPPORTED_FIELDS.has(message.field))
        throw new Error("Invalid field selection");
      const {origin}=await sourceInfo(message.tabId);
      await inject(message.tabId);
      await chrome.tabs.sendMessage(message.tabId,{type:"PICK",sym:message.sym,field:message.field});
      return {ok:true,origin};
    }
    if(message.type==="SET_SELECTOR"||message.type==="FIELD_PICKED"){
      const tabId=message.type==="FIELD_PICKED"?sender.tab?.id:message.tabId;
      if(!Number.isInteger(tabId))throw new Error("Source tab missing");
      const {origin}=await sourceInfo(tabId);
      if(!SUPPORTED_SYMBOLS.has(message.sym)||!SUPPORTED_FIELDS.has(message.field))
        throw new Error("Invalid symbol or field");
      const selector=String(message.selector??"").trim().slice(0,500);
      const key=mappingKey(origin);
      const saved=await chrome.storage.local.get(key);
      const map=saved[key]||{};
      map[message.sym]??={};
      if(selector)map[message.sym][message.field]=selector;
      else delete map[message.sym][message.field];
      await chrome.storage.local.set({[key]:map});
      await sendConfig(tabId,origin);
      return {ok:true};
    }
    if(message.type==="MARKET_CAPTURE"){
      const session=await chrome.storage.session.get(["activeSourceTabId","activeOrigin"]);
      if(!sender.tab||sender.tab.id!==session.activeSourceTabId)return {ok:false,error:"Source tab not activated"};
      const url=new URL(sender.tab.url);
      if(url.origin!==session.activeOrigin)return {ok:false,error:"Game origin changed; restart capture"};
      const stored=await chrome.storage.local.get("bridgeKey");
      const key=String(stored.bridgeKey??"");
      if(!/^[0-9a-f]{36}$/.test(key))return {ok:false,error:"Configure the 36-character bridge key"};
      const response=await fetch(SERVER+"/snapshot",{
        method:"POST",headers:{"content-type":"application/json","x-bridge-key":key},
        body:JSON.stringify({books:message.books,host:url.hostname})
      });
      if(!response.ok)return {ok:false,error:"Local bridge rejected capture: "+response.status};
      return {ok:true};
    }
    if(message.type==="STATUS"){
      const session=await chrome.storage.session.get(["activeSourceTabId","activeOrigin"]);
      let health=false;
      try{health=(await fetch(SERVER+"/health")).ok;}catch{}
      return {...session,bridgeUp:health};
    }
    throw new Error("Unknown command");
  })().then(reply).catch(error=>reply({ok:false,error:error.message}));
  return true;
});
