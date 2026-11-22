const $=id=>document.getElementById(id);
const SYMBOLS=["GRID","CURE","SAFE"];
const ESSENTIAL=["bid","ask"];
const ADVANCED=["bidSize","askSize","position","openBuys","openSells"];
const LABELS={bid:"Bid",ask:"Ask",bidSize:"Bid size",askSize:"Ask size",
 position:"Position",openBuys:"Open buys",openSells:"Open sells"};
const ATTR=/^(?:aria-[a-z0-9_-]+|data-[a-z0-9_-]+|title|content)$/i;
let tab=null,origin=null,mapping={},rows=new Map();
function status(message,ok=false){
 $("status").textContent=message;$("status").className=ok?"ok":"bad";
}
function send(message){
 return new Promise(resolve=>chrome.runtime.sendMessage(message,result=>
   resolve(chrome.runtime.lastError?{ok:false,error:chrome.runtime.lastError.message}:
     result||{ok:false,error:"No response from the extension"})));
}
function ruleOf(saved){
 if(typeof saved==="string")return {selector:saved};
 if(saved&&typeof saved==="object")return saved;
 return {selector:""};
}
function entry(sym,field){return sym+":"+field;}
function input(label,value,type,placeholder){
 const wrap=document.createElement("label");wrap.className="option-control";
 wrap.textContent=label;
 const el=document.createElement("input");
 el.type=type;el.value=value==null?"":String(value);el.placeholder=placeholder;
 if(type==="number"){el.min="1";el.step="1";}
 wrap.append(el);
 return {wrap,el};
}
function draftFromUI(row){
 const selector=row.selector.value.trim();
 const attribute=row.attr.value.trim();
 if(attribute&&!ATTR.test(attribute))throw new Error("Attribute must be aria-*, data-*, title or content");
 const convert=(input,max)=>{
   if(input.value.trim()==="")return undefined;
   const n=Number(input.value);
   if(!Number.isInteger(n)||n<1||n>max)throw new Error("Index must be between 1 and "+max);
   return n-1;
 };
 const elementIndex=convert(row.element,60),numberIndex=convert(row.number,32);
 return {selector,...(attribute?{attribute}:{}),
   ...(elementIndex===undefined?{}:{elementIndex}),
   ...(numberIndex===undefined?{}:{numberIndex})};
}
async function saveField(row){
 let rule;
 try{rule=draftFromUI(row);}catch(error){status(error.message);return false;}
 const result=await send({type:"SET_RULE",tabId:tab.id,sym:row.sym,field:row.field,rule});
 if(!result.ok){status(result.error||"Could not save mapping");return false;}
 mapping[row.sym]??={};
 if(result.rule)mapping[row.sym][row.field]=result.rule;
 else delete mapping[row.sym][row.field];
 return true;
}
async function previewField(row,{saveFirst=true}={}){
 if(saveFirst && !(await saveField(row)))return false;
 let rule;
 try{rule=draftFromUI(row);}catch(error){row.preview.textContent=error.message;return false;}
 if(!rule.selector){
   row.preview.textContent="Not mapped";row.preview.className="field-preview";return false;
 }
 const result=await send({type:"PREVIEW",tabId:tab.id,rule});
 const vals=(result.values||[]).slice(0,14)
   .map((v,i)=>(i+1)+":"+v).join(" | ");
 const suffix=" ("+(result.elements??0)+" matching element"+(result.elements===1?"":"s")+")";
 if(result.ok){
   const v=result.value;
   const valid=row.field==="bid"||row.field==="ask"?
     v>=0&&v<=800&&Math.abs(v*2-Math.round(v*2))<1e-7:
     row.field==="position"?Number.isInteger(v)&&Math.abs(v)<=1000:
     Number.isSafeInteger(v)&&v>=0;
   if(!valid){
     row.preview.textContent="Extracted "+v+" but it violates "+row.field+" limits. Check the mapping.";
     row.preview.className="field-preview bad";
     delete row.currentValue;return false;
   }
   row.currentValue=v;
   row.preview.textContent="Reads "+result.value+suffix+
     (result.values.length>1?" · Values: "+vals:"");
   row.preview.className="field-preview ok";
   return true;
 }
 const elementOptions=(result.elementOptions||[]).map(opt=>
   (opt.index+1)+": ["+opt.values.join(", ")+"]").join(" | ");
 delete row.currentValue;
 row.preview.textContent=(result.error||"Could not read this field")+suffix+
   (vals?" · Values: "+vals:"")+
   (elementOptions?" · Element choices: "+elementOptions:"");
 row.preview.className="field-preview bad";
 return false;
}
function buildRow(sym,field){
 const rule=ruleOf(mapping?.[sym]?.[field]);
 const item=document.createElement("div");item.className="mapping-row";
 const name=document.createElement("strong");name.textContent=sym;
 const label=document.createElement("label");label.textContent=LABELS[field];
 const selector=document.createElement("input");
 selector.value=rule.selector??"";
 selector.placeholder="CSS selector or Pick";
 selector.setAttribute("aria-label",sym+" "+LABELS[field]+" CSS selector");
 const pick=document.createElement("button");pick.textContent="Pick";pick.className="pick";
 const extra=document.createElement("div");extra.className="mapping-options";
 const element=input("Element #",rule.elementIndex===undefined?"":rule.elementIndex+1,"number","Auto");
 const number=input("Number #",rule.numberIndex===undefined?"":rule.numberIndex+1,"number","Auto");
 const attr=input("Attribute",rule.attribute||"","text","e.g. data-price");
 const check=document.createElement("button");check.textContent="Check";
 extra.append(element.wrap,number.wrap,attr.wrap,check);
 const preview=document.createElement("div");preview.className="field-preview";
 preview.textContent="Preview not checked";
 const row={sym,field,selector,element:element.el,number:number.el,attr:attr.el,preview};
 for(const el of [selector,element.el,number.el,attr.el]){
   el.addEventListener("change",()=>saveField(row).then(ok=>{if(ok)previewField(row,{saveFirst:false});}));
 }
 pick.addEventListener("click",async()=>{
   const result=await send({type:"PICK",tabId:tab.id,sym,field});
   if(!result.ok){status(result.error||"Picker unavailable");return;}
   window.close();
 });
 check.addEventListener("click",()=>previewField(row));
 item.append(name,label,selector,pick,extra,preview);
 rows.set(entry(sym,field),row);
 return item;
}
function draw(){
 rows.clear();
 $("essential").replaceChildren(...SYMBOLS.flatMap(s=>ESSENTIAL.map(f=>buildRow(s,f))));
 $("advanced").replaceChildren(...SYMBOLS.flatMap(s=>ADVANCED.map(f=>buildRow(s,f))));
}
async function load(){
 const tabs=await chrome.tabs.query({active:true,currentWindow:true});
 tab=tabs[0];
 try{origin=new URL(tab?.url).origin;}catch{}
 $("tabName").textContent=tab?.title||"No active game tab";
 if(!origin||!/^https?:/.test(origin)){
   $("tabName").textContent="Switch to the actual game tab first.";
   $("start").disabled=true;return;
 }
 const key="mapping:"+origin;
 const saved=await chrome.storage.local.get(["bridgeKey",key]);
 $("bridgeKey").value=saved.bridgeKey||"";
 mapping=saved[key]||{};
 draw();
 const state=await send({type:"STATUS"});
 status(state.bridgeUp?"Local bridge is running.":"Local bridge offline. Start the Node bridge first.",state.bridgeUp);
}
$("saveKey").addEventListener("click",async()=>{
 const key=$("bridgeKey").value.trim().toLowerCase();
 if(!/^[0-9a-f]{36}$/.test(key)){status("Paste the key printed by the bridge, 36 hex characters.");return;}
 await chrome.storage.local.set({bridgeKey:key});
 status("Bridge key saved for this browser profile.",true);
});
$("checkAll").addEventListener("click",async()=>{
 let valid=0,configured=0;
 for(const sym of SYMBOLS){
   for(const field of ESSENTIAL){
     const row=rows.get(entry(sym,field));
     if(!row.selector.value.trim())continue;
     configured++;
     if(await previewField(row))valid++;
   }
 }
 status(valid+"/"+configured+" mapped bid/ask fields read correctly.",configured>0&&valid===configured);
});
$("start").addEventListener("click",async()=>{
 if(!tab)return;
 const key=$("bridgeKey").value.trim().toLowerCase();
 if(!/^[0-9a-f]{36}$/.test(key)){status("Save the bridge key before starting.");return;}
 await chrome.storage.local.set({bridgeKey:key});
 let pairs=0,invalid=0;
 for(const sym of SYMBOLS){
   const bid=rows.get(entry(sym,"bid")),ask=rows.get(entry(sym,"ask"));
   if(!bid.selector.value.trim()&&!ask.selector.value.trim())continue;
   if(!bid.selector.value.trim()||!ask.selector.value.trim()){invalid++;continue;}
   const b=await previewField(bid),a=await previewField(ask);
   if(b&&a&&bid.currentValue<ask.currentValue)pairs++;
   else{
     invalid++;
     if(b&&a){
       status("Bid must be below ask for "+sym+". Recheck numeric indices.");
       ask.preview.textContent="Bid >= ask. Check the selected number.";
       ask.preview.className="field-preview bad";
     }
   }
 }
 if(!pairs||invalid){
   status("Resolve invalid or ambiguous bid/ask mappings first. Need at least one verified pair.");return;
 }
 const result=await send({type:"START",tabId:tab.id});
 status(result.ok?"Read-only capture active. Confirm values in Baskets panel.":
   result.error||"Capture failed.",result.ok);
});
$("stop").addEventListener("click",async()=>{
 const result=await send({type:"STOP",tabId:tab?.id});
 status(result.ok?"Capture stopped.":"Could not stop capture.",result.ok);
});
load().catch(error=>status(error.message));
