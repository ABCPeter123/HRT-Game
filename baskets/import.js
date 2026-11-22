/* Format-strict Baskets import. Never guesses unlabeled event-bot flow. */
import { SYMBOLS,optionalNumber,tickValid,MAX_POSITION } from "./engine.js";
export const MARKET_FIELDS=["bid","ask","bidSize","askSize","position","openBuys","openSells"];
const PRICE_KEYS=new Set(["bid","ask"]);
const COUNT_KEYS=new Set(["bidSize","askSize","openBuys","openSells"]);
const FIELD_LABELS={
  bid:"bid",bestbid:"bid",buyprice:"bid",
  ask:"ask",bestask:"ask",offer:"ask",sellprice:"ask",
  bidsize:"bidSize",bidqty:"bidSize",buyqty:"bidSize",
  asksize:"askSize",askqty:"askSize",sellqty:"askSize",
  pos:"position",position:"position",inventory:"position",
  openbuys:"openBuys",workingbuys:"openBuys",
  opensells:"openSells",workingsells:"openSells"
};
function normalizeNumeric(input){
  if(typeof input==="number")return Number.isFinite(input)?input:null;
  const raw=String(input??"").trim().replace(/[$,]/g,"").replace(/\u2212/g,"-");
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw))return null;
  return Number(raw);
}
export function validateMarketValue(field,value){
  if(!MARKET_FIELDS.includes(field))return false;
  const n=normalizeNumeric(value);
  if(n===null)return false;
  if(PRICE_KEYS.has(field))return tickValid(n);
  if(field==="position")return Number.isInteger(n)&&Math.abs(n)<=MAX_POSITION;
  return COUNT_KEYS.has(field) && Number.isSafeInteger(n)&&n>=0;
}
export function validateMarketUpdate(data){
  if(!data||typeof data!=="object"||Array.isArray(data))return null;
  const out={};
  for(const field of MARKET_FIELDS){
    if(!Object.prototype.hasOwnProperty.call(data,field)||
      data[field]===""||data[field]===null||data[field]===undefined)continue;
    if(!validateMarketValue(field,data[field]))return null;
    out[field]=String(normalizeNumeric(data[field]));
  }
  if(!Object.keys(out).length)return null;
  if(out.bid!==undefined&&out.ask!==undefined&&Number(out.bid)>=Number(out.ask))return null;
  return out;
}
export function sanitizeMarketSnapshot(raw){
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;
  const books={};
  for(const sym of SYMBOLS){
    const fields=raw.books?.[sym];
    if(fields===undefined)continue;
    const valid=validateMarketUpdate(fields);
    if(valid)books[sym]=valid;
  }
  return Object.keys(books).length?{books}:null;
}
const trimLabels=line=>line.replace(/\u2212/g,"-").replace(/[|;\t]/g," ").trim();
function parseOne(line){
  const normalized=trimLabels(line);
  const symMatch=normalized.match(/^\s*(GRID|CURE|SAFE)\s*[:,]?\s*/i);
  if(!symMatch)return null;
  const sym=symMatch[1].toUpperCase();
  const remaining=normalized.slice(symMatch[0].length).trim();
  if(!remaining)return {sym,error:"Missing quote values"};
  let fields={};
  // Supports explicit 'bid: 399.5 ask: 400.5 pos: -20' labels.
  const named=/(best[\s_-]*bid|best[\s_-]*ask|bid[\s_-]*size|ask[\s_-]*size|open[\s_-]*buys|open[\s_-]*sells|position|inventory|offer|bid|ask|pos)\s*[:=]?\s*([$+\-.\d,]+)/ig;
  for(const match of remaining.matchAll(named)){
    const key=FIELD_LABELS[match[1].toLowerCase().replace(/[\s_-]/g,"")];
    if(key)fields[key]=match[2];
  }
  if(!Object.keys(fields).length){
    // Plain 3-column format: SYMBOL BID ASK [BIDSIZE ASKSIZE POSITION].
    const tokens=remaining.replace(/[,$]/g," ").split(/\s+/).filter(Boolean);
    if(![2,5,7].includes(tokens.length))
      return {sym,error:"Use SYMBOL BID ASK or SYMBOL BID ASK BIDSIZE ASKSIZE POSITION [OPENBUYS OPENSELLS]."};
    const names=tokens.length===2?["bid","ask"]:
      tokens.length===5?["bid","ask","bidSize","askSize","position"]:
      ["bid","ask","bidSize","askSize","position","openBuys","openSells"];
    fields=Object.fromEntries(names.map((key,index)=>[key,tokens[index]]));
  }
  const valid=validateMarketUpdate(fields);
  if(!valid)return {sym,error:"Invalid price, crossed market, or out-of-range count"};
  if((valid.bid===undefined)!==(valid.ask===undefined))
    return {sym,error:"Quote imports need both best bid and best ask"};
  return {sym,fields:valid};
}
export function parseMarketText(text){
  const updates={},errors=[];
  const lines=String(text??"").trim().split(/\r?\n/).slice(0,40);
  for(const [index,line] of lines.entries()){
    if(!line.trim())continue;
    if(/^\s*(?:symbol|basket|instrument)\s*[,|\t ]+\s*(?:best\s+)?bid\b/i.test(line))continue;
    const parsed=parseOne(line);
    if(!parsed){errors.push("Line "+(index+1)+": expected GRID, CURE or SAFE at start");continue;}
    if(parsed.error){errors.push("Line "+(index+1)+" ("+parsed.sym+"): "+parsed.error);continue;}
    if(updates[parsed.sym]){errors.push("Line "+(index+1)+": duplicate "+parsed.sym);continue;}
    updates[parsed.sym]=parsed.fields;
  }
  return {updates,errors,found:Object.keys(updates).length,
    valid:errors.length===0&&Object.keys(updates).length>0};
}
export function mergeMarketSnapshot(books,snapshot){
  const safe=sanitizeMarketSnapshot(snapshot);
  if(!safe)return {books,changed:0,updatedSymbols:[]};
  const next={...books},updated=[];
  for(const sym of SYMBOLS){
    const fields=safe.books[sym];
    if(!fields)continue;
    // Missing selectors do not wipe previously recorded values.
    const existing=books[sym]||{};
    const identical=Object.entries(fields).every(([key,val])=>String(existing[key]??"")===val);
    if(identical)continue;
    const overridePosition=fields.position!==undefined&&
      String(existing.position??"0")!==fields.position;
    next[sym]={...existing,...fields,...(overridePosition?{ledgerComplete:false}:{})};
    updated.push(sym);
  }
  return {books:next,changed:updated.length,updatedSymbols:updated};
}
