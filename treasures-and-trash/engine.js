// Treasures & Trash, Waterloo Quant Club 2026. Pure and deterministic.
// Scores match the official packet (pages 14-16). No network or UI dependency.
export const SUITS = ["C", "D", "H", "S"];
export const SUIT_SYMBOLS = { C:"♣", D:"♦", H:"♥", S:"♠" };
export const RANKS = [2,3,4,5,6,7,8,9,10,11,12,13,14];
const rankLabel = r => r===14?"A":r===13?"K":r===12?"Q":r===11?"J":String(r);
export const cardCode = c => `${rankLabel(c.rank)}${c.suit}`;
export const cardName = c => `${rankLabel(c.rank)}${SUIT_SYMBOLS[c.suit]}`;
export const ALL_CARDS = SUITS.flatMap(suit=>RANKS.map(rank=>({rank,suit})));
export const baseValue = rank => rank===14?50:rank>=11?30:10;
export const otherColor = suit => (suit==="H"||suit==="D")?["C","S"]:["H","D"];
export const trashSuit = treasure => ({H:"D", D:"H", C:"S", S:"C"})[treasure];
export function deckSupply(treasure,card){
  if(card.suit===treasure)return 10;
  if(card.suit===trashSuit(treasure))return 4;
  return card.rank<=3?6:7;
}
export function parseCard(value){
  const s=String(value??"").toUpperCase().trim().replace(/[♣]/g,"C").replace(/[♦]/g,"D").replace(/[♥]/g,"H").replace(/[♠]/g,"S");
  const m=s.match(/^(10|[2-9TJQKA])([CDHS])$/)||s.match(/^([CDHS])(10|[2-9TJQKA])$/);
  if(!m)return null;
  const suit=/^[CDHS]$/.test(m[1])?m[1]:m[2];
  const raw=suit===m[1]?m[2]:m[1];
  const rank=({T:10,J:11,Q:12,K:13,A:14})[raw]??Number(raw);
  return {rank,suit};
}
export function parseCards(text){
  if(!String(text??"").trim())return [];
  const tokens=String(text).trim().split(/[\s,;|/]+/).filter(Boolean);
  const cards=[];
  for(const token of tokens){
    const repeated=token.match(/^(\d+)[x×*](.+)$/i);
    const count=repeated?Number(repeated[1]):1,card=parseCard(repeated?repeated[2]:token);
    if(!card||!Number.isSafeInteger(count)||count<1||count>40)throw Error(`Invalid card: ${token}. Use AS, 10D, 3H or 2xKC.`);
    for(let n=0;n<count;n++)cards.push({...card});
  }
  return cards;
}
export function assertCards(cards,treasure,checkSupply=true){
  if(!SUITS.includes(treasure))throw Error("Select a valid treasure suit.");
  if(!Array.isArray(cards))throw Error("Cards must be an array.");
  const totals=new Map();
  for(const c of cards){
    if(!c||!SUITS.includes(c.suit)||!RANKS.includes(c.rank))throw Error("Invalid card.");
    const k=cardCode(c);totals.set(k,(totals.get(k)||0)+1);
    if(checkSupply&&totals.get(k)>deckSupply(treasure,c))throw Error(`${k} exceeds the ${deckSupply(treasure,c)} copies in play.`);
  }
}
function scoreWithoutJoker(cards,treasure){
  const trash=trashSuit(treasure),allTrash=cards.length>0&&cards.every(c=>c.suit===trash);
  const byRank=new Uint16Array(15);
  for(const c of cards)byRank[c.rank]++;
  let total=0,baseTotal=0,synergy=0;
  for(const c of cards){
    const base=baseValue(c.rank),n=byRank[c.rank];
    const suitMultiplier=c.suit===treasure?1:c.suit===trash?(allTrash?1:-1):0;
    const rankMultiplier=n===2?0.5:n>=3?1:0;
    total+=base*(1+suitMultiplier+rankMultiplier);
    baseTotal+=base*(1+suitMultiplier);
    synergy+=base*rankMultiplier;
  }
  return {total,allTrash,baseTotal,synergy};
}
export function scoreHand(cards,treasure,jokers=0){
  assertCards(cards,treasure);
  if(!Number.isInteger(jokers)||jokers<0)throw Error("Joker count must be a nonnegative integer.");
  const natural=scoreWithoutJoker(cards,treasure);
  if(!jokers)return {...natural,natural:natural.total,jokerGain:0,jokerCard:null,playedCards:cards.length};
  let best=-Infinity,bestCard=null,bestResult=null;
  // The official rule allows only one Joker to become a single best-scoring card.
  // The selected card can also change the all-trash condition and rank bonuses.
  for(const c of ALL_CARDS){
    const result=scoreWithoutJoker([...cards,c],treasure);
    if(result.total>best){best=result.total;bestCard=c;bestResult=result;}
  }
  return {...bestResult,natural:natural.total,jokerGain:best-natural.total,jokerCard:bestCard,playedCards:cards.length+1};
}
export function contractExpected(contracts=[]){
  return contracts.reduce((sum,c)=>sum+(c.status==="fulfilled"?Number(c.payout||0):c.status==="failed"?0:Number(c.payout||0)*Number(c.probability||0)/100),0);
}
export function scoreAssets(state,includeUncertain=false){
  const score=scoreHand(state.cards,state.treasure,state.jokers||0);
  const confirmed=(state.contracts||[]).filter(c=>c.status==="fulfilled").reduce((s,c)=>s+Number(c.payout||0),0);
  return {...score,contracts:includeUncertain?contractExpected(state.contracts):confirmed,
    cash:Number(state.cash),total:score.total+Number(state.cash)+(includeUncertain?contractExpected(state.contracts):confirmed)};
}
function removeOwned(held,given){
  const remaining=[...held];
  for(const c of given){
    const pos=remaining.findIndex(x=>x.rank===c.rank&&x.suit===c.suit);
    if(pos<0)throw Error(`You do not own enough ${cardCode(c)} cards to give.`);
    remaining.splice(pos,1);
  }
  return remaining;
}
export function evaluateTrade(state,{receive=[],give=[],cashChange=0,jokersChange=0,giveContractIds=[],receiveContracts=[]}={}){
  assertCards(state.cards,state.treasure);
  assertCards(receive,state.treasure,false);
  assertCards(give,state.treasure,false);
  if(!Number.isFinite(cashChange)||!Number.isInteger(cashChange))throw Error("Cash change must be an integer number of dollars.");
  if(!Number.isInteger(jokersChange))throw Error("Jokers change must be an integer.");
  if(state.cash+cashChange<0)throw Error("Insufficient cash for the proposed trade.");
  if(state.jokers+jokersChange<0)throw Error("Cannot give more Jokers than you own.");
  if(new Set(giveContractIds).size!==giveContractIds.length)throw Error("Duplicate contract selected.");
  const owned=state.contracts||[];
  for(const id of giveContractIds)if(!owned.some(c=>c.id===id))throw Error("A contract selected to give is not owned.");
  const cards=[...removeOwned(state.cards,give),...receive];
  assertCards(cards,state.treasure);
  const contracts=[...owned.filter(c=>!giveContractIds.includes(c.id)),...receiveContracts];
  const after={...state,cards,contracts,cash:state.cash+cashChange,jokers:state.jokers+jokersChange};
  const beforeValue=scoreAssets(state,true).total,afterValue=scoreAssets(after,true).total;
  return {after,beforeValue,afterValue,delta:afterValue-beforeValue,
    cardAndJokerDelta:scoreHand(cards,state.treasure,after.jokers).total-scoreHand(state.cards,state.treasure,state.jokers).total,
    contractDelta:contractExpected(contracts)-contractExpected(owned)};
}
export function marginalValues(state){
  const current=scoreHand(state.cards,state.treasure,state.jokers||0).total;
  return ALL_CARDS.map(c=>{
    const owned=state.cards.filter(x=>x.rank===c.rank&&x.suit===c.suit).length;
    let buy=null;
    if(owned<deckSupply(state.treasure,c))buy=scoreHand([...state.cards,c],state.treasure,state.jokers||0).total-current;
    let sell=null;
    if(owned)sell=current-scoreHand(removeOwned(state.cards,[c]),state.treasure,state.jokers||0).total;
    return {card:c,buy,sell,owned,supply:deckSupply(state.treasure,c)};
  });
}
export function jokerMarginal(state){
  if((state.jokers||0)>0)return 0;
  return scoreHand(state.cards,state.treasure,1).total-scoreHand(state.cards,state.treasure,0).total;
}
export function auctionAdvice({kind="joker",state,payout=0,probability=50,downside=.35,cutoffs=[]}={}){
  if(!state)throw Error("Missing hand state.");
  const cash=Math.max(0,Math.floor(state.cash));
  const p=Math.min(1,Math.max(0,Number(probability)/100));
  const gain=kind==="joker"?jokerMarginal(state):Math.max(0,Number(payout))*p;
  const uncertainty=kind==="joker"?0:Math.max(0,Number(payout))*Math.sqrt(p*(1-p));
  const penalty=Math.max(0,Math.min(1,Number(downside)))*uncertainty;
  const maxBid=Math.max(0,Math.min(cash,Math.floor(gain-penalty)));
  const valid=cutoffs.filter(x=>Number.isFinite(x)&&x>=0).sort((a,b)=>a-b);
  const median=valid.length?valid[Math.floor((valid.length-1)/2)]:null;
  const target=median===null?Math.floor(maxBid*.7):Math.ceil(median)+1;
  const entryBid=Math.min(maxBid,Math.max(0,target));
  return {gain,uncertainty,penalty,maxBid,entryBid,observedCutoff:median,affordable:cash,
    note:median===null?"No observed winning cutoff. Entry bid is an exploratory 70% of your ceiling, not an optimal bid.":"Entry bid is $1 above the observed median third-place winning bid, capped by your value ceiling. Future rivals may bid differently."};
}
export function negotiatingEvidence(log=[],opponent=""){
  const entries=log.filter(x=>x.opponent.trim().toLowerCase()===opponent.trim().toLowerCase());
  const accepted=entries.filter(x=>x.outcome==="accepted"),rejected=entries.filter(x=>x.outcome==="rejected");
  const asks=entries.filter(x=>x.direction==="sell").map(x=>x.price).filter(Number.isFinite);
  const bids=entries.filter(x=>x.direction==="buy").map(x=>x.price).filter(Number.isFinite);
  return {offers:entries.length,accepted:accepted.length,rejected:rejected.length,
    highestObservedBid:bids.length?Math.max(...bids):null,
    lowestObservedAsk:asks.length?Math.min(...asks):null,
    acceptedBuys:accepted.filter(x=>x.direction==="buy").length,
    acceptedSells:accepted.filter(x=>x.direction==="sell").length};
}
export function tradeSuggestion(state){
  const options=marginalValues(state),buys=options.filter(x=>x.buy!==null&&x.buy>0)
    .sort((a,b)=>b.buy-a.buy||a.card.rank-b.card.rank);
  const sells=options.filter(x=>x.sell!==null).sort((a,b)=>a.sell-b.sell||a.card.rank-b.card.rank);
  return {buys:buys.slice(0,7),sells:sells.slice(0,7),
    joker: jokerMarginal(state),summary:scoreAssets(state,true)};
}

// Score actionable observed offers against the actual hand. Assumes single-card
// fixed-price offers, not binding quotes. Accepted/rejected offers remain history only.
export function offerOpportunities(state,offers=[]){
  const values=new Map(marginalValues(state).map(x=>[cardCode(x.card),x]));
  return offers.filter(x=>x.outcome==="offered").flatMap((x,i)=>{
    const card=parseCard(x.asset);
    if(!card||!Number.isFinite(x.price)||x.price<0)return [];
    const v=values.get(cardCode(card));
    if(!v)return [];
    if(x.direction==="sell"&&v.buy!==null&&state.cash>=x.price)
      return [{offer:x,index:i,card,action:"BUY",delta:v.buy-x.price,value:v.buy,price:x.price}];
    if(x.direction==="buy"&&v.sell!==null)
      return [{offer:x,index:i,card,action:"SELL",delta:x.price-v.sell,value:v.sell,price:x.price}];
    return [];
  }).filter(x=>x.delta>0).sort((a,b)=>b.delta-a.delta);
}
