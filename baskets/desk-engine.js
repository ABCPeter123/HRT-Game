/*
 * Game 2 execution-desk workflow. Pure state transitions, no exchange API.
 * "Called" means copied/saved locally, never proof that the teammate received it.
 * Status reports are cumulative to make repeated messages idempotent.
 */
import {SYMBOLS,capacities,tickValid,validateBook,finite} from "./engine.js";
export const STATUSES=["CALLED","ACK","WORKING","PARTIAL","FILLED","CANCELLED","REJECTED"];
export const CLASSIFICATIONS=["suspected","confirmed","tape","reviewed","dismissed"];
export function emptyDesk(){return {calls:[],alerts:[],audit:[],nextCall:1,nextAlert:1};}
const positiveInteger=x=>Number.isSafeInteger(Number(x))&&Number(x)>0;
const cents=x=>Math.round(Number(x)*100)/100;
export function createCall(desk,action,roundNumber,at=Date.now()){
  if(!action||!SYMBOLS.includes(action.symbol)||!["BUY","SELL"].includes(action.side)||
     !positiveInteger(action.qty)||!tickValid(Number(action.price))||
     !["TAKE","MAKE"].includes(action.kind))
    throw new Error("No valid recommendation to send.");
  const seq=Math.max(1,Number.isSafeInteger(desk.nextCall)?desk.nextCall:1);
  const call={id:"R"+roundNumber+"-"+String(seq).padStart(3,"0"),
    symbol:action.symbol,side:action.side,kind:action.kind,
    qty:Number(action.qty),price:Number(action.price),
    status:"CALLED",filledQty:0,filledNotional:0,avgFill:null,
    reserved:0,createdAt:at,updatedAt:at};
  return {desk:{...desk,nextCall:seq+1,calls:[...(desk.calls||[]),call].slice(-70)},call};
}
export function teammateCallText(call){
  return call.id+" | "+call.side+" "+call.qty+" "+call.symbol+
    " LIMIT @ "+call.price.toFixed(2)+" ("+(call.kind==="TAKE"?"marketable":"passive")+")"+
    " | Reply: "+call.id+" WORKING, or "+call.id+
    " PARTIAL <cumulative shares> @ <cumulative average price>, or "+
    call.id+" FILLED <total shares> @ <average price>, or "+call.id+" CANCELLED/REJECTED.";
}
export function parseTeammateStatus(text){
  const input=String(text??"").trim().toUpperCase().replace(/\s+/g," ");
  const m=input.match(/^(R[1-3]-\d{3,})\s*(?:\||:)?\s*(ACK|WORKING|PLACED|PARTIAL|FILLED|CANCELLED|CANCELED|REJECTED)(?:\s+(\d+)\s*(?:@|AT)\s*(\d+(?:\.\d{1,4})?))?$/);
  if(!m)throw new Error("Use R1-001 WORKING, R1-001 PARTIAL 5 @ 400.50, or R1-001 FILLED 20 @ 400.50.");
  const status=m[2]==="PLACED"?"WORKING":m[2]==="CANCELED"?"CANCELLED":m[2];
  if(["PARTIAL","FILLED"].includes(status)&&(!m[3]||!m[4]))
    throw new Error("Partial and filled reports require cumulative quantity and average price.");
  if(!["PARTIAL","FILLED"].includes(status)&&m[3])
    throw new Error("Only partial/filled reports can carry fill quantities.");
  return {id:m[1],status,qty:m[3]===undefined?null:Number(m[3]),
    price:m[4]===undefined?null:Number(m[4])};
}
/**
 * Build a status response with clicks instead of typed command syntax.
 * Never infer an execution price from a limit: callers must supply the
 * actual cumulative average price, or explicitly choose their limit.
 */
