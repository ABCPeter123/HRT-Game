// WQC Fall 2026 Vault: pure 30-chip Bayesian valuation and execution rules.
// No fetch, DOM or trading API. Each chip value is an independent uniform integer 1..10.
export const SYMBOLS=["VAULT","G5","PUB"];
export const SPECS={
  VAULT:{min:30,max:300,tick:.25,label:"Sum of all 30 chip values"},
  G5:{min:0,max:30,tick:.1,label:"Chips strictly greater than 5"},
  PUB:{min:20,max:200,tick:.25,label:"Sum of public chips 1–20"}
};
export const DURATION=630;
export const MAKER_LIMIT=500,TAKER_LIMIT=300;
export const MAX_SIZE=1000;
const STATES=Array.from({length:10},(_,i)=>i+1);
const UNIFORM_VAR=8.25;
export const freshChip=(id)=>({id,partial:null,partialType:"unknown",combo:null,trueValue:null});
export const newChips=()=>Array.from({length:30},(_,i)=>freshChip(i+1));
export const defaultBook=()=>({bid:"",ask:"",bidSize:"",askSize:"",position:0,workingBuys:0,
  workingSells:0,ownBid:"",ownAsk:"",ownBidSize:"",ownAskSize:"",cash:0,ledgerComplete:true});
export const defaultRound=(role="maker")=>({role,elapsed:0,clockRunning:false,penalty:0,
  chips:newChips(),books:Object.fromEntries(SYMBOLS.map(s=>[s,defaultBook()])),
  fills:[],lastQuoteFillAt:-Infinity,notes:[]});
