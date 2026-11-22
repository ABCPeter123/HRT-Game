import {
  SYMBOLS,INDICES,TACTICS,clamp,finite,optionalNumber,emptyBook,emptyFlow,emptyRound,
  capacities,validateBook,impliedIndices,settlement,indexExposure,inventoryStress,
  recommend,applyFill,projectedPnl,signed
} from "./engine.js";
import {parseMarketText,mergeMarketSnapshot} from "./import.js";

const $=id=>document.getElementById(id);
const KEY="quant-comp-baskets-v1";
document.getElementById("reset-game").addEventListener("click",()=>{
  if(!window.confirm("Reset ALL Baskets data? This permanently erases all three rounds, books, event observations, fills and saved settings. This cannot be undone."))return;
  try{localStorage.removeItem(KEY);}
  catch{window.alert("Could not clear saved data. Reset cancelled.");return;}
  window.location.reload();
});
const LABELS={GRID:"TEK + NRG",CURE:"TEK + MED",SAFE:"NRG + MED"};
const GUIDE={
  bid:"Highest visible offer to BUY in the selected basket orderbook. Enter the price, not its size. Tick $0.50, range $0–$800.",
  ask:"Lowest visible offer to SELL in the selected basket orderbook. The ask must be above the bid. Tick $0.50, range $0–$800.",
  bidSize:"Optional displayed size at the current best bid. Used to cap suggestions that would sell immediately into that price. Leave blank if unknown.",
  askSize:"Optional displayed size at the current best ask. Used to cap suggestions that would buy immediately at that price. Leave blank if unknown.",
  position:"Your filled share inventory in this basket. Positive = long; negative = short. Limit ±1,000. Manually changing it invalidates the built-in cash PnL estimate.",
  openBuys:"Total SHARES in all your outstanding, unfilled BUY orders for this basket, not number of orders. Only include still-active orders.",
  openSells:"Total SHARES in all your outstanding, unfilled SELL orders for this basket, not number of orders. Only include still-active orders.",
  capacity:"Worst-case headroom: buy = 1,000 − position − working buys; sell = 1,000 + position − working sells. Both sides are checked separately.",
  trust:"How much of suspected event volume the model counts as genuine event-bot volume. Default 35% is your assumption and not inferred from the packet.",
  risk:"Higher values penalize uncertain fair values and adding to large positions. No slider setting guarantees a maximum loss.",
  maxOrder:"Max shares in ONE recommended limit order. This voluntarily limits order size; the competition permits larger orders if position checks pass."
};
const escape=x=>String(x??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const money=(v,d=2)=>Number.isFinite(v)?"$"+Number(v).toLocaleString("en-CA",{minimumFractionDigits:d,maximumFractionDigits:d}):"—";
const fmt=(v,d=0)=>Number.isFinite(v)?Number(v).toLocaleString("en-CA",{maximumFractionDigits:d}):"—";
const pct=x=>fmt(x*100,0)+"%";
const defaultState=()=>({
  version:1,round:0,selected:"GRID",flowMode:"suspected",
  trust:0.35,risk:0.35,maxOrder:100,fillSide:"BUY",
  rounds:[emptyRound(),emptyRound(),emptyRound()]
});
function load(){
  let raw;
  try{raw=JSON.parse(localStorage.getItem(KEY));}catch{}
  if(!raw||raw.version!==1||!Array.isArray(raw.rounds))return defaultState();
  const clean=defaultState();
  clean.round=clamp(Math.round(finite(raw.round)),0,2);
  clean.selected=SYMBOLS.includes(raw.selected)?raw.selected:"GRID";
  clean.flowMode=["confirmed","suspected","tape"].includes(raw.flowMode)?raw.flowMode:"suspected";
  clean.trust=clamp(finite(raw.trust,0.35),0,1);
  clean.risk=clamp(finite(raw.risk,0.35),0,1);
  clean.maxOrder=clamp(Math.round(finite(raw.maxOrder,100)),1,1000);
  clean.fillSide=raw.fillSide==="SELL"?"SELL":"BUY";
  clean.rounds=Array.from({length:3},(_,i)=>{
    const item=raw.rounds[i]||{},fresh=emptyRound();
    fresh.clock=clamp(finite(item.clock,600),0,600);
    fresh.startingCash=finite(item.startingCash);
    fresh.books=Object.fromEntries(SYMBOLS.map(sym=>[sym,{
      ...emptyBook(),...(item.books?.[sym]||{}),
      ledgerComplete:item.books?.[sym]?.ledgerComplete!==false
    }]));
    fresh.flow=Object.fromEntries(SYMBOLS.map(sym=>[sym,{
      ...emptyFlow(),...(item.flow?.[sym]||{})
    }]));
    fresh.events=Array.isArray(item.events)?item.events.slice(-150).filter(x=>SYMBOLS.includes(x.sym)&&["confirmed","suspected","tape"].includes(x.mode)&&Number.isFinite(x.delta)):[];
    fresh.fills=Array.isArray(item.fills)?item.fills.slice(-200):[];
    fresh.snapshots=Array.isArray(item.snapshots)?item.snapshots.slice(-50):[];
    return fresh;
  });
  return clean;
}
let state=load(),deadline=null,toaster,liveDecision=null,lastComputeTime=0;
let bridgeActive=false,bridgeBusy=false,bridgeSequence=-1;
let capturePositionSymbols=new Set();
const round=()=>state.rounds[state.round];
const book=()=>round().books[state.selected];
const flow=()=>round().flow[state.selected];
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch{}}
function toast(message){
  $("toast").textContent=message;$("toast").classList.add("show");
  clearTimeout(toaster);toaster=setTimeout(()=>$("toast").classList.remove("show"),2400);
}
function elapsed(){
  if(deadline!==null)round().clock=Math.max(0,(deadline-Date.now())/1000);
  return round().clock;
}
function timerRender(){
  const seconds=Math.max(0,Math.ceil(elapsed()));
  $("timerValue").textContent=String(Math.floor(seconds/60)).padStart(2,"0")+":"+String(seconds%60).padStart(2,"0");
  $("timerButton").textContent=deadline===null?"Start":"Pause";
  document.querySelector(".timer").classList.toggle("low",seconds<=60);
}
function chooseRound(index){
  elapsed();deadline=null;
  state.round=clamp(index,0,2);state.selected="GRID";
  bridgeSequence=-1;capturePositionSymbols.clear();
  save();renderAll();
}
function toggleTimer(){
  if(deadline!==null){elapsed();deadline=null;}
  else deadline=Date.now()+round().clock*1000;
  save();timerRender();
}
function resetTimer(){deadline=null;round().clock=600;save();renderAll();}
function metric(label,value){
  return '<div class="data-metric"><span>'+escape(label)+'</span><b>'+escape(value)+'</b></div>';
}
function fields(){
  for(const key of ["bid","ask","bidSize","askSize","position","openBuys","openSells"]){
    $(key).value=book()[key]??"";
  }
  $("maxOrder").value=state.maxOrder;
  $("trustSlider").value=Math.round(state.trust*100);
  $("riskSlider").value=Math.round(state.risk*100);
  $("trustLabel").textContent=pct(state.trust);
  $("riskLabel").textContent=pct(state.risk);
  $("symbolSubtitle").textContent=LABELS[state.selected];
  $("symbolName").textContent=state.selected;
  $("bookGuideText").innerHTML=Object.entries(GUIDE).filter(([key])=>
    ["bid","ask","bidSize","askSize","position","openBuys","openSells","capacity"].includes(key)
  ).map(([key,value])=>'<div class="guide-row"><b>'+escape(key)+'</b><span>'+escape(value)+'</span></div>').join("");
}
function renderSymbols(decision){
  $("symbolButtons").innerHTML=SYMBOLS.map(sym=>{
    const quote=decision.perSymbol[sym];
    const b=round().books[sym];
    const mid=quote.quote?.valid?money(quote.quote.mid):"Add quotes";
    const spread=quote.quote?.valid?"Spread "+money(quote.quote.spread):"Needs bid + ask";
    return '<button type="button" data-symbol="'+sym+'" class="market-button'+(state.selected===sym?' active':'')+'">'+
      '<strong>'+sym+'</strong><span class="smline">'+escape(mid)+'</span><span class="smline'+(quote.valid?"":" bad")+'">'+
      escape(spread)+'</span></button>';
  }).join("");
}
function renderIndices(fair,books){
  const exposure=indexExposure(books);
  $("indexValues").innerHTML=INDICES.map(index=>{
    const changed=fair.delta[index];
    return '<div class="index-card"><b>'+index+'</b><div><strong>'+money(fair.index[index])+'</strong>'+
      '<span>'+((changed>=0?"+":"")+money(changed))+' / exp. '+signed(exposure[index])+'</span></div></div>';
  }).join("");
  const implied=impliedIndices(books);
  $("indexFoot").textContent=implied?
    "Orderbook-implied indices: TEK "+money(implied.TEK)+", NRG "+money(implied.NRG)+", MED "+money(implied.MED)+
    ". Market quotes can differ from settlement expectations.":
    "Settlement starts at $200 per index. Enter all three orderbooks to compare market-implied indices.";
  $("flowConfidenceTag").textContent=state.trust===1?"FULL SUSPECTED-FLOW WEIGHT":
    "SUSPECTED FLOW WEIGHTED "+pct(state.trust);
  $("symbolFair").textContent=money(fair.baskets[state.selected]);
}
function renderFlow(){
  const f=flow();
  $("flowModes").innerHTML=[
    ["suspected","Suspected event"],["confirmed","Confirmed event"],["tape","Public tape"]
  ].map(([mode,label])=>'<button data-mode="'+mode+'" class="'+(state.flowMode===mode?'selected':'')+'">'+label+'</button>').join("");
  $("flowTotals").innerHTML=[
    ["confirmed","Confirmed Q"],["suspected","Suspected Q"],["tape","Public prints"]
  ].map(([mode,label])=>'<div class="flow-stat'+(state.flowMode===mode?' active':'')+'"><span>'+label+
    '</span><b>'+signed(f[mode])+'</b></div>').join("");
  const buttons=[2,10,50,100];
  $("flowNegative").innerHTML=buttons.map(v=>'<button type="button" class="negative" data-flow="'+(-v)+'">−'+v+'</button>').join("");
  $("flowPositive").innerHTML=buttons.map(v=>'<button type="button" class="positive" data-flow="'+v+'">+'+v+'</button>').join("");
  const modeText={
    confirmed:"Confirmed event is used directly by the official settlement equations. Only use it for genuinely identified event-bot trades.",
    suspected:"Suspected event counts only "+pct(state.trust)+" toward the settlement estimate. This category is the default for unlabelled directional bursts.",
    tape:"Public tape changes the market-behavior scenarios only. Customer and market-maker trades do not directly change settlement."
  };
  $("flowExplanation").textContent=modeText[state.flowMode];
  $("undoFlow").disabled=round().events.length===0;
}
function renderBooks(decision){
  const result=decision.perSymbol[state.selected];
  const c=capacities(book());
  $("capacityPreview").textContent="BUY "+fmt(c.buy)+" · SELL "+fmt(c.sell);
  $("bookValidation").textContent=result.valid?
    "Spread "+money(result.quote.spread)+", mid "+money(result.quote.mid):
    result.reason;
  $("bookValidation").classList.toggle("warning",!result.valid);
}
function renderDecision(decision){
  liveDecision=decision;
  const best=decision.best;
  $("decisionConfidence").textContent=best?"MODEL OPPORTUNITY":decision.missing.length?"AWAITING QUOTES":"NO POSITIVE EDGE";
  $("actionTitle").className="big-action "+(best?(best.side==="SELL"?"sell":""):"hold");
  $("actionTitle").textContent=best?best.side+" "+best.symbol:"HOLD";
  $("actionSubtitle").textContent=best?
    (best.kind==="TAKE"?"Marketable LIMIT order at the displayed "+(best.side==="BUY"?"ask.":"bid."):
    "Resting LIMIT order. Fill is not guaranteed.") :
    (decision.missing.length?"Enter valid best bid and ask for any basket to begin.":"No offer has positive estimated risk-adjusted edge. Update orderbooks or event flow.");
  $("actionQuote").innerHTML=best?
    '<div><span class="mini">LIMIT PRICE</span><strong>'+money(best.price,2)+'</strong></div>'+
    '<div><span class="mini">SHARES</span><strong>'+fmt(best.qty)+'</strong></div>':
    '<div><span class="mini">FAIR GRID</span><strong>'+money(decision.fair.baskets.GRID)+'</strong></div>'+
    '<div><span class="mini">FAIR CURE</span><strong>'+money(decision.fair.baskets.CURE)+'</strong></div>';
  $("actionMetrics").innerHTML=best?[
    metric("Mode",best.kind==="TAKE"?"Cross spread":"Post passive"),
    metric("Modeled basket fair",money(best.expectedSettlement)),
    metric("Gross edge / share",money(best.grossEdge)),
    metric("Risk-adjusted edge / share",money(best.unitEdge)),
    metric("Volatility proxy",money(best.uncertainty)),
    metric("Remaining side capacity",fmt(best.capacity))
  ].join(""):[
    metric("Known books",(3-decision.missing.length)+" / 3"),
    metric("Suspected-event weight",pct(state.trust)),
    metric("Position limit","±1,000 / contract"),
    metric("Tick size","$0.50")
  ].join("");
  $("useAction").disabled=!best;$("copyAction").disabled=!best;
  $("actionReason").textContent=best?
    "The suggestion ranks estimated per-share edge, share capacity, uncertainty and an illustrative fill weight. "+
    (best.kind==="TAKE"?
      "Crossing at the best quote is not guaranteed to fill beyond displayed quantity.":
      "Passive limit orders can remain unfilled or get filled when fair value changes.")+
    " Submit orders yourself in the competition app. Do not record a fill until it executes.":
    "No trade is often best when the modeled settlement edge is too small or market data is incomplete. Ordinary tape is not confirmed event-bot flow.";
}
function renderTactics(decision){
  const behavior=decision.tactics;
  $("opponentProfiles").innerHTML=TACTICS.map(t=>{
    const p=behavior.weights[t.id];
    return '<div class="profile"><div class="profile-heading"><span>'+t.name+
      '</span><strong>'+pct(p)+'</strong></div><div class="bar"><div style="width:'+pct(p)+'"></div></div></div>';
  }).join("");
  const dominant=TACTICS.find(t=>t.id===behavior.dominant);
  $("counterInsight").innerHTML='<strong>Counter:</strong> '+escape(dominant.counter);
}
function renderPortfolio(decision){
  const b=round().books,stress=decision.stress;
  const full=SYMBOLS.every(s=>b[s].ledgerComplete!==false);
  const pnl=projectedPnl({books:b,fair:decision.fair,ledgerComplete:full});
  $("portfolioSummary").innerHTML=INDICES.map(ix=>
    '<div class="portfolio-row"><span>'+ix+' index exposure</span><strong>'+signed(stress.exposure[ix])+' shares</strong></div>'
  ).join("")+
    '<div class="portfolio-row"><span>Illustrative loss: ±200 new event Q</span><strong>'+money(stress.worstCaseShockLoss)+'</strong></div>'+
    '<div class="portfolio-row"><span>Marked-to-model trading PnL</span><strong>'+
    (pnl===null?"Unavailable":money(pnl))+'</strong></div>'+
    '<p class="hint" style="margin-top:10px">Stress is the largest loss from one ±200-share event-bot surprise in one basket, not a worst-case loss bound. PnL assumes every filled trade was recorded from zero inventory and the forecast settlement is correct.</p>';
  $("alternatives").innerHTML='<div class="alt-title">OTHER MODELLED ACTIONS</div>'+
    (decision.alternatives.length?decision.alternatives.map(x=>
      '<div class="alt-line"><span>'+escape(x.side+" "+x.symbol+" · "+x.kind)+'</span><b>'+
      fmt(x.qty)+' @ '+money(x.price)+'</b></div>').join(""):
      '<p class="hint">No other candidate clears the estimated risk filter.</p>');
}
function renderFills(){
  const f=round().fills;$("fillsCount").textContent=f.length+" FILLS";
  $("fillSideButtons").innerHTML=["BUY","SELL"].map(side=>
    '<button type="button" class="'+(state.fillSide===side?'selected':'')+'" data-fill-side="'+side+'">'+side+'</button>'
  ).join("");
  $("fillSummary").innerHTML=(f.length?"Recent fills:":"No recorded fills yet.")+
    '<div class="fill-list">'+f.slice(-4).reverse().map((entry,index)=>
      '<div class="fill-item"><span><strong>'+escape(entry.side+" "+entry.sym)+'</strong> '+fmt(entry.qty)+
      ' @ '+money(entry.price)+'</span>'+
      (index===0?'<button id="undoFill" type="button">Undo last</button>':'')+
      '</div>').join("")+'</div>';
}