export function composeQuickReply(call,{status,qty=null,price=null}={}){
  if(!call||!/^R[1-3]-\d{3,}$/.test(call.id))
    throw new Error("Choose a queued order first.");
  if(["FILLED","CANCELLED","REJECTED"].includes(call.status))
    throw new Error("This order is already closed.");
  const allowed=["ACK","WORKING","PARTIAL","FILLED","CANCELLED","REJECTED"];
  if(!allowed.includes(status))throw new Error("Choose a status button.");
  if(status==="ACK"&&!["CALLED","ACK"].includes(call.status))
    throw new Error("The order has already advanced beyond ACK.");
  if(status==="WORKING"&&(call.filledQty||0)>0)
    throw new Error("An order with fills stays PARTIAL until complete or cancelled.");
  if(status==="REJECTED"&&(call.filledQty||0)>0)
    throw new Error("After a partial fill, cancel only the unfilled remainder.");
  const filling=["PARTIAL","FILLED"].includes(status);
  let message=call.id+" "+status;
  if(filling){
    const shares=Number(qty),average=Number(price);
    if(!Number.isSafeInteger(shares)||shares<=0||!Number.isFinite(average)||
       price===null||price===""||average<0||average>800)
      throw new Error("Choose cumulative filled shares and confirm the actual average fill price.");
    if(shares<(call.filledQty||0))
      throw new Error("Cumulative filled shares cannot decrease.");
    if(shares>call.qty)throw new Error("Quantity exceeds the original order size.");
    if(status==="PARTIAL"&&shares>=call.qty)
      throw new Error("Use FILLED when all shares executed.");
    if(status==="FILLED"&&shares!==call.qty)
      throw new Error("FILLED must include all requested shares.");
    message+=" "+shares+" @ "+average.toFixed(2);
  }
  return {text:message,update:parseTeammateStatus(message)};
}
function checkedBookValue(book,key){return Number.isFinite(Number(book[key]))?Number(book[key]):0;}
export function updateCall(book,call,update,{livePosition=false,liveOrders=false,at=Date.now()}={}){
  if(!call||!STATUSES.includes(call.status)||!STATUSES.includes(update?.status))
    throw new Error("Unknown order or execution status.");
  const priorStatus=call.status, status=update.status;
  if(["FILLED","CANCELLED","REJECTED"].includes(priorStatus) &&
    !(priorStatus===status && (update.qty===null||Number(update.qty)===call.filledQty)))
    throw new Error("This order is closed. Do not apply a new fill.");
  let filled=call.filledQty||0,notional=call.filledNotional||0;
  if(status==="PARTIAL"||status==="FILLED"){
    if(!positiveInteger(update.qty)||!Number.isFinite(update.price)||
       update.price<0||update.price>800)
      throw new Error("Enter the cumulative filled shares and average fill price.");
    if(update.qty<filled||update.qty>call.qty)
      throw new Error("Filled shares cannot decrease or exceed the requested order size.");
    if(status==="PARTIAL"&&update.qty===call.qty)
      throw new Error("Use FILLED when the entire order was executed.");
    if(status==="FILLED"&&update.qty!==call.qty)
      throw new Error("FILLED requires the full requested quantity. Use PARTIAL for less.");
    filled=Number(update.qty);notional=cents(filled*Number(update.price));
    if(notional+0.001<(call.filledNotional||0))
      throw new Error("Cumulative executed notional cannot decrease.");
    if(filled===(call.filledQty||0)&&Math.abs(notional-(call.filledNotional||0))>0.009)
      throw new Error("Same cumulative fill size has a different average price. Verify the report.");
  }else if((update.qty??null)!==null||(update.price??null)!==null){
    throw new Error("This status cannot include fill quantities.");
  }
  if(status==="ACK" && ["WORKING","PARTIAL"].includes(priorStatus))
    throw new Error("Already working. ACK would erase a confirmed order status.");
  if(status==="WORKING" && filled>0)
    throw new Error("Use PARTIAL to keep a partially executed order working.");
  if(status==="REJECTED" && filled>0)
    throw new Error("Use CANCELLED for the unfilled remainder of a partially executed order.");
  if(status==="CALLED" && priorStatus!=="CALLED")throw new Error("Cannot roll back an accepted order.");
  const deltaFilled=filled-(call.filledQty||0);
  const deltaNotional=cents(notional-(call.filledNotional||0));
  const next={...book};
  const signed=call.side==="BUY"?1:-1;
  if(deltaFilled>0){
    if(!livePosition){
      const nextPos=checkedBookValue(book,"position")+signed*deltaFilled;
      if(Math.abs(nextPos)>1000)throw new Error("Reported fill exceeds the ±1000 position limit.");
      next.position=String(nextPos);
      next.cash=String(cents(checkedBookValue(book,"cash")-signed*deltaNotional));
    }else next.ledgerComplete=false;
  }
  const active=["WORKING","PARTIAL"].includes(status);
  const desiredReserve=active?call.qty-filled:0;
  const oldReserve=liveOrders?0:call.reserved||0;
  if(!liveOrders){
    const key=call.side==="BUY"?"openBuys":"openSells";
    const count=checkedBookValue(book,key)-oldReserve+desiredReserve;
    if(count<0)throw new Error("Working-order totals were edited externally. Reconcile them before updating.");
    next[key]=String(count);
    const max=capacities(next);
    if(!max.valid||checkedBookValue(next,"position")+checkedBookValue(next,"openBuys")>1000||
      checkedBookValue(next,"position")-checkedBookValue(next,"openSells")< -1000)
      throw new Error("Reported working order would exceed the worst-case ±1000 limit.");
  }
  const nextCall={...call,status,filledQty:filled,filledNotional:notional,
    avgFill:filled?cents(notional/filled):null,
    reserved:liveOrders?0:desiredReserve,updatedAt:at};
  // Identical status reports should not change the fill journal or cash.
  return {book:next,call:nextCall,fillDelta:deltaFilled,notionalDelta:deltaNotional,
    changed:status!==priorStatus||deltaFilled!==0||Math.abs(deltaNotional)>0.009};
}
export function observeRepricing(previous,{symbol,book,at=Date.now(),
 thresholdTicks=3,windowMs=20000,cooldownMs=8000}={}){
  const quote=validateBook(book);
  if(!SYMBOLS.includes(symbol)||!quote.valid)
    return {state:previous||null,alert:null};
  const mid=quote.mid;
  if(!previous||!Number.isFinite(previous.anchorMid)||at<previous.anchorAt){
    return {state:{anchorMid:mid,anchorAt:at,lastMid:mid,lastAt:at,lastAlertAt:0},alert:null};
  }
  if(Math.abs(mid-previous.anchorMid)<1e-9)
    return {state:{...previous,lastMid:mid,lastAt:at},alert:null};
  if(at-previous.anchorAt>windowMs){
    return {state:{...previous,anchorMid:mid,anchorAt:at,lastMid:mid,lastAt:at},alert:null};
  }
  const movement=mid-previous.anchorMid;
  const threshold=Math.max(1,Math.round(thresholdTicks))*0.5;
  if(Math.abs(movement)+1e-9<threshold)
    return {state:{...previous,lastMid:mid,lastAt:at},alert:null};
  if(previous.lastAlertAt && at-previous.lastAlertAt<cooldownMs)
    return {state:{...previous,anchorMid:mid,anchorAt:at,lastMid:mid,lastAt:at},alert:null};
  const alert={symbol,from:previous.anchorMid,to:mid,delta:movement,
    direction:Math.sign(movement),at,windowMs:at-previous.anchorAt,status:"PENDING",
    classification:null,volume:null};
  return {state:{anchorMid:mid,anchorAt:at,lastMid:mid,lastAt:at,lastAlertAt:at},alert};
}
export function addPriceAlert(desk,raw,roundNumber){
  if(!raw||!SYMBOLS.includes(raw.symbol)||!Number.isFinite(raw.delta)||raw.delta===0)
    throw new Error("An alert needs a confirmed quote change.");
  const n=Math.max(1,Number.isSafeInteger(desk.nextAlert)?desk.nextAlert:1);
  const alert={...raw,id:"R"+roundNumber+"-A"+String(n).padStart(3,"0"),
    status:"PENDING",classification:null,volume:null};
  return {desk:{...desk,nextAlert:n+1,alerts:[...(desk.alerts||[]),alert].slice(-60)},alert};
}
export function classifyPriceAlert(alert,kind,{direction=null,volume=null,at=Date.now()}={}){
 if(!alert||alert.status!=="PENDING"||!CLASSIFICATIONS.includes(kind))
   throw new Error("This alert is already reviewed or has an invalid classification.");
 if(kind==="reviewed"||kind==="dismissed")
   return {...alert,status:"REVIEWED",classification:kind,volume:null,reviewedAt:at};
 if(!positiveInteger(volume)||![-1,1].includes(direction))
   throw new Error("Enter observed trade shares and select BUY or SELL. Price movement alone does not prove event volume.");
 return {...alert,status:"REVIEWED",classification:kind,
   volume:Number(volume)*direction,reviewedAt:at};
}
export function pendingAlerts(desk){return (desk.alerts||[]).filter(a=>a.status==="PENDING");}

const ACCOUNTING_FIELDS=["position","cash","openBuys","openSells","ledgerComplete"];
export function accountingSnapshot(book){
 return Object.fromEntries(ACCOUNTING_FIELDS.map(key=>[key,book?.[key]]));
}
export function undoReportedStatus(book,call,audit){
 if(!audit||audit.id!==call?.id||!audit.afterCall||!audit.beforeCall)
   throw new Error("No matching latest teammate status to undo.");
 if(call.status!==audit.afterCall.status||call.filledQty!==audit.afterCall.filledQty||
   call.filledNotional!==audit.afterCall.filledNotional||
   call.updatedAt!==audit.afterCall.updatedAt)
   throw new Error("This call has changed since the report. Cannot safely undo.");
 const current=accountingSnapshot(book);
 for(const key of ACCOUNTING_FIELDS){
   if(String(current[key])!==String(audit.afterLedger?.[key]))
     throw new Error("Inventory or working orders changed since that report. Reconcile the game first.");
 }
 return {call:{...audit.beforeCall},book:{...book,...audit.beforeLedger}};
}