export const roleForRound=(cohort,round)=>{
  if(!["maker14","maker23"].includes(cohort))throw Error("Invalid cohort");
  return (cohort==="maker14"?[1,4]:[2,3]).includes(round)?"maker":"taker";
};
const norm=v=>{
  const sum=v.reduce((a,b)=>a+b,0);
  return sum>0?v.map(x=>x/sum):Array(10).fill(.1);
};
const pin=value=>STATES.map(x=>Number(x===value));
const mean=p=>p.reduce((s,v,i)=>s+v*(i+1),0);
const variance=p=>p.reduce((s,v,i)=>s+v*((i+1)-mean(p))**2,0);
const sum=(xs)=>xs.reduce((s,v)=>s+v,0);
const finite=n=>Number.isFinite(Number(n))&&n!==""&&n!==null;
const val=n=>Number(n);
export function validateChip(chip){
  if(!chip||!Number.isInteger(chip.id)||chip.id<1||chip.id>30)return false;
  const integer=x=>Number.isInteger(Number(x))&&Number(x)>=1&&Number(x)<=10;
  if(chip.trueValue!==null&&chip.trueValue!==""&&!integer(chip.trueValue))return false;
  if(chip.combo){
    const {a,b,value}=chip.combo;
    if(!integer(value)||![a,b].every(x=>Number.isInteger(Number(x))&&Number(x)>=1&&Number(x)<=30)
       ||a===b||a===chip.id||b===chip.id)return false;
  }else if(chip.partial!==null&&chip.partial!==""&&!integer(chip.partial))return false;
  return ["unknown","true","error","false"].includes(chip.partialType??"unknown");
}
export function errorLikelihood(trueValue,shown){
  const allowed=STATES.filter(x=>Math.abs(x-trueValue)<=2);
  return allowed.includes(shown)?1/allowed.length:0;
}
export function numericLikelihood(trueValue,shown,type="unknown"){
  const t=Number(trueValue),d=Number(shown);
  if(type==="true")return t===d?1:0;
  if(type==="error")return errorLikelihood(t,d);
  if(type==="false")return t===d?0:1/9;
  // A numeric partial excludes known-identifiable combination type.
  // P(type=true)=.50, P(error)=.25, P(false)=.15 (normalizer .90).
  return (.5*Number(t===d)+.25*errorLikelihood(t,d)+.15*Number(t!==d)/9)/.9;
}
export function roundedMean(a,b){return Math.floor((Number(a)+Number(b))/2+.5);}
export function revealSchedule(elapsed,role){
  const t=Math.max(0,Math.min(600,Number(elapsed)||0)); // Last reveal occurs at 10:00; none at round end.
  const publicPartial=[],publicTrue=[],privateTrue=[];
  for(let id=1;id<=20;id++){
    if(t>= (role==="taker"?id-1:id)*30)publicPartial.push(id);
    if(t>= (role==="taker"?id:id+1)*30)publicTrue.push(id);
  }
  if(role==="taker")for(let id=21;id<=30;id++)if(t>=(id-20)*60)privateTrue.push(id);
  return {publicPartial,publicTrue,privateTrue,nextPublicAt:t>=600?null:(Math.floor(t/30)+1)*30,
    nextPrivateAt:role==="taker"&&t<600?(Math.floor(t/60)+1)*60:null};
}
export function chipPosterior(chips,{iterations=12}={}){
  if(!Array.isArray(chips)||chips.length!==30||chips.some((c,i)=>c.id!==i+1||!validateChip(c)))
    throw Error("Enter 30 valid chip records with IDs 1 through 30.");
  const unary=chips.map(c=>{
    if(finite(c.trueValue))return pin(Number(c.trueValue));
    if(finite(c.partial)&&!c.combo)return norm(STATES.map(x=>numericLikelihood(x,Number(c.partial),c.partialType)));
    return Array(10).fill(.1);
  });
  const factors=chips.filter(c=>c.combo).map(c=>({
    id:c.id,a:Number(c.combo.a)-1,b:Number(c.combo.b)-1,value:Number(c.combo.value),
    ma:Array(10).fill(.1),mb:Array(10).fill(.1)
  }));
  const links=Array.from({length:30},()=>[]);
  for(const f of factors){links[f.a].push({factor:f,key:"ma"});links[f.b].push({factor:f,key:"mb"});}
  let impossible=false;
  for(let loop=0;loop<Math.max(1,Math.min(30,iterations));loop++){
    const next=[];
    for(const f of factors){
      const a=norm(unary[f.a].map((p,i)=>p*links[f.a].reduce((n,l)=>n*(l.factor===f?1:Math.max(1e-14,l.factor[l.key][i])),1)));
      const b=norm(unary[f.b].map((p,i)=>p*links[f.b].reduce((n,l)=>n*(l.factor===f?1:Math.max(1e-14,l.factor[l.key][i])),1)));
      const ma=STATES.map(va=>sum(STATES.map((vb,j)=>roundedMean(va,vb)===f.value?b[j]:0)));
      const mb=STATES.map(vb=>sum(STATES.map((va,i)=>roundedMean(va,vb)===f.value?a[i]:0)));
      if(sum(ma)===0||sum(mb)===0)impossible=true;
      next.push({f,ma:norm(ma),mb:norm(mb)});
    }
    for(const x of next){x.f.ma=x.ma;x.f.mb=x.mb;}
  }
  const distributions=unary.map((p,id)=>norm(p.map((x,i)=>x*links[id].reduce((q,l)=>q*Math.max(1e-14,l.factor[l.key][i]),1))));
  const details=distributions.map((p,i)=>({id:i+1,expected:mean(p),variance:variance(p),probGT5:sum(p.slice(5)),trueValue:finite(chips[i].trueValue)?Number(chips[i].trueValue):null,distribution:p}));
  const fair={
    VAULT:sum(details.map(x=>x.expected)),
    PUB:sum(details.slice(0,20).map(x=>x.expected)),
    G5:sum(details.map(x=>x.probGT5))
  };
  // Marginal-variance sum ignores covariance introduced by combination constraints.
  const uncertainty={
    VAULT:Math.sqrt(sum(details.map(x=>x.variance))),
    PUB:Math.sqrt(sum(details.slice(0,20).map(x=>x.variance))),
    G5:Math.sqrt(sum(details.map(x=>x.probGT5*(1-x.probGT5))))
  };
  const makerTrue=chips.map((c,i)=>i<20&&finite(c.trueValue));
  const makerUnknownPublic=makerTrue.filter(x=>!x).length;
  const makerWidths={
    VAULT:Math.sqrt((makerUnknownPublic+10)*UNIFORM_VAR),
    PUB:Math.sqrt(makerUnknownPublic*UNIFORM_VAR),
    G5:Math.sqrt((makerUnknownPublic+10)*.25)
  };
  return {fair,uncertainty,makerWidths,details,impossible,knownTrue:chips.filter(c=>finite(c.trueValue)).length,
    knownPartial:chips.filter(c=>finite(c.partial)||c.combo).length};
}
export function validPrice(sym,price){
  const spec=SPECS[sym];if(!spec||!finite(price))return false;
  const p=val(price);
  return p>=spec.min-1e-9&&p<=spec.max+1e-9&&
    Math.abs(p/spec.tick-Math.round(p/spec.tick))<1e-7;
}
const tickFloor=(sym,x)=>Math.max(SPECS[sym].min,
  Math.min(SPECS[sym].max,Math.floor((x+1e-8)/SPECS[sym].tick)*SPECS[sym].tick));