const QUICK_FIELDS=["bid","ask","position"];
function quickEntryCell(sym,field) {
  const val=round().books[sym]?.[field]??"";
  const isPrice=field!=="position";
  return '<input class="quick-input" aria-label="'+sym+' '+field+'" '+
    'data-quick-sym="'+sym+'" data-quick-field="'+field+'" '+
    'type="number" inputmode="'+(isPrice?"decimal":"numeric")+'" '+
    'step="'+(isPrice?"0.5":"1")+'" '+
    (isPrice?'min="0" max="800"':'min="-1000" max="1000"')+
    ' placeholder="'+(isPrice?"—":"0")+'" value="'+escape(val)+'">';
}
function renderQuickGrid() {
  $("quickBookGrid").innerHTML=
    '<div class="quick-header"><span>BASKET</span><span>BID</span><span>ASK</span><span>POS</span></div>'+
    SYMBOLS.map(sym=>
      '<div class="quick-row"><button type="button" data-symbol="'+sym+
      '" class="quick-symbol'+(state.selected===sym?" selected":"")+'">'+sym+'</button>'+
      QUICK_FIELDS.map(key=>quickEntryCell(sym,key)).join("")+'</div>'
    ).join("");
}
function syncMarketInputs(){
  document.querySelectorAll("[data-quick-sym]").forEach(el=>{
    const s=el.dataset.quickSym,key=el.dataset.quickField;
    const v=String(round().books[s]?.[key]??"");
    if(document.activeElement!==el && el.value!==v)el.value=v;
  });
  document.querySelectorAll(".quick-symbol").forEach(el=>
    el.classList.toggle("selected",el.dataset.symbol===state.selected));
  for(const key of ["bid","ask","bidSize","askSize","position","openBuys","openSells"]){
    const input=$(key),v=String(book()[key]??"");
    if(input&&document.activeElement!==input&&input.value!==v)input.value=v;
  }
}
function previewPastedMarket(){
  const parsed=parseMarketText($("marketPaste").value);
  if(!$("marketPaste").value.trim()){
    $("importPreview").textContent="Paste 1–3 basket rows. No existing value is changed until you click Apply.";
    return parsed;
  }
  const valid=Object.keys(parsed.updates);
  $("importPreview").textContent=parsed.errors.length?
    parsed.errors.slice(0,2).join(" | "):
    "Ready: "+valid.join(", ")+" • "+valid.map(s=>
      s+" "+parsed.updates[s].bid+" / "+parsed.updates[s].ask).join(" • ");
  $("importPreview").classList.toggle("warning",parsed.errors.length>0);
  return parsed;
}
function applyMarketData(snapshot,source){
  // Even an unchanged captured position must be marked as externally sourced,
  // or recording a local fill can double-count real inventory.
  if(source==="bridge"){
    for(const sym of SYMBOLS){
      if(snapshot.books?.[sym]?.position!==undefined)capturePositionSymbols.add(sym);
    }
  }
  const updated=mergeMarketSnapshot(round().books,snapshot);
  if(!updated.changed)return updated;
  if(source!=="bridge"){
    for(const sym of updated.updatedSymbols)capturePositionSymbols.delete(sym);
  }
  round().books=updated.books;save();
  syncMarketInputs();renderDynamic();
  return updated;
}
function applyPastedMarket(){
  const result=previewPastedMarket();
  if(!result.valid){toast(result.errors[0]||"Paste at least one valid market row.");return;}
  const updated=applyMarketData({books:result.updates},"paste");
  if(updated.changed)toast("Updated "+updated.updatedSymbols.join(", ")+".");
  else toast("Those values are already current.");
}
function updateBridgeUI(status,detail,valid=false){
  $("bridgeStatus").textContent=status;
  $("bridgeStatus").classList.toggle("bridge-live",valid);
  $("bridgeDetail").textContent=detail;
}
function bridgeAllowedHere(){
  return location.protocol==="http:"&&["localhost","127.0.0.1"].includes(location.hostname);
}
async function pollBridge(){
  if(!bridgeActive||bridgeBusy)return;
  bridgeBusy=true;
  try{
    const key=$("bridgeKey").value.trim();
    const response=await fetch("http://127.0.0.1:8765/snapshot",{
      cache:"no-store",headers:{"x-bridge-key":key},
      signal:AbortSignal.timeout(1800)
    });
    if(!bridgeActive)return;
    if(!response.ok){
      updateBridgeUI(response.status===401?"BAD KEY":"BRIDGE ERROR",
        "Local server returned status "+response.status+". Check the session key.");
      return;
    }
    const result=await response.json();
    if(result.stale||!result.snapshot){
      updateBridgeUI("AWAITING GAME",
        "Bridge connected, but there is no recent mapped data. Open the competition tab and start the extension.");
      return;
    }
    const age=(result.ageMs/1000).toFixed(1);
    const host=result.snapshot.host||"game page";
    const reported=Object.keys(result.snapshot.books||{});
    const missing=SYMBOLS.filter(s=>!reported.includes(s));
    updateBridgeUI("CAPTURING",
      "Data from "+host+" · "+age+"s old · Updated: "+(reported.join(", ")||"none")+
      (missing.length?" · Not updated: "+missing.join(", ")+" (last recorded values retained).":""),
      true);
    if(result.seq!==bridgeSequence){
      bridgeSequence=result.seq;
      applyMarketData(result.snapshot,"bridge");
    }
  }catch(error){
    if(bridgeActive)updateBridgeUI("BRIDGE OFFLINE",
      "Cannot reach local server on 127.0.0.1:8765. Run node baskets/bridge/server.mjs.");
  }finally{bridgeBusy=false;}
}
function connectBridge(){
  if(!bridgeAllowedHere()){
    updateBridgeUI("LOCAL ONLY","Open this panel at http://localhost:8000/baskets/. Remote HTTPS cannot read the local bridge.");
    return;
  }
  if(!/^[a-f0-9]{36}$/i.test($("bridgeKey").value.trim())){
    toast("Paste the 36-character session key printed by the bridge server.");return;
  }
  bridgeActive=true;bridgeSequence=-1;
  $("connectBridge").disabled=true;$("disconnectBridge").disabled=false;
  updateBridgeUI("CONNECTING","Checking the local bridge...");
  pollBridge();
}
function disconnectBridge(){
  bridgeActive=false;capturePositionSymbols.clear();bridgeSequence=-1;
  $("connectBridge").disabled=false;$("disconnectBridge").disabled=true;
  updateBridgeUI("NOT CONNECTED","Capture stopped. Manual quick-entry controls still work.");
}
setInterval(pollBridge,700);

