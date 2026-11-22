import {SYMBOLS,SPECS,DURATION,roleForRound,freshChip,defaultRound,chipPosterior,
  revealSchedule,validPrice,bookStatus,capacity,makerPenalty,recommend,applyFill,markedPnl,validateChip}
from "./engine.js";
import {mergeMarketSnapshot} from "./import.js";

const KEY="quant-comp-vault-v1", $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num=(n,f=0)=>n!==""&&n!==null&&Number.isFinite(Number(n))?Number(n):f;
const money=(n,d=2)=>Number.isFinite(n)?"$"+Number(n).toFixed(d):"—";
const roundNum=(n,d=2)=>Number.isFinite(n)?Number(n).toFixed(d):"—";
const fresh=()=>({version:1,cohort:"maker14",round:1,stage:"reveal",selected:1,
  ownSymbol:"VAULT",risk:.35,maxOrder:30,rounds:Array.from({length:4},(_,i)=>
    defaultRound(roleForRound("maker14",i+1)))});
let state=fresh();
try{
 const saved=JSON.parse(localStorage.getItem(KEY)||"null");
 if(saved?.version===1&&Array.isArray(saved.rounds)&&saved.rounds.length===4){
   state={...fresh(),...saved};
   state.cohort=["maker14","maker23"].includes(state.cohort)?state.cohort:"maker14";
   state.round=Math.max(1,Math.min(4,Number(state.round)||1));
   state.stage=["reveal","trade","review"].includes(state.stage)?state.stage:"reveal";
   state.selected=Math.max(1,Math.min(30,Number(state.selected)||1));
   for(let i=0;i<4;i++){
     const base=defaultRound(roleForRound(state.cohort,i+1));
     state.rounds[i]={...base,...state.rounds[i],role:base.role};
     for(const s of SYMBOLS)state.rounds[i].books[s]={...base.books[s],...(state.rounds[i].books?.[s]||{})};
     if(!Array.isArray(state.rounds[i].chips)||state.rounds[i].chips.length!==30)state.rounds[i].chips=base.chips;
     state.rounds[i].clockRunning=false;
     if(!state.rounds[i].lastQuoteFillAt||typeof state.rounds[i].lastQuoteFillAt!=="object")
       state.rounds[i].lastQuoteFillAt={VAULT:-Infinity,G5:-Infinity,PUB:-Infinity};
   }
 }
}catch{}
let latest=null,lastBest=null,tickHandle=null,timerStart=0,elapsedAtStart=0,lastPenaltyTime=0;
let bridgeActive=false,bridgeBusy=false,bridgeSeq=-1,bridgeSource="",lastBridgeData=0;
let capturedPositionSymbols=new Set();
function store(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch{}}
function r(){return state.rounds[state.round-1];}
function currentRole(){return roleForRound(state.cohort,state.round);}
function selected(){return r().chips[state.selected-1];}
function message(id,text,bad=false){const el=$(id);el.textContent=text;el.classList.toggle("danger-note",bad);}
function remaining(){return Math.max(0,DURATION-r().elapsed);}
function timeLabel(seconds){const x=Math.max(0,Math.floor(seconds));return String(Math.floor(x/60)).padStart(2,"0")+":"+String(x%60).padStart(2,"0");}
function setStage(value){
  if(!["reveal","trade","review"].includes(value))return;
  state.stage=value;
  document.querySelectorAll("[data-stage]").forEach(b=>{
    const active=b.dataset.stage===value;b.classList.toggle("selected",active);
    b.setAttribute("aria-current",active?"step":"false");
  });
  document.querySelectorAll(".stage-body").forEach(x=>x.hidden=x.id!=="stage-"+value);
  store();
}
function model(){
  try{const chips=currentRole()==="maker"?r().chips.map((c,i)=>i>=20?freshChip(i+1):c):r().chips;
    latest=chipPosterior(chips);return latest;}
  catch(e){message("model-warning","Chip validation error: "+e.message,true);return null;}
}
function renderHead(){
  $("rounds").innerHTML=[1,2,3,4].map(x=>'<button data-round="'+x+'" type="button" class="'+(x===state.round?"selected":"")+'">'+x+"</button>").join("");
  $("cohort").value=state.cohort;
  $("role-pill").textContent=currentRole().toUpperCase();
  $("round-label").textContent="Round "+state.round+" / 4 · "+currentRole().toUpperCase();
  $("risk").value=String(state.risk);
  $("size-limit").value=String(state.maxOrder);
  $("next-round").disabled=state.round===4;
}
function renderClock(){
  const row=r(),role=currentRole(),schedule=revealSchedule(row.elapsed,role);
  $("clock").textContent=timeLabel(row.elapsed)+" / "+timeLabel(DURATION);
  $("clock-toggle").textContent=row.clockRunning?"Pause timer":"Start timer";
  $("next-public").textContent=schedule.nextPublicAt===null?"All public intervals done":timeLabel(schedule.nextPublicAt);
  $("schedule").textContent=schedule.publicPartial.length+" partial public · "+schedule.publicTrue.length+" exact public"+
    (role==="taker"?" · "+schedule.privateTrue.length+" private exact":"");
  const modelNow=latest;
  if(modelNow){
    const penalty=SYMBOLS.reduce((x,s)=>x+makerPenalty(s,row.books[s],modelNow.makerWidths[s],
      {elapsed:row.elapsed,lastQuoteFillAt:row.lastQuoteFillAt?.[s]??-Infinity}).rate,0);
    $("penalty-live").textContent=role==="maker"?money(penalty)+"/s":"Not applicable";
  }
}
function selectRound(value){
  if(value<1||value>4)return;
  pauseTimer();bridgeActive=false;bridgeSeq=-1;capturedPositionSymbols.clear();
  $("connect-bridge").disabled=false;$("disconnect-bridge").disabled=true;
  state.round=value;state.stage="reveal";state.selected=1;
  r().role=currentRole();
  renderAll();
}
function pauseTimer(){
  if(tickHandle){clearInterval(tickHandle);tickHandle=null;}
  r().clockRunning=false;store();
}
function tick(){
  if(!r().clockRunning)return;
  const row=r(),before=row.elapsed;
  const now=Date.now();
  row.elapsed=Math.min(DURATION,elapsedAtStart+(now-timerStart)/1000);
  const delta=row.elapsed-before;
  if(delta>0&&currentRole()==="maker"&&latest){
    const charge=SYMBOLS.reduce((acc,s)=>
      acc+makerPenalty(s,row.books[s],latest.makerWidths[s],
       {elapsed:row.elapsed,lastQuoteFillAt:row.lastQuoteFillAt?.[s]??-Infinity}).rate,0);
    row.penalty=Math.max(0,row.penalty+delta*charge);
  }
  if(row.elapsed>=DURATION){pauseTimer();message("fill-status","Round clock complete. Verify actual organizer time.");}
  renderClock();renderRisk();
  if(Math.floor(before/15)!==Math.floor(row.elapsed/15)){renderRevealSummary();store();}
}
function startClock(){
  if(r().clockRunning){pauseTimer();renderClock();return;}
  elapsedAtStart=r().elapsed;timerStart=Date.now();
  r().clockRunning=true;tickHandle=setInterval(tick,250);tick();store();
}
function renderRevealSummary(){
 const row=r(),c=row.chips,role=currentRole();
 const partial=c.filter(x=>x.partial!==null||x.combo).length;
 const exact=c.filter(x=>x.trueValue!==null).length;
 $("known-partial").textContent=String(partial);
 $("known-true").textContent=String(exact);
 $("private-block").hidden=role!=="taker";
 $("public-chips").innerHTML=c.slice(0,20).map(chipButton).join("");
 $("private-chips").innerHTML=c.slice(20).map(chipButton).join("");
 renderClock();
}
function chipButton(c){
 const type=c.trueValue!==null?"has-true":c.combo?"has-combo":c.partial!==null?"has-partial":"";
 const label=c.trueValue!==null?"T:"+c.trueValue:c.combo?"Mean "+c.combo.value:c.partial!==null?"P:"+c.partial:"—";
 return '<button class="chip '+type+' '+(c.id===state.selected?"selected":"")+
 '" data-chip="'+c.id+'" type="button"><b>'+c.id+'</b><small>'+esc(label)+"</small></button>";
}
function renderChipForm(){
 const ch=selected();
 $("selected-chip").textContent="Chip "+ch.id+(ch.id>20?" · Private":" · Public");
 $("chip-focus-label").textContent="Selected chip "+ch.id;
 $("partial-type").value=ch.combo?"combo":ch.partial===null?"none":ch.partialType||"unknown";
 $("partial-value").value=ch.partial??"";
 $("true-value").value=ch.trueValue??"";
 $("combo-a").value=ch.combo?.a??"";
 $("combo-b").value=ch.combo?.b??"";
 $("combo-value").value=ch.combo?.value??"";
 syncChipType();message("chip-feedback","");
}
function syncChipType(){
 const kind=$("partial-type").value;
 $("combo-wrap").hidden=kind!=="combo";
 $("partial-wrap").hidden=kind==="combo"||kind==="none";
}
function getOptionalInteger(id,min,max){
 const raw=$(id).value.trim();if(!raw)return null;
 const n=Number(raw);
 if(!Number.isInteger(n)||n<min||n>max)throw Error("Enter a whole number from "+min+" to "+max+" for "+id+".");
 return n;
}
function saveChip(){
 const id=state.selected,kind=$("partial-type").value,ch={...selected(),combo:null,partial:null,partialType:"unknown"};
 try{
   if(kind==="combo"){
     const a=getOptionalInteger("combo-a",1,30),b=getOptionalInteger("combo-b",1,30);
     const value=getOptionalInteger("combo-value",1,10);
     if(a===null||b===null||value===null)throw Error("Enter both referenced chip IDs and the shown rounded mean.");
     ch.combo={a,b,value};
   }else if(kind!=="none"){
     const display=getOptionalInteger("partial-value",1,10);
     if(display===null)throw Error("Enter the numeric partial reveal.");
     ch.partial=display;ch.partialType=kind;
   }
   ch.trueValue=getOptionalInteger("true-value",1,10);
   if(!validateChip(ch))throw Error("Invalid chip or combination reference. A combo must use two distinct other chip IDs.");
   r().chips[id-1]=ch;store();recompute();
   message("chip-feedback","Chip "+id+" saved. Fair values updated.");
 }catch(e){message("chip-feedback",e.message,true);}
}
function parseBulk(){
 const text=$("bulk-chips").value.trim();
 if(!text)return;
 try{
   const chunks=text.split(/[\s,;]+/),modified=r().chips.map(c=>({...c}));
   const seen=new Set();
   for(const part of chunks){
     const m=/^(\d{1,2}):([1-9]|10|-|_)\s*\/\s*([1-9]|10|-|_)$/i.exec(part);
     if(!m)throw Error("Bad entry: "+part+". Use 1:8/8 or 2:6/-.");
     const id=Number(m[1]);if(id<1||id>30||seen.has(id))throw Error("Invalid or repeated chip ID: "+id);
     if(currentRole()==="maker"&&id>20)throw Error("Maker teams cannot observe private chips 21–30.");
     seen.add(id);
     const partial=/^[-_]$/.test(m[2])?null:Number(m[2]);
     const trueValue=/^[-_]$/.test(m[3])?null:Number(m[3]);
     modified[id-1]={id,partial,partialType:"unknown",combo:null,trueValue};
   }
   r().chips=modified;store();recompute();$("bulk-chips").value="";
   message("chip-feedback","Imported "+seen.size+" chip entries.");
 }catch(e){message("chip-feedback",e.message,true);}
}
function marketInputs(){
 $("market-grid").innerHTML='<div class="market-head"><span>CONTRACT</span><span>BEST BID</span><span>BEST ASK</span><span>BID SIZE</span><span>ASK SIZE</span><span>POSITION</span></div>'+
 SYMBOLS.map(sym=>{
  const b=r().books[sym];
  return '<div class="market-row"><strong>'+sym+'</strong>'+[
    ["bid",b.bid],["ask",b.ask],["bidSize",b.bidSize],["askSize",b.askSize],["position",b.position]
  ].map(([field,value])=>'<input data-sym="'+sym+'" data-field="'+field+'" aria-label="'+sym+' '+field+
      '" type="number" inputmode="'+(["bid","ask"].includes(field)?"decimal":"numeric")+
      '" value="'+esc(value)+'" step="'+(["bid","ask"].includes(field)?SPECS[sym].tick:1)+'">').join("")+'</div>';
 }).join("");
 syncOwnQuotes();
}
function syncMarketInputs(){
 document.querySelectorAll("[data-sym][data-field]").forEach(el=>{
  if(document.activeElement===el)return;
  const current=String(r().books[el.dataset.sym][el.dataset.field]??"");
  if(el.value!==current)el.value=current;
 });
}
function syncOwnQuotes(){
 const s=state.ownSymbol,b=r().books[s];
 $("own-symbol").value=s;
 for(const [id,key] of [["own-bid","ownBid"],["own-ask","ownAsk"],
   ["own-bid-size","ownBidSize"],["own-ask-size","ownAskSize"]])$(id).value=b[key];
 const role=currentRole();
 $("record-quote").disabled=role!=="maker";
 for(const id of ["own-bid","own-ask","own-bid-size","own-ask-size"])$(id).disabled=role!=="maker";
 $("maker-description").textContent=role==="maker"?
   "Record only your OWN live resting quotes, not the whole exchange top of book. Qualifying size must be at least 10 shares on each side.":
   "Takers cannot post resting quotes. Only immediate-or-cancel orders are allowed.";
 renderOwnPenalty();
}
function renderOwnPenalty(){
 if(!latest)return;
 const s=state.ownSymbol;
 const p=makerPenalty(s,r().books[s],latest.makerWidths[s],
   {elapsed:r().elapsed,lastQuoteFillAt:r().lastQuoteFillAt?.[s]??-Infinity});
 $("maker-penalty-detail").textContent=currentRole()==="maker"?
   "Unpenalized maximum width Wmax = "+money(latest.makerWidths[s])+
    ". Effective qualifying width "+money(p.effectiveSpread)+". "+
    (p.grace?"Currently in a rule-defined grace window.":"Estimated penalty "+money(p.rate)+"/second.")+
    (p.unpenalized?" Width passes.":" Width exceeds Wmax."):
   "No maker quote-width penalty when your role is taker.";
}
function recordOwnQuote(){
 const s=state.ownSymbol,b=r().books[s];
 if(currentRole()!=="maker")return;
 try{
  const bid=$("own-bid").value,ask=$("own-ask").value;
  const bs=getOptionalInteger("own-bid-size",0,100000),as=getOptionalInteger("own-ask-size",0,100000);
  if(bid&&!validPrice(s,bid))throw Error("Invalid own bid price or tick for "+s);
  if(ask&&!validPrice(s,ask))throw Error("Invalid own ask price or tick for "+s);
  if(bid&&ask&&Number(bid)>=Number(ask))throw Error("Own bid must be lower than own ask.");
  b.ownBid=bid;b.ownAsk=ask;b.ownBidSize=bs??0;b.ownAskSize=as??0;
  store();renderDecision();message("bridge-status","Your "+s+" own quotes were recorded locally. No exchange order was sent.");
 }catch(e){message("bridge-status",e.message,true);}
}
function renderFair(){
 if(!latest)return;
 $("fair-grid").innerHTML=SYMBOLS.map(s=>{
  const sp=SPECS[s],w=latest.makerWidths[s];
  const q=bookStatus(s,r().books[s]);
  return '<div class="fair-card"><span class="fair-name">'+s+'</span><strong>'+
    money(latest.fair[s],s==="G5"?2:2)+'</strong><small>Approx σ '+roundNum(latest.uncertainty[s])+
    ' · Maker Wmax '+roundNum(w)+'</small><div class="market-state">'+
    (q.valid?"Book "+money(q.bid)+" / "+money(q.ask):"No valid bid/ask yet")+
    " · Tick "+money(sp.tick)+"</div></div>";
 }).join("");
}
function renderActions(){
 if(!latest)return;
 const options={role:currentRole(),risk:Number(state.risk),maxOrder:Number(state.maxOrder),
   elapsed:r().elapsed,lastQuoteFillAt:r().lastQuoteFillAt};
 const result=recommend(latest,r().books,options);
 lastBest=result.best;
 $("actions").innerHTML=SYMBOLS.map(s=>{
  const x=result.items[s],a=x.action,quote=x.quotes;
  const label=a?.kind==="IOC"?a.side+" "+a.qty+" @ "+money(a.price):
    a?.kind==="QUOTE"?"BID "+quote.buyQty+" @ "+money(quote.bid)+" / ASK "+quote.sellQty+" @ "+money(quote.ask):
    currentRole()==="maker"?"NO QUALIFYING TWO-SIDED QUOTE":"HOLD / NO VERIFIED EDGE";
  const detail=a?.kind==="IOC"?"Mode: "+(currentRole()==="taker"?"IOC required":"marketable limit")+
    ". Gross edge/share "+money(a.edge)+". "+a.note:
    currentRole()==="maker"?"Maker Wmax "+money(x.wmax)+
      ". Width "+(quote?money(quote.width):"unknown")+". "+
      (quote?.withinWmax?"Within unpenalized band.":"Quote width may still incur penalties.")+
      (quote?.qualifying?"":" Insufficient position headroom for 10-share quotes."):
    "Enter a valid current bid/ask. Expected edge must exceed the uncertainty buffer "+
    money(x.buffer)+".";
  return '<div class="action-card"><div class="action-head"><strong>'+s+'</strong><span class="tag">'+
    (a?.kind||"WAIT")+'</span></div><h4>'+esc(label)+'</h4><div class="hint">'+esc(detail)+
    '</div><button data-copy-sym="'+s+'" type="button" '+(!a?"disabled":"")+'>Copy instruction</button></div>';
 }).join("");
 if(result.best){
   const a=result.best;
   $("best-symbol").textContent=a.symbol+" · "+(currentRole()==="taker"?"TAKER":"MAKER");
   $("best-action").textContent=a.kind==="IOC"?a.side+" "+a.qty+" "+a.symbol+" @ "+money(a.price):
     "QUOTE "+a.symbol+" · TWO SIDES";
   $("best-reason").textContent=a.kind==="IOC"?
     "Potential gross expected edge "+money(a.edge)+" per share before market impact and uncertainty. "+
     (currentRole()==="taker"?"Submit as IOC only.":"Submit as a marketable limit if appropriate.")+
     " Confirm the order book has not changed.":
     "Suggested maker limits: buy "+a.buyQty+" @ "+money(a.bid)+
     ", sell "+a.sellQty+" @ "+money(a.ask)+
     ". Place both orders on the real exchange and then record your actual working quotes.";
   $("draft-best").disabled=a.kind!=="IOC";$("copy-best").disabled=false;
 }else{
   $("best-action").textContent=currentRole()==="maker"?"CHECK MAKER QUOTES":"HOLD · WAIT FOR EDGE";
   $("best-symbol").textContent="VAULT / G5 / PUB";
   $("best-reason").textContent=currentRole()==="maker"?
    "No qualifying recommended two-sided size. Check position limits and outstanding order quantities.":
    "No verified bid/ask currently clears the model's conservative edge threshold. Do not place a taker order from missing depth.";
   $("draft-best").disabled=true;$("copy-best").disabled=true;
 }
 $("model-warning").textContent=latest.impossible?"Combination reveals may conflict. Verify input constraints.":
  "Chip valuation uses the entered information only. Unrevealed true values are never inferred as certain.";
 renderOwnPenalty();renderClock();
}
function commandText(a){
 if(!a)return"";
 return a.kind==="IOC"?
  a.side+" "+a.qty+" "+a.symbol+" LIMIT @ "+a.price.toFixed(SPECS[a.symbol].tick===.1?1:2)+
    (currentRole()==="taker"?" IOC":" (marketable)")+
    " | Verify in the actual exchange":
  "POST BUY "+a.buyQty+" "+a.symbol+" @ "+a.bid.toFixed(SPECS[a.symbol].tick===.1?1:2)+
    " AND POST SELL "+a.sellQty+" "+a.symbol+" @ "+a.ask.toFixed(SPECS[a.symbol].tick===.1?1:2)+
    " | two separate maker limit orders";
}
function copyText(value){
 if(navigator.clipboard?.writeText)return navigator.clipboard.writeText(value).then(()=>
   message("bridge-status","Order copied. It was not placed." )).catch(()=>
   message("bridge-status","Clipboard unavailable. "+value));
 message("bridge-status",value);return Promise.resolve();
}
function draft(a){
 if(!a||a.kind!=="IOC")return;
 $("fill-symbol").value=a.symbol;$("fill-side").value=a.side;
 $("fill-qty").value=a.qty;$("fill-price").value=a.price;
 $("fill-resting").checked=false;setStage("review");
 message("fill-status","Draft populated. Record only after you execute and confirm a real fill.");
}
function recompute(){
 if(!model())return;
 renderRevealSummary();renderChipForm();renderFair();renderDecision();renderRisk();store();
}
function renderDecision(){if(!latest)return;renderActions();}
function renderRisk(){
 if(!latest)return;
 const role=currentRole(),row=r(),pnl=markedPnl(row.books,latest,{makerPenaltyAccrued:row.penalty});
 const positions=SYMBOLS.map(s=>({s,b:row.books[s],c:capacity(role,row.books[s])}));
 $("portfolio-grid").innerHTML='<div><span class="mini">MARK-TO-MODEL PNL</span><strong>'+
  money(pnl.pnl)+'</strong><span class="hint">'+(pnl.complete?"Ledger complete":"Estimated only, external position entered")+
  '</span></div><div><span class="mini">ACCRUED MAKER PENALTY</span><strong>'+money(row.penalty)+
  '</strong></div><div><span class="mini">FILLS RECORDED</span><strong>'+row.fills.length+
  '</strong></div><div><span class="mini">ROLE CAP / CONTRACT</span><strong>±'+(role==="maker"?500:300)+'</strong></div>';
 $("risk-summary").innerHTML=positions.map(o=>
   '<div class="risk-row"><span>'+o.s+' · position '+num(o.b.position)+'</span><strong>'+
    'Buy '+o.c.buy+' / Sell '+o.c.sell+'</strong></div>').join("")+
   '<p class="hint">Capacity subtracts unfilled working orders. PnL assumes all recorded fills started from zero inventory. Maker penalty accrues only while the local timer runs.</p>';
 $("fill-history").innerHTML=row.fills.length?row.fills.slice(-12).reverse().map(f=>
   '<div>'+esc(f.side)+' '+f.qty+' '+f.symbol+' @ '+money(f.price)+
   (f.quoted?" · rebate "+money(f.qty*.05):"")+'</div>').join(""):
   '<div class="hint">No confirmed fills recorded.</div>';
}
function recordFill(){
 const symbol=$("fill-symbol").value,side=$("fill-side").value;
 if(bridgeActive&&capturedPositionSymbols.has(symbol)){
   message("fill-status","Live position capture is active for this contract. Stop the reader or remove its position mapping before manually recording fills to avoid double-counting.",true);return;
 }
 const qty=Number($("fill-qty").value),price=Number($("fill-price").value);
 const quoted=$("fill-resting").checked;
 const rawOriginal=$("fill-original-size").value.trim();
 const originalSize=rawOriginal===""?null:Number(rawOriginal);
 if(quoted&&rawOriginal!==""&&(!Number.isSafeInteger(originalSize)||originalSize<0||originalSize<qty)){
   message("fill-status","Enter the resting order size before the fill (at least the filled shares).",true);return;
 }
 if(quoted&&currentRole()!=="maker"){message("fill-status","Taker fills cannot earn maker rebates.",true);return;}
 const before={...r().books[symbol]},last=r().lastQuoteFillAt?.[symbol]??-Infinity;
 try{
   const next=applyFill(before,currentRole(),{symbol,side,quantity:qty,price,quoted});
   r().books[symbol]=next;
   if(quoted&&originalSize!==null&&originalSize>10)r().lastQuoteFillAt[symbol]=r().elapsed;
   r().fills.push({symbol,side,qty,price,quoted,originalSize,before,lastQuoteFillAt:last});
   store();marketInputs();renderDecision();renderRisk();
   message("fill-status","Confirmed fill recorded. Working orders may need updating."+
     (quoted&&originalSize===null?" Enter the original resting order size next time to model 5-second penalty grace.":""));
 }catch(e){message("fill-status",e.message,true);}
}
function undoFill(){
 const f=r().fills.pop();
 if(!f){message("fill-status","No fill to undo.");return;}
 r().books[f.symbol]=f.before;r().lastQuoteFillAt[f.symbol]=f.lastQuoteFillAt;
 store();marketInputs();renderDecision();renderRisk();message("fill-status","Last fill entry restored.");
}
function setCohort(value){
 if(!["maker14","maker23"].includes(value))return;
 pauseTimer();
 state.cohort=value;
 for(let i=0;i<4;i++)state.rounds[i].role=roleForRound(value,i+1);
 if(currentRole()==="maker"&&state.selected>20)state.selected=1;
 renderAll();
}
function renderAll(){
 renderHead();setStage(state.stage);
 renderRevealSummary();renderChipForm();marketInputs();
 if(model()){renderFair();renderDecision();renderRisk();}
 renderClock();store();
}
$("rounds").addEventListener("click",e=>{const b=e.target.closest("[data-round]");if(b)selectRound(Number(b.dataset.round));});
$("cohort").addEventListener("change",e=>setCohort(e.target.value));
document.querySelectorAll("[data-stage]").forEach(b=>b.addEventListener("click",()=>setStage(b.dataset.stage)));
$("to-trade").addEventListener("click",()=>setStage("trade"));
$("to-review").addEventListener("click",()=>setStage("review"));
$("clock-toggle").addEventListener("click",startClock);
$("clock-reset").addEventListener("click",()=>{
 if(!window.confirm("Reset this round's local clock and estimated maker penalty? Orders, chips and fills remain saved."))return;
 pauseTimer();r().elapsed=0;r().penalty=0;r().lastQuoteFillAt={VAULT:-Infinity,G5:-Infinity,PUB:-Infinity};
 store();renderClock();renderRisk();renderDecision();
});
$("public-chips").addEventListener("click",e=>{const b=e.target.closest("[data-chip]");
 if(b){state.selected=Number(b.dataset.chip);renderRevealSummary();renderChipForm();store();}});