const tickCeil=(sym,x)=>Math.max(SPECS[sym].min,
  Math.min(SPECS[sym].max,Math.ceil((x-1e-8)/SPECS[sym].tick)*SPECS[sym].tick));
const rounded=(n)=>Math.round(n*100)/100;
export function bookStatus(sym,b){
  const bid=finite(b.bid)?val(b.bid):null,ask=finite(b.ask)?val(b.ask):null;
  const valid=bid!==null&&ask!==null&&validPrice(sym,bid)&&validPrice(sym,ask)&&bid<ask;
  return {bid,ask,valid,spread:valid?ask-bid:null,
    bidSize:finite(b.bidSize)&&Number.isSafeInteger(val(b.bidSize))&&val(b.bidSize)>=0?val(b.bidSize):null,
    askSize:finite(b.askSize)&&Number.isSafeInteger(val(b.askSize))&&val(b.askSize)>=0?val(b.askSize):null};
}
export function capacity(role,book){
  const limit=role==="maker"?MAKER_LIMIT:TAKER_LIMIT;
  const position=Number(book.position)||0;
  const buys=Math.max(0,Number(book.workingBuys)||0);
  const sells=Math.max(0,Number(book.workingSells)||0);
  return {limit,buy:Math.max(0,Math.floor(limit-position-buys)),
    sell:Math.max(0,Math.floor(limit+position-sells))};
}
export function makerPenalty(sym,book,wmax,{elapsed=120,lastQuoteFillAt=-Infinity}={}){
  const spec=SPECS[sym];
  // Missing size 10+ quote is treated as a quote at the band edge.
  const bid=finite(book.ownBid)&&validPrice(sym,book.ownBid)&&Number(book.ownBidSize)>=10?
    Number(book.ownBid):spec.min;
  const ask=finite(book.ownAsk)&&validPrice(sym,book.ownAsk)&&Number(book.ownAskSize)>=10?
    Number(book.ownAsk):spec.max;
  const effectiveSpread=Math.max(0,ask-bid);
  const grace=elapsed<10||(elapsed-lastQuoteFillAt>=0&&elapsed-lastQuoteFillAt<5);
  return {bid,ask,effectiveSpread,grace,rate:grace?0:rounded(.01*Math.max(0,effectiveSpread-wmax)),
    unpenalized:effectiveSpread<=wmax+1e-8};
}
export function suggest(sym,model,book,{role="maker",risk=.35,maxOrder=30,elapsed=0,lastQuoteFillAt=-Infinity}={}){
  const spec=SPECS[sym], fair=model.fair[sym],sigma=model.uncertainty[sym],wmax=model.makerWidths[sym];
  const q=bookStatus(sym,book),cap=capacity(role,book);
  const limit=Math.max(1,Math.min(MAX_SIZE,Math.floor(Number(maxOrder)||30)));
  const bias=Math.max(0,Math.min(1,Number(risk)||0));
  const buffer=Math.max(spec.tick,sigma*(.04+.09*bias));
  const possible=[];
  if(q.valid){
    const buyEdge=fair-q.ask,sellEdge=q.bid-fair;
    for(const [side,edge,price,depth,available] of [
      ["BUY",buyEdge,q.ask,q.askSize,cap.buy],["SELL",sellEdge,q.bid,q.bidSize,cap.sell]]){
      const qty=Math.min(limit,available,depth===null?10:depth);
      if(qty>0&&edge>buffer)possible.push({kind:"IOC",symbol:sym,side,price,qty,
        edge:rounded(edge),netEdge:rounded(edge-buffer),score:(edge-buffer)*qty,
        note:depth===null?"Displayed depth unknown. Size uses a provisional 10-share allowance.":"Limited to visible top-of-book size."});
    }
  }
  const aggressive=possible.sort((a,b)=>b.score-a.score)[0]||null;
  if(role==="taker")return {role,symbol:sym,fair,sigma,wmax,quotes:null,aggressive,
    action:aggressive,market:q,cap,buffer,penalty:null};
  const width=Math.max(spec.tick*2,Math.min(wmax*.85,Math.max(spec.tick*2,sigma*.60)));
  const shift=(Number(book.position)||0)/MAKER_LIMIT* sigma*(.3+.4*bias);
  let bid=tickFloor(sym,fair-shift-width/2),ask=tickCeil(sym,fair-shift+width/2);
  if(ask<=bid){if(bid+spec.tick<=spec.max)ask=rounded(bid+spec.tick);
    else bid=rounded(ask-spec.tick);}
  bid=rounded(bid);ask=rounded(ask);
  const buyQty=Math.min(limit,cap.buy),sellQty=Math.min(limit,cap.sell);
  const quoted=buyQty>=10&&sellQty>=10;
  const quotes={bid,ask,buyQty,sellQty,width:rounded(ask-bid),
    qualifying:quoted,withinWmax:ask-bid<=wmax+1e-7};
  const penalty=makerPenalty(sym,book,wmax,{elapsed,lastQuoteFillAt});
  const suggested=quoted?{kind:"QUOTE",symbol:sym,side:"BOTH",bid,ask,
    buyQty,sellQty,score:0,note:"Post two separate resting limit orders; size >=10 each. Confirm they are live."}:null;
  // Aggress only when more useful than a two-way quote, at a substantial excess edge.
  const action=aggressive&&aggressive.netEdge>Math.max(spec.tick,sigma*.10)?aggressive:suggested;
  return {role,symbol:sym,fair,sigma,wmax,quotes,aggressive,action,market:q,cap,buffer,penalty};
}
export function recommend(model,books,options={}){
  const items=Object.fromEntries(SYMBOLS.map(sym=>[sym,suggest(sym,model,books[sym]||defaultBook(),options)]));
  const actions=SYMBOLS.map(sym=>items[sym].action).filter(Boolean);
  const best=actions.filter(x=>x.kind==="IOC").sort((a,b)=>b.score-a.score)[0]||
    (options.role==="maker"?actions.find(x=>x.kind==="QUOTE"):null)||null;
  return {items,best};
}
export function applyFill(book,role,{side,quantity,price,quoted=false,symbol}){
  if(!["BUY","SELL"].includes(side)||!Number.isInteger(Number(quantity))||quantity<=0||
      !validPrice(symbol,price))throw Error("Fill requires valid side, positive integer shares and legal tick price.");
  const pos=Number(book.position)||0,delta=side==="BUY"?Number(quantity):-Number(quantity);
  const max=role==="maker"?MAKER_LIMIT:TAKER_LIMIT;
  if(Math.abs(pos+delta)>max)throw Error("Fill exceeds the role's position limit.");
  const cash=(Number(book.cash)||0)-delta*Number(price)+(quoted&&role==="maker"?quantity*.05:0);
  return {...book,position:pos+delta,cash:rounded(cash)};
}
export function markedPnl(books,model,{makerPenaltyAccrued=0}={}){
  let pnl=0,complete=true;
  for(const s of SYMBOLS){const b=books[s]||defaultBook();
    complete=complete&&b.ledgerComplete!==false;
    pnl+=(Number(b.cash)||0)+(Number(b.position)||0)*model.fair[s];
  }
  return {pnl:rounded(pnl-makerPenaltyAccrued),complete};
}
