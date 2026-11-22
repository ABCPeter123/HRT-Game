/*
 * Baskets game 2: local-only decision math. Official settlement is deterministic
 * conditional on exact EVENT-BOT signed volumes; suspected order flow is NOT
 * equivalent to event-bot volume. The trading model is a heuristic, not an oracle.
 */
export const SYMBOLS=["GRID","CURE","SAFE"];
export const INDICES=["TEK","NRG","MED"];
export const MAX_POSITION=1000;
export const PRICE_TICK=0.5;
export const TICK_MIN=0;
export const TICK_MAX=800;
const MATRIX={
  TEK:{GRID:2,CURE:1,SAFE:0},
  NRG:{GRID:2,CURE:0,SAFE:1},
  MED:{GRID:0,CURE:1,SAFE:1}
};
const COMPONENTS={
  GRID:["TEK","NRG"],CURE:["TEK","MED"],SAFE:["NRG","MED"]
};
export const TACTICS=[
  {id:"maker",name:"Tight market makers",counter:"Improve by one tick only if the remaining spread and estimated edge cover adverse selection. Preserve price-time priority."},
  {id:"chaser",name:"Directional chasers",counter:"Use confirmed event volume to check whether aggressive bids or asks already priced the move. Do not mistake public prints for event-bot fills."},
  {id:"fader",name:"Flow faders",counter:"Trade a market overshoot toward modeled settlement only when the quote has enough edge. Keep exposure small if event classification is uncertain."}
];
export function clamp(n,lo,hi){return Math.min(hi,Math.max(lo,n));}
export function finite(value,fallback=0){
  if(value===""||value==null)return fallback;
  const v=Number(value);
  return Number.isFinite(v)?v:fallback;
}
export function optionalNumber(value){
  if(value===""||value==null)return null;
  const n=Number(value);
  return Number.isFinite(n)?n:null;
}
export function signed(value){const n=finite(value);return n>0?"+"+n.toFixed(0):n.toFixed(0);}
export function tickFloor(n){return clamp(Math.floor((n+1e-9)/PRICE_TICK)*PRICE_TICK,TICK_MIN,TICK_MAX);}
export function tickCeil(n){return clamp(Math.ceil((n-1e-9)/PRICE_TICK)*PRICE_TICK,TICK_MIN,TICK_MAX);}
export function tickValid(n){
  return n!==null && Number.isFinite(n) && n>=TICK_MIN && n<=TICK_MAX &&
    Math.abs(n/PRICE_TICK-Math.round(n/PRICE_TICK))<1e-8;
}
export function emptyBook(){
  return {bid:"",ask:"",bidSize:"",askSize:"",position:"0",openBuys:"0",
    openSells:"0",cash:"0",ledgerComplete:true};
}
export function emptyFlow(){
  return {confirmed:0,suspected:0,tape:0};
}
export function emptyRound(){
  return {books:Object.fromEntries(SYMBOLS.map(sym=>[sym,emptyBook()])),
    flow:Object.fromEntries(SYMBOLS.map(sym=>[sym,emptyFlow()])),
    events:[],fills:[],snapshots:[],clock:600,startingCash:0};
}
export function capacities(book){
  const pos=finite(book.position),openBuys=Math.max(0,finite(book.openBuys)),
    openSells=Math.max(0,finite(book.openSells));
  return {buy:Math.max(0,Math.floor(MAX_POSITION-pos-openBuys)),
    sell:Math.max(0,Math.floor(MAX_POSITION+pos-openSells)),
    valid:pos>=-MAX_POSITION&&pos<=MAX_POSITION&&openBuys>=0&&openSells>=0};
}
function qForSymbol(flow,sym,trust=0.35){
  const f=flow?.[sym]||emptyFlow();
  return finite(f.confirmed)+clamp(trust,0,1)*finite(f.suspected);
}
export function settlement({flow={},trust=0.35}={}){
  const q=Object.fromEntries(SYMBOLS.map(s=>[s,qForSymbol(flow,s,trust)]));
  const qConfirmed=Object.fromEntries(SYMBOLS.map(s=>[s,finite(flow?.[s]?.confirmed)]));
  const dq=Object.fromEntries(SYMBOLS.map(s=>[s,finite(flow?.[s]?.suspected)]));
  const values={},confirmedValues={},sigma={},delta={};
  // sigma treats each suspected burst as one uncertain correlated aggregate.
  const magnitude=Math.sqrt(clamp(trust,0,1)*(1-clamp(trust,0,1)));
  for(const index of INDICES){
    let change=0,confirmedChange=0,variance=0;
    for(const sym of SYMBOLS){
      const factor=MATRIX[index][sym]/200;
      change+=factor*q[sym];
      confirmedChange+=factor*qConfirmed[sym];
      variance+=(factor*dq[sym]*magnitude)**2;
    }
    values[index]=200+change;
    confirmedValues[index]=200+confirmedChange;
    delta[index]=change;
    sigma[index]=Math.sqrt(variance);
  }
  const baskets={},confirmedBaskets={},basketSigma={};
  for(const sym of SYMBOLS){
    const [a,b]=COMPONENTS[sym];
    baskets[sym]=values[a]+values[b];
    confirmedBaskets[sym]=confirmedValues[a]+confirmedValues[b];
    let v=0;
    for(const source of SYMBOLS){
      const factor=(MATRIX[a][source]+MATRIX[b][source])/200;
      v+=(factor*dq[source]*magnitude)**2;
    }
    basketSigma[sym]=Math.sqrt(v);
  }
  return {q,index:values,delta,baskets,confirmedIndex:confirmedValues,
    confirmedBaskets,sigma,basketSigma,assumedTrust:clamp(trust,0,1)};
}
export function impliedIndices(books){
  const mids={};
  for(const sym of SYMBOLS){
    const {bid,ask}=books?.[sym]||{};
    const b=optionalNumber(bid),a=optionalNumber(ask);
    if(b===null||a===null||b>a||!tickValid(b)||!tickValid(a))return null;
    mids[sym]=(a+b)/2;
  }
  return {
    TEK:(mids.GRID+mids.CURE-mids.SAFE)/2,
    NRG:(mids.GRID+mids.SAFE-mids.CURE)/2,
    MED:(mids.CURE+mids.SAFE-mids.GRID)/2
  };
}
export function validateBook(book){
  const bid=optionalNumber(book?.bid),ask=optionalNumber(book?.ask);
  if(bid===null||ask===null)return {valid:false,reason:"Enter both best bid and best ask."};
  if(!tickValid(bid)||!tickValid(ask))return {valid:false,reason:"Prices must be from $0 to $800 in $0.50 steps."};
  if(bid>=ask)return {valid:false,reason:"Best bid must be below best ask."};
  const cap=capacities(book);
  if(!cap.valid)return {valid:false,reason:"Position is outside the ±1000 limit."};
  const bs=optionalNumber(book?.bidSize),as=optionalNumber(book?.askSize);
  if((bs!==null&&(bs<0||!Number.isInteger(bs)))||(as!==null&&(as<0||!Number.isInteger(as))))
    return {valid:false,reason:"Displayed quote sizes must be nonnegative integers."};
  return {valid:true,bid,ask,bidSize:bs,askSize:as,spread:ask-bid,mid:(ask+bid)/2,capacity:cap};
}
export function indexExposure(books){
  const positions=Object.fromEntries(SYMBOLS.map(s=>[s,finite(books?.[s]?.position)]));
  return {TEK:positions.GRID+positions.CURE,
    NRG:positions.GRID+positions.SAFE,
    MED:positions.CURE+positions.SAFE};
}
export function inventoryStress(books,shockVolume=200){
  // Illustrative one-basket future surprise of ± shockVolume EVENT-BOT shares.
  const positions=Object.fromEntries(SYMBOLS.map(s=>[s,finite(books?.[s]?.position)]));
  const exposures=indexExposure(books);
  const byEvent={};
  for(const sym of SYMBOLS){
    let impact=0;
    for(const ix of INDICES)impact+=exposures[ix]*MATRIX[ix][sym]*shockVolume/200;
    byEvent[sym]=impact;
  }
  return {exposure:exposures,byEvent,
    worstCaseShockLoss:Math.max(0,...Object.values(byEvent).map(Math.abs)),
    shockVolume};
}
export function estimateTactics({books={},flow={},observations=[]}={}){
  let tight=0,depth=0,drift=0,aligned=0,contrary=0,seen=0;
  for(const sym of SYMBOLS){
    const b=validateBook(books?.[sym]);
    if(!b.valid)continue;
    seen++;
    tight+=b.spread<=1?1:b.spread<=2?0.5:0;
    const quotedDepth=(b.bidSize??0)+(b.askSize??0);
    depth+=quotedDepth>=100?1:quotedDepth>=30?0.35:0;
    const tape=finite(flow?.[sym]?.tape);
    const records=observations.filter(x=>x.sym===sym && Number.isFinite(x.mid)).slice(-2);
    if(records.length<2 || Math.abs(tape)<5)continue;
    drift=records[1].mid-records[0].mid;
    if(Math.abs(drift)<0.25)continue;
    if(Math.sign(drift)===Math.sign(tape))aligned++;
    else contrary++;
  }
  const score={maker:1+0.8*tight+0.18*depth,
    chaser:1+1.6*aligned+0.15*Math.min(5,Object.values(flow).filter(f=>Math.abs(finite(f.tape))>=50).length),
    fader:1+1.5*contrary+0.22*Math.max(0,seen-tight)};
  const sum=Object.values(score).reduce((a,b)=>a+b,0);
  return {weights:Object.fromEntries(Object.entries(score).map(([k,v])=>[k,v/sum])),
    dominant:Object.keys(score).sort((a,b)=>score[b]-score[a])[0],
    observedBooks:seen,aligned,contrary,
    note:"Heuristic market-condition scenarios, not identified human teams or measured bot composition."};
}
function sideCapacity(book,side){const c=capacities(book);return side==="BUY"?c.buy:c.sell;}
function executionCandidates({symbol,book,fair,risk=0.35,timeRemaining=600,maxOrder=100}){
  const quote=validateBook(book);
  if(!quote.valid)return {symbol,valid:false,reason:quote.reason,candidates:[],best:null,quote};
  const expected=fair.baskets[symbol],uncertainty=fair.basketSigma[symbol];
  const remaining=clamp(timeRemaining,0,600),riskWeight=clamp(risk,0,1);
  const candidates=[];
  for(const side of ["BUY","SELL"]){
    const capacity=sideCapacity(book,side),pos=finite(book.position);
    if(capacity<1)continue;
    const bookDepth=side==="BUY"?quote.askSize:quote.bidSize;
    for(const kind of ["TAKE","MAKE"]){
      const crossed=kind==="TAKE";
      let price;
      if(side==="BUY")price=crossed?quote.ask:Math.min(quote.ask-PRICE_TICK,quote.bid+PRICE_TICK);
      else price=crossed?quote.bid:Math.max(quote.bid+PRICE_TICK,quote.ask-PRICE_TICK);
      if(!tickValid(price)||(!crossed && ((side==="BUY"&&price>=quote.ask)||(side==="SELL"&&price<=quote.bid))))
        continue;
      const grossEdge=(side==="BUY"?expected-price:price-expected);
      const modelRisk=(0.3+1.4*riskWeight)*uncertainty;
      const selectionBuffer=crossed?0.25:(0.55+0.20*riskWeight);
      const exposurePenalty=0.35*riskWeight*Math.max(0,(side==="BUY"?pos:-pos)/MAX_POSITION);
      const unitEdge=grossEdge-modelRisk-selectionBuffer-exposurePenalty;
      if(unitEdge<=0)continue;
      const depthCap=crossed?(bookDepth===null?20:Math.floor(bookDepth)):Infinity;
      const timeSizeFactor=remaining<=45?0.4:remaining<=120?0.65:1;
      const budget=Math.min(capacity,Math.max(1,Math.floor(maxOrder*timeSizeFactor)),depthCap);
      const qty=Math.max(0,Math.floor(budget));
      if(qty<1)continue;
      // Fill likelihood is a ranking heuristic, not an observed or calibrated probability.
      const fillWeight=crossed?(bookDepth===null?0.55:0.9):
        0.25*Math.max(0.08,remaining/600)*(quote.spread<=1?1.3:1);
      const score=unitEdge*qty*fillWeight;
      candidates.push({symbol,side,kind,price,qty,score,unitEdge,
        grossEdge,expectedSettlement:expected,uncertainty,
        capacity,bookDepth,fillWeight});
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  return {symbol,valid:true,reason:"",candidates,best:candidates[0]||null,
    quote,expectedSettlement:expected,uncertainty};
}
export function recommend({books={},flow={},trust=0.35,risk=0.35,seconds=600,
  maxOrder=100,observations=[]}={}){
  const fair=settlement({flow,trust});
  const perSymbol=Object.fromEntries(SYMBOLS.map(sym=>[sym,executionCandidates({
    symbol:sym,book:books?.[sym]||emptyBook(),fair,
    risk,timeRemaining:seconds,maxOrder
  })]));
  const candidates=SYMBOLS.flatMap(s=>perSymbol[s].candidates);
  candidates.sort((a,b)=>b.score-a.score);
  const best=candidates[0]||null;
  const tactics=estimateTactics({books,flow,observations});
  return {fair,perSymbol,best,alternatives:candidates.filter(x=>x!==best).slice(0,4),
    stress:inventoryStress(books),tactics,candidates,
    missing:SYMBOLS.filter(s=>!perSymbol[s].valid),
    status:best?"ACTION":"HOLD"};
}
export function applyFill(book,{side,quantity,price}){
  const qty=Number(quantity),px=Number(price);
  if(!["BUY","SELL"].includes(side)||!Number.isInteger(qty)||qty<=0||
    !tickValid(px))throw new Error("A fill needs a valid side, positive integer size and half-tick price.");
  const pos=finite(book.position),next=pos+(side==="BUY"?qty:-qty);
  if(next>MAX_POSITION||next<-MAX_POSITION)throw new Error("Fill exceeds the ±1000 position limit.");
  const cash=finite(book.cash)+(side==="BUY"?-qty*px:qty*px);
  return {...book,position:String(next),cash:String(cash)};
}
export function projectedPnl({books={},fair,ledgerComplete=true}={}){
  if(!fair||!ledgerComplete)return null;
  return SYMBOLS.reduce((sum,s)=>
    sum+finite(books[s]?.cash)+finite(books[s]?.position)*fair.baskets[s],0);
}