$("private-chips").addEventListener("click",e=>{const b=e.target.closest("[data-chip]");
 if(b&&currentRole()==="taker"){state.selected=Number(b.dataset.chip);renderRevealSummary();renderChipForm();store();}});
$("partial-type").addEventListener("change",syncChipType);
$("save-chip").addEventListener("click",saveChip);
$("clear-chip").addEventListener("click",()=>{
 r().chips[state.selected-1]=freshChip(state.selected);store();recompute();message("chip-feedback","Chip cleared.");
});
$("next-chip").addEventListener("click",()=>{
 state.selected=currentRole()==="maker"?state.selected%20+1:state.selected%30+1;
 renderRevealSummary();renderChipForm();store();
});
$("apply-bulk").addEventListener("click",parseBulk);
$("market-grid").addEventListener("input",e=>{
 const el=e.target.closest("[data-sym][data-field]");if(!el)return;
 const sym=el.dataset.sym,key=el.dataset.field;
 r().books[sym][key]=el.value;
 if(key==="position"){r().books[sym].ledgerComplete=false;capturedPositionSymbols.delete(sym);}
 store();renderFair();renderDecision();renderRisk();
});
$("own-symbol").addEventListener("change",e=>{state.ownSymbol=e.target.value;store();syncOwnQuotes();});
$("record-quote").addEventListener("click",recordOwnQuote);
$("risk").addEventListener("change",e=>{state.risk=Number(e.target.value);store();renderDecision();});
$("size-limit").addEventListener("change",e=>{
 state.maxOrder=Math.max(10,Math.min(1000,Math.floor(num(e.target.value,30))));
 e.target.value=state.maxOrder;store();renderDecision();
});
$("copy-best").addEventListener("click",()=>copyText(commandText(lastBest)));
$("draft-best").addEventListener("click",()=>draft(lastBest));
$("actions").addEventListener("click",e=>{
 const b=e.target.closest("[data-copy-sym]");if(!b||!latest)return;
 const result=recommend(latest,r().books,{role:currentRole(),risk:state.risk,
   maxOrder:state.maxOrder,elapsed:r().elapsed,lastQuoteFillAt:r().lastQuoteFillAt});
 copyText(commandText(result.items[b.dataset.copySym].action));
});
$("record-fill").addEventListener("click",recordFill);
$("undo-fill").addEventListener("click",undoFill);
$("next-round").addEventListener("click",()=>{if(state.round<4)selectRound(state.round+1);});
$("reset-game").addEventListener("click",()=>{
 if(!window.confirm("Erase ALL four Vault rounds, 30-chip reveal records, quotes, fills, score estimates and settings? This cannot be undone."))return;
 pauseTimer();
 try{localStorage.removeItem(KEY);}catch{message("bridge-status","Saved Vault data could not be cleared.",true);return;}
 state=fresh();state.stage="reveal";bridgeActive=false;bridgeSeq=-1;capturedPositionSymbols.clear();lastBest=null;
 $("bridge-key").value="";$("bulk-chips").value="";$("fill-qty").value="";$("fill-price").value="";
 $("connect-bridge").disabled=false;$("disconnect-bridge").disabled=true;
 renderAll();message("chip-feedback","Vault reset. Round 1, chip 1.");
});
function localBridgeAllowed(){return location.protocol==="http:"&&["localhost","127.0.0.1"].includes(location.hostname);}
function bridgeStatus(value,bad=false){message("bridge-status",value,bad);}
async function pollBridge(){
 if(!bridgeActive||bridgeBusy)return;
 bridgeBusy=true;
 try{
  const key=$("bridge-key").value.trim();
  const response=await fetch("http://127.0.0.1:8766/snapshot",
   {headers:{"x-bridge-key":key},cache:"no-store",signal:AbortSignal.timeout(1900)});
  if(!response.ok){bridgeStatus("Vault bridge returned HTTP "+response.status,true);return;}
  const data=await response.json();
  if(data.stale||!data.snapshot){bridgeStatus("Bridge connected, waiting for mapped game quote values.");return;}
  if(data.seq!==bridgeSeq){
    bridgeSeq=data.seq;
    for(const sym of SYMBOLS)if(data.snapshot.books?.[sym]?.position!==undefined)capturedPositionSymbols.add(sym);
    const updated=mergeMarketSnapshot(r().books,data.snapshot);
    if(updated.changed){
      r().books=updated.books;store();
      syncMarketInputs();renderFair();renderDecision();renderRisk();
    }
  }
  bridgeStatus("Read-only Vault data from "+(data.snapshot.host||"game")+" · "+Math.round(data.ageMs)+" ms old"+
    " · "+Object.keys(data.snapshot.books||{}).join(", ")+". Check prices before executing.");
 }catch{bridgeStatus("Cannot reach 127.0.0.1:8766. Start the Vault bridge and extension.",true);}
 finally{bridgeBusy=false;}
}
$("connect-bridge").addEventListener("click",()=>{
 if(!localBridgeAllowed()){bridgeStatus("Local bridge works only at http://localhost, not public HTTPS.",true);return;}
 if(!/^[a-f0-9]{36}$/i.test($("bridge-key").value.trim())){bridgeStatus("Enter the 36-character Vault bridge key.",true);return;}
 bridgeActive=true;bridgeSeq=-1;$("connect-bridge").disabled=true;$("disconnect-bridge").disabled=false;pollBridge();
});
$("disconnect-bridge").addEventListener("click",()=>{
 bridgeActive=false;bridgeSeq=-1;capturedPositionSymbols.clear();
 $("connect-bridge").disabled=false;$("disconnect-bridge").disabled=true;
 bridgeStatus("Stopped reading the local Vault bridge. Manual entry is available.");
});
setInterval(pollBridge,800);
renderAll();
if("serviceWorker" in navigator&&location.protocol.startsWith("http"))
 navigator.serviceWorker.register("../sw.js").catch(()=>{});