function renderAll(){
  $("roundButtons").innerHTML=[0,1,2].map(i=>'<button data-round="'+i+'" class="'+(i===state.round?'active':'')+'">'+(i+1)+'</button>').join("");
  fields();renderQuickGrid();
  $("sizePresets").innerHTML=[10,25,50,100,200].map(n=>
    '<button type="button" data-size="'+n+'" class="'+(state.maxOrder===n?'selected':'')+'">'+n+'</button>').join("");
  renderFlow();renderFills();renderDynamic();timerRender();
}
function renderDynamic(){
  const d=recommend({books:round().books,flow:round().flow,trust:state.trust,
    risk:state.risk,seconds:round().clock,maxOrder:state.maxOrder,observations:round().snapshots});
  renderSymbols(d);renderIndices(d.fair,round().books);renderBooks(d);
  renderDecision(d);renderTactics(d);renderPortfolio(d);
  syncMarketInputs();
  lastComputeTime=Date.now();
}
function addVolume(n){
  if(!Number.isFinite(n)||!Number.isInteger(n)||n===0){toast("Enter a nonzero signed integer share count.");return;}
  const sym=state.selected,mode=state.flowMode;
  round().flow[sym][mode]=finite(round().flow[sym][mode])+n;
  round().events.push({sym,mode,delta:n,at:Date.now()});
  round().events=round().events.slice(-150);
  save();renderFlow();renderDynamic();
}
function undoVolume(){
  const last=round().events.pop();
  if(!last)return;
  round().flow[last.sym][last.mode]-=last.delta;
  save();renderFlow();renderDynamic();
}
function captureSnapshot(quiet=false){
  const quote=validateBook(book());
  if(!quote.valid){if(!quiet)toast("Enter valid bid and ask before saving a snapshot.");return;}
  const list=round().snapshots,prev=list.filter(x=>x.sym===state.selected).slice(-1)[0];
  if(prev&&Math.abs(prev.mid-quote.mid)<0.001&&Math.abs(prev.spread-quote.spread)<0.001){
    if(!quiet)toast("This market snapshot is unchanged.");return;
  }
  list.push({sym:state.selected,mid:quote.mid,spread:quote.spread,at:Date.now()});
  round().snapshots=list.slice(-50);
  save();renderDynamic();
  if(!quiet)toast("Price snapshot saved for opponent analysis.");
}
function setSelected(sym){
  if(!SYMBOLS.includes(sym))return;
  state.selected=sym;save();fields();renderFlow();renderDynamic();
}
function fillDraft(action){
  state.fillSide=action.side;state.selected=action.symbol;
  save();fields();renderFlow();renderFills();renderDynamic();
  $("fillQty").value=action.qty;
  $("fillPrice").value=action.price.toFixed(2);
  toast("Order draft filled. Place the LIMIT order in the exchange first.");
}
function recordFill(){
  if(bridgeActive&&capturePositionSymbols.has(state.selected)){
    toast("Live position sync is active for this basket. Disable its position mapping or disconnect before manual fill logging.");
    return;
  }
  const qty=Number($("fillQty").value),price=Number($("fillPrice").value);
  const previous={...book()};
  try{
    const next=applyFill(book(),{side:state.fillSide,quantity:qty,price});
    round().books[state.selected]=next;
    round().fills.push({sym:state.selected,side:state.fillSide,qty,price,previous,at:Date.now()});
    round().fills=round().fills.slice(-200);
    save();fields();renderFills();renderDynamic();toast("Execution recorded. Check working-order sizes.");
  }catch(error){toast(error.message);}
}
function undoFill(){
  const row=round().fills.pop();if(!row)return;
  round().books[row.sym]=row.previous;
  save();fields();renderFills();renderDynamic();toast("Latest fill entry reverted.");
}
function updateSetting(name,value){
  if(name==="trust")state.trust=clamp(finite(value)/100,0,1);
  else if(name==="risk")state.risk=clamp(finite(value)/100,0,1);
  else if(name==="maxOrder")state.maxOrder=clamp(Math.round(finite(value,100)),1,1000);
  save();$("trustLabel").textContent=pct(state.trust);$("riskLabel").textContent=pct(state.risk);
  renderDynamic();
}
function showHelp(name){
  toast(GUIDE[name]||"See the input guide under the relevant panel.");
  if(["trust","risk","maxOrder"].includes(name)){
    $("settingsTitle").scrollIntoView({behavior:"smooth",block:"nearest"});
  }else{
    $("bookGuide").open=true;
  }
}
document.addEventListener("input",event=>{
  const el=event.target;
  if(el.dataset.quickSym!==undefined){
    const sym=el.dataset.quickSym,key=el.dataset.quickField;
    round().books[sym][key]=el.value;
    if(key==="position")round().books[sym].ledgerComplete=false;
    capturePositionSymbols.delete(sym);
    save();renderDynamic();
  }else if(el.id==="marketPaste"){
    previewPastedMarket();
  }else if(el.dataset.book!==undefined){
    const key=el.dataset.book;
    book()[key]=el.value;
    if(key==="position")book().ledgerComplete=false;
    capturePositionSymbols.delete(state.selected);
    save();renderDynamic();
  }else if(el.dataset.setting!==undefined){
    updateSetting(el.dataset.setting,el.value);
  }
});
document.addEventListener("change",event=>{
  const el=event.target;
  if(el.id==="bid"||el.id==="ask")captureSnapshot(true);
  if(el.dataset.quickField==="bid"||el.dataset.quickField==="ask"){
    const sym=el.dataset.quickSym;
    const b=round().books[sym];const q=validateBook(b);
    if(q.valid && !round().snapshots.some(x=>x.sym===sym&&x.mid===q.mid)){
      round().snapshots.push({sym,mid:q.mid,spread:q.spread,at:Date.now()});
      round().snapshots=round().snapshots.slice(-50);save();renderDynamic();
    }
  }
  if(el.dataset.setting==="maxOrder"){
    $("maxOrder").value=state.maxOrder;
    $("sizePresets").querySelectorAll("button").forEach(b=>b.classList.toggle("selected",Number(b.dataset.size)===state.maxOrder));
  }
});
document.addEventListener("click",async e=>{
  const btn=e.target.closest("button");
  if(!btn)return;
  if(btn.dataset.round!==undefined)return chooseRound(Number(btn.dataset.round));
  if(btn.dataset.symbol!==undefined)return setSelected(btn.dataset.symbol);
  if(btn.dataset.help!==undefined)return showHelp(btn.dataset.help);
  if(btn.dataset.mode!==undefined){state.flowMode=btn.dataset.mode;save();return renderFlow();}
  if(btn.dataset.flow!==undefined)return addVolume(Number(btn.dataset.flow));
  if(btn.dataset.size!==undefined){state.maxOrder=Number(btn.dataset.size);save();$("maxOrder").value=state.maxOrder;renderAll();return;}
  if(btn.dataset.fillSide!==undefined){state.fillSide=btn.dataset.fillSide;save();renderFills();return;}
  if(btn.id==="connectBridge")return connectBridge();
  if(btn.id==="disconnectBridge")return disconnectBridge();
  if(btn.id==="applyMarketPaste")return applyPastedMarket();
  if(btn.id==="pasteClipboard"){
    try{$("marketPaste").value=await navigator.clipboard.readText();applyPastedMarket();}
    catch{toast("Clipboard unavailable. Paste into the text box instead.");}
    return;
  }
  if(btn.id==="timerButton")return toggleTimer();
  if(btn.id==="timerReset")return resetTimer();
  if(btn.id==="undoFlow")return undoVolume();
  if(btn.id==="captureBook")return captureSnapshot();
  if(btn.id==="addCustomFlow"){
    const n=Number($("customFlow").value);
    addVolume(n);$("customFlow").value="";return;
  }
  if(btn.id==="useAction"){if(liveDecision?.best)fillDraft(liveDecision.best);return;}
  if(btn.id==="copyAction"){
    const a=liveDecision?.best;if(!a)return;
    const order=a.side+" "+a.qty+" "+a.symbol+" LIMIT @ "+a.price.toFixed(2)+" ("+a.kind+")";
    try{await navigator.clipboard.writeText(order);toast("Order details copied.");}
    catch{toast(order);}
    return;
  }
  if(btn.id==="recordFill")return recordFill();
  if(btn.id==="undoFill")return undoFill();
});
document.addEventListener("keydown",event=>{
  if((event.ctrlKey||event.metaKey)&&event.key==="Enter"&&document.activeElement===$("marketPaste")){
    event.preventDefault();applyPastedMarket();return;
  }
  if(event.altKey&&!event.shiftKey&&!event.ctrlKey&&!event.metaKey){
    if(["1","2","3"].includes(event.key)){event.preventDefault();setSelected(SYMBOLS[Number(event.key)-1]);}
    if(event.key==="Enter"){event.preventDefault();if(liveDecision?.best)fillDraft(liveDecision.best);}
  }
});
setInterval(()=>{
  const old=round().clock;
  timerRender();
  if(deadline!==null&&round().clock<=0){
    deadline=null;toast("10-minute round timer completed.");
  }
  if(deadline!==null&&Math.floor(old/5)!==Math.floor(round().clock/5)){
    save();renderDynamic();
  }
},250);
renderAll();
if("serviceWorker" in navigator && location.protocol.startsWith("http")){
  navigator.serviceWorker.register("../sw.js").catch(()=>{});
}
