import {SYMBOLS,SPECS,validPrice} from "./engine.js";
export const FIELDS=["bid","ask","bidSize","askSize","position","workingBuys","workingSells"];
const integer=x=>Number.isSafeInteger(Number(x));
const value=(field,raw,sym)=>{
  if(raw===undefined||raw===null||raw==="")return null;
  const n=Number(raw);
  if(!Number.isFinite(n))return null;
  if(field==="bid"||field==="ask")return validPrice(sym,n)?String(n):null;
  if(field==="position")return integer(n)&&Math.abs(n)<=500?String(n):null;
  return integer(n)&&n>=0&&n<=1e7?String(n):null;
};
export function sanitizeMarketSnapshot(input){
 if(!input||typeof input!=="object"||!input.books||typeof input.books!=="object")return null;
 const books={};
 for(const sym of SYMBOLS){
  const raw=input.books[sym];if(!raw||typeof raw!=="object")continue;
  const row={};
  for(const f of FIELDS){const v=value(f,raw[f],sym);if(v!==null)row[f]=v;}
  if(row.bid!==undefined&&row.ask!==undefined&&Number(row.bid)>=Number(row.ask))continue;
  if(Object.keys(row).length)books[sym]=row;
 }
 if(!Object.keys(books).length)return null;
 const host=typeof input.host==="string"&&/^[a-z0-9.-]{1,200}$/i.test(input.host)?input.host:"unknown";
 return {books,host};
}
export function mergeMarketSnapshot(books,input){
 const clean=sanitizeMarketSnapshot(input);
 if(!clean)return {books,changed:0,updatedSymbols:[]};
 const next={...books},updatedSymbols=[];
 for(const sym of SYMBOLS){
  const fields=clean.books[sym];if(!fields)continue;
  const old=books[sym]||{},same=Object.entries(fields).every(([k,v])=>String(old[k]??"")===v);
  if(same)continue;
  next[sym]={...old,...fields};
  // Any captured external position can differ from fill-derived inventory.
  if(fields.position!==undefined)next[sym].ledgerComplete=false;
  updatedSymbols.push(sym);
 }
 return {books:next,changed:updatedSymbols.length,updatedSymbols};
}
