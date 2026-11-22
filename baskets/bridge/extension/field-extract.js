/*
 * Baskets field extractor. Shared by capture and safe preview.
 * Picks explicit element and number indices; never guesses when ambiguous.
 * No network, eval or interaction with game controls.
 */
(function(root){
"use strict";
const MAX_ELEMENTS=60,MAX_NUMBERS=32;
const numericPattern=/(?<![\w.])[-+\u2212]?\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?![\w.])/g;
const attrPattern=/^(?:aria-[a-z0-9_-]+|data-[a-z0-9_-]+|title|content)$/i;
function tokens(value){
 const text=String(value??"").slice(0,8000);
 const found=[];
 for(const match of text.matchAll(numericPattern)){
   const cleaned=match[0].replace(/[$,\s]/g,"").replace(/\u2212/g,"-");
   const n=Number(cleaned);
   if(Number.isFinite(n))found.push(n);
   if(found.length>=MAX_NUMBERS)break;
 }
 return found;
}
function ruleOf(raw){
 if(typeof raw==="string")return raw.trim()?{selector:raw.trim()}:null;
 if(!raw||typeof raw!=="object")return null;
 const selector=String(raw.selector??"").trim().slice(0,500);
 if(raw.mode==="symbol"){
   const symbol=String(raw.symbol||"").toUpperCase();
   const field=String(raw.field||"");
   const rowSelector=String(raw.rowSelector??"").trim().slice(0,500);
   const source=["auto","label","header","selector"].includes(raw.source)?raw.source:"auto";
   if(!SYMBOLS.includes(symbol)||!Object.hasOwn(FIELD_LABELS,field))return null;
   if(source==="selector"&&!selector)return null;
   const attribute=String(raw.attribute??"").trim().slice(0,70);
   return {mode:"symbol",symbol,field,rowSelector,source,selector,
     ...(attrPattern.test(attribute)?{attribute}:{})};
 }
 if(!selector)return null;
 const numberIndex=Number.isInteger(raw.numberIndex)&&raw.numberIndex>=0?raw.numberIndex:null;
 const elementIndex=Number.isInteger(raw.elementIndex)&&raw.elementIndex>=0?raw.elementIndex:null;
 const attribute=String(raw.attribute??"").trim().slice(0,70);
 return {selector,...(numberIndex!==null?{numberIndex}:{}),
   ...(elementIndex!==null?{elementIndex}:{}),
   ...(attrPattern.test(attribute)?{attribute}:{})};
}
function isVisible(element){
 if(typeof element.getClientRects==="function" && !element.getClientRects().length)return false;
 if(typeof element.closest==="function" && element.closest("[hidden],[aria-hidden=true]"))return false;
 return true;
}
function readText(node,rule){
 if(rule.attribute)return node.getAttribute?.(rule.attribute)??"";
 if("value" in node && node.value!==undefined && String(node.value).trim())return node.value;
 if(typeof node.innerText==="string" && node.innerText.trim())return node.innerText;
 const fromText=node.textContent??"";
 if(String(fromText).trim())return fromText;
 return node.getAttribute?.("aria-label")??node.getAttribute?.("title")??"";
}

const SYMBOLS=["GRID","CURE","SAFE"];
const FIELD_LABELS={
 bid:["best bid","bid","buy price"],
 ask:["best ask","ask","offer","sell price"],
 bidSize:["bid size","bid qty","buy size","buy qty"],
 askSize:["ask size","ask qty","offer size","sell size"],
 position:["position","inventory","pos"],
 openBuys:["open buys","working buys"],
 openSells:["open sells","working sells"]
};
function symbolSet(value){
 const match=String(value??"").toUpperCase().match(/\b(?:GRID|CURE|SAFE)\b/g)||[];
 return [...new Set(match)];
}
function recognizedRowSymbol(node){
 const identifiers=["data-symbol","data-instrument","data-ticker"];
 for(const attribute of identifiers){
   const value=node.getAttribute?.(attribute);
   if(value!=null){
     const symbols=symbolSet(value);
     if(symbols.length===1)return symbols[0];
     if(symbols.length>1)return null;
   }
 }
 const text=readText(node,{});
 const symbols=symbolSet(text.slice(0,2000));
 return symbols.length===1?symbols[0]:null;
}
function readFieldByLabel(row,field){
 const names=FIELD_LABELS[field]||[];
 if(!names.length)return {error:"Unsupported field label"};
 const all=Object.entries(FIELD_LABELS).flatMap(([key,labels])=>
   labels.map(label=>({key,label}))).sort((a,b)=>b.label.length-a.label.length);
 const raw=String(readText(row,{})).slice(0,2500);
 // Disambiguate bid versus bid-size using the longest known label first.
 const matches=[];
 const reg=/\b(?:best\s+bid|best\s+ask|buy\s+price|sell\s+price|bid\s+size|bid\s+qty|ask\s+size|ask\s+qty|buy\s+size|buy\s+qty|offer\s+size|sell\s+size|open\s+buys|open\s+sells|working\s+buys|working\s+sells|position|inventory|offer|bid|ask|pos)\b/gi;
 for(const m of raw.matchAll(reg)){
   const label=m[0].toLowerCase().replace(/\s+/g," ");
   const hit=all.find(x=>x.label===label);
   if(hit)matches.push({field:hit.key,index:m.index,end:m.index+m[0].length});
 }
 const values=[];
 for(let i=0;i<matches.length;i++){
   if(matches[i].field!==field)continue;
   const chunk=raw.slice(matches[i].end,matches[i+1]?.index??raw.length);
   const numbers=tokens(chunk);
   if(numbers.length===1)values.push(numbers[0]);
   else return {error:"Label has zero or several numbers. Choose a scoped selector or table header."};
 }
 return values.length===1?{value:values[0]}:
   {error:values.length?"Field label appears more than once":"Field label not found in this symbol row"};
}
function readFieldByHeader(row,field){
 const table=row.closest?.("table");
 if(!table)return {error:"Table header not available"};
 const headings=Array.from(table.querySelectorAll("thead th, thead [role=columnheader]"));
 if(!headings.length)return {error:"No visible table column headings"};
 const aliases=FIELD_LABELS[field]||[];
 const positions=headings.flatMap((cell,index)=>{
   const label=String(readText(cell,{})).trim().toLowerCase().replace(/\s+/g," ");
   return aliases.includes(label)?[index]:[];
 });
 if(positions.length!==1)return {error:"Table heading missing or ambiguous"};
 const cells=Array.from(row.children||[]).filter(x=>
   /^(TD|TH)$/i.test(x.tagName||"")||x.getAttribute?.("role")==="cell");
 const cell=cells[positions[0]];
 if(!cell)return {error:"Table cell missing for selected header"};
 const values=tokens(readText(cell,{}));
 return values.length===1?{value:values[0]}:{error:"Table cell contains ambiguous numbers"};
}
function previewLocked(rule,doc,ctx){
 const symbol=ctx?.sym??ctx?.symbol??rule.symbol;
 const field=ctx?.field??rule.field;
 if(!SYMBOLS.includes(symbol)||!Object.hasOwn(FIELD_LABELS,field))
   return {ok:false,error:"Select a valid symbol and field",elements:0,values:[]};
 if(rule.symbol&&rule.symbol!==symbol)
   return {ok:false,error:"Saved symbol does not match this field mapping",elements:0,values:[]};
 const selector=String(rule.rowSelector||"tr,[role=row],[data-symbol],[data-instrument],[data-ticker],.market-row,.quote-row").slice(0,500);
 let rows;
 try{rows=Array.from(doc.querySelectorAll(selector)).filter(isVisible);}
 catch{return {ok:false,error:"Invalid symbol row selector",elements:0,values:[]};}
 if(rows.length>250)return {ok:false,error:"Too many candidate rows. Use a narrower Row CSS selector.",elements:rows.length,values:[]};
 const matches=rows.filter(row=>recognizedRowSymbol(row)===symbol);
 // Nested wrapper and child both match? Keep deepest row only, and never pick
 // a parent containing more than one recognized symbol.
 const unique=matches.filter(row=>!matches.some(other=>other!==row&&row.contains?.(other)));
 if(unique.length!==1){
   return {ok:false,error:unique.length?
     "More than one "+symbol+" row matches. Narrow Row CSS selector.":
     "No visible row uniquely identifies "+symbol+".",
     elements:rows.length,matchedRows:unique.length,values:[]};
 }
 const row=unique[0];
 let found;
 const mode=rule.source||"auto";
 if(mode==="label")found=readFieldByLabel(row,field);
 else if(mode==="header")found=readFieldByHeader(row,field);
 else if(mode==="selector"){
   const childSel=rule.selector;
   if(!childSel)return {ok:false,error:"Enter a Field CSS selector within the symbol row",elements:1,values:[]};
   let nodes;
   try{nodes=Array.from(row.querySelectorAll(childSel)).filter(isVisible);}
   catch{return {ok:false,error:"Invalid field CSS selector",elements:1,values:[]};}
   if(nodes.length!==1)return {ok:false,error:nodes.length?
     "Several field elements match within "+symbol+" row":"Field selector not found in "+symbol+" row",
     elements:nodes.length,values:[]};
   const numbers=tokens(readText(nodes[0],rule));
   found=numbers.length===1?{value:numbers[0]}:{error:"Field element has multiple numbers. Use label or header mode."};
 }else if(mode==="auto"){
   const label=readFieldByLabel(row,field),header=readFieldByHeader(row,field);
   if(label.value!==undefined&&header.value!==undefined&&label.value!==header.value)
     found={error:"Label and table header disagree. Choose and verify one method."};
   else if(label.value!==undefined)found=label;
   else if(header.value!==undefined)found=header;
   else found={error:"No unambiguous label or header for "+field+". Choose a scoped Field CSS selector."};
 }else return {ok:false,error:"Unknown dynamic field method",elements:1,values:[]};
 if(found.value===undefined)return {ok:false,error:found.error||"No unambiguous value",elements:1,values:[]};
 return {ok:true,value:found.value,values:[found.value],elements:1,
   mode:"symbol",lockedSymbol:symbol,field,source:mode};
}

function preview(raw,scope,context){
 const rule=ruleOf(raw);
 if(!rule)return {ok:false,error:"No selector saved",values:[],elements:0};
 const doc=scope||root.document;
 if(rule.mode==="symbol")return previewLocked(rule,doc,context);
 let nodes;
 try{
   nodes=Array.from(doc.querySelectorAll(rule.selector)).filter(isVisible);
 }catch{
   return {ok:false,error:"Invalid CSS selector",values:[],elements:0};
 }
 if(nodes.length>MAX_ELEMENTS)return {ok:false,error:"Selector matches too many elements. Choose a more specific selector.",values:[],elements:nodes.length};
 if(!nodes.length)return {ok:false,error:"No visible matches",values:[],elements:0};
 const elementIndex=rule.elementIndex??(nodes.length===1?0:null);
 if(elementIndex===null)return {ok:false,
   error:"Multiple elements match. Enter which element (#).",values:[],elements:nodes.length,
   elementOptions:nodes.slice(0,12).map((node,i)=>({index:i,values:tokens(readText(node,rule)).slice(0,4)}))
 };
 if(elementIndex>=nodes.length)return {ok:false,error:"Selected element # is no longer present",values:[],elements:nodes.length};
 const values=tokens(readText(nodes[elementIndex],rule));
 if(!values.length)return {ok:false,error:"No numeric value in selected element",values:[],elements:nodes.length};
 const numberIndex=rule.numberIndex??(values.length===1?0:null);
 if(numberIndex===null)return {ok:false,error:"Multiple numbers in this element. Enter which number (#).",values,elements:nodes.length,elementIndex};
 if(numberIndex>=values.length)return {ok:false,error:"Selected number # is no longer present",values,elements:nodes.length,elementIndex};
 return {ok:true,value:values[numberIndex],values,elements:nodes.length,elementIndex,numberIndex};
}

function suggestSymbolRule(target,symbol,field,doc){
 if(!target||!SYMBOLS.includes(symbol)||!Object.hasOwn(FIELD_LABELS,field))
   return {rule:null,error:"Invalid picked element or field."};
 const document=doc||root.document;
 let node=target;
 for(let depth=0;node&&depth<14;node=node.parentElement,depth++){
   if(node===document.body||node===document.documentElement)break;
   if(!node.contains?.(target)||recognizedRowSymbol(node)!==symbol)continue;
   const selectors=[];
   const tag=String(node.localName||node.tagName||"").toLowerCase();
   if(tag==="tr")selectors.push("tr");
   if(node.getAttribute?.("role")==="row")selectors.push('[role="row"]');
   for(const attr of ["data-symbol","data-instrument","data-ticker"]){
     if(node.hasAttribute?.(attr))selectors.push("["+attr+"]");
   }
   const names=String(node.className||"").split(/\s+/).filter(x=>
     /^[a-zA-Z][\w-]{1,50}$/.test(x) && /(?:row|quote|market|instrument|ticker|contract|asset|symbol)/i.test(x));
   for(const name of names.slice(0,3))selectors.push("."+root.CSS.escape(name));
   for(const rowSelector of [...new Set(selectors)]){
     const rule={mode:"symbol",symbol,field,rowSelector,source:"auto",selector:""};
     let result=preview(rule,document,{symbol,field});
     if(result.ok)return {rule,verified:true};
     const attrs=["data-field","data-testid","aria-label"];
     let candidate=target;
     for(let j=0;candidate&&candidate!==node&&j<4;candidate=candidate.parentElement,j++){
       const guesses=[];
       for(const attr of attrs){
         const value=candidate.getAttribute?.(attr);
         if(value && value.length<120)guesses.push("["+attr+'="'+root.CSS.escape(value)+'"]');
       }
       const classes=String(candidate.className||"").split(/\s+/).filter(c=>
         /^[a-zA-Z][\w-]{1,50}$/.test(c));
       for(const cls of classes.slice(0,3))guesses.push("."+root.CSS.escape(cls));
       for(const sel of guesses){
         let matches=[];
         try{matches=Array.from(node.querySelectorAll(sel)).filter(isVisible);}
         catch{}
         if(matches.length!==1||!matches[0].contains?.(target))continue;
         const childRule={...rule,source:"selector",selector:sel};
         result=preview(childRule,document,{symbol,field});
         if(result.ok)return {rule:childRule,verified:true};
       }
     }
     // Row matches the correct symbol, but the price field is still ambiguous.
     // Save the symbol binding so the user can pick label/header/scoped selector.
     if(result.error!=="No visible row uniquely identifies "+symbol+".")
       return {rule,verified:false,error:result.error};
   }
 }
 return {rule:null,verified:false,error:
   "Could not identify a stable instrument row containing "+symbol+
   ". Use a symbol row CSS selector manually, or the legacy absolute selector."};
}

root.__BasketsFieldExtractor=Object.freeze({preview,ruleOf,tokens,symbolSet,recognizedRowSymbol,suggestSymbolRule});
})(typeof globalThis!=="undefined"?globalThis:this);
