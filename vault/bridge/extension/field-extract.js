/*
 * Vault field extractor. Shared by capture and safe preview.
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
function preview(raw,scope){
 const rule=ruleOf(raw);
 if(!rule)return {ok:false,error:"No selector saved",values:[],elements:0};
 const doc=scope||root.document;
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
root.__VaultFieldExtractor=Object.freeze({preview,ruleOf,tokens});
})(typeof globalThis!=="undefined"?globalThis:this);
