// Liar's Market pure decision engine. No network, backend or dependencies.
// Ranks 2..14, suits C D H S. Jokers are 52 and 53.
export const TYPES=[
  ["high","High card"],["pair","Pair"],["straight","Straight"],
  ["two","Two pair"],["three","Three of a kind"],["full","Full house"],
  ["four","Four of a kind"],["sf","Straight flush"],
  ["five","Five of a kind"],["six","Six of a kind"]
];
export const LABELS=["","", "2","3","4","5","6","7","8","9","10","J","Q","K","A"];
export const SUITS=["♣","♦","♥","♠"];
export const DECK=Array.from({length:54},(_,i)=>i);
const TYPE_INDEX=Object.fromEntries(TYPES.map((t,i)=>[t[0],i]));
export function cardLabel(id){
  if(id===52||id===53)return id===52?"Joker 1":"Joker 2";
  return LABELS[2+id%13]+SUITS[Math.floor(id/13)];
}
export function handSize(score){
  if(score<=-6)return 7;
  if(score<=-4)return 6;
  if(score<=-2)return 5;
  if(score>=6)return 1;
  if(score>=4)return 2;
  if(score>=2)return 3;
  return 4;
}
export function isValidClaim(c){
  if(!c||!Object.hasOwn(TYPE_INDEX,c.type))return false;
  const a=Number(c.a),b=Number(c.b||0);
  if(!Number.isInteger(a)||a<2||a>14)return false;
  if(c.type==="straight"||c.type==="sf")return a>=5;
  if(c.type==="two")return b>=2&&b<a;
  if(c.type==="full")return b>=2&&b<=14&&b!==a;
  return true;
}
export function claimScore(c){return TYPE_INDEX[c.type]*256 + Number(c.a)*16 + Number(c.b||0);}
export function compareClaims(a,b){return claimScore(a)-claimScore(b);}
export function formatClaim(c){
  if(!isValidClaim(c))return "No claim";
  const a=LABELS[c.a],b=LABELS[c.b];
  switch(c.type){
    case "high":return a+" high";
    case "pair":return "Pair of "+a+"s";
    case "straight":return a+"-high straight";
    case "two":return "Two pair "+a+"s / "+b+"s";
    case "three":return "Three "+a+"s";
    case "full":return "Full house "+a+"s / "+b+"s";
    case "four":return "Four "+a+"s";
    case "sf":return a+"-high straight flush";
    case "five":return "Five "+a+"s";
    case "six":return "Six "+a+"s";
  }
}
export const ALL_CLAIMS=(()=>{
  const out=[];
  for(const [type] of TYPES){
    for(let a=2;a<=14;a++){
      if(type==="straight"||type==="sf"){if(a>=5)out.push({type,a});}
      else if(type==="two"){for(let b=2;b<a;b++)out.push({type,a,b});}
      else if(type==="full"){for(let b=2;b<=14;b++)if(a!==b)out.push({type,a,b});}
      else out.push({type,a});
    }
  }
  return out.sort(compareClaims);
})();
export function parseClaim(text){
  if(!text)return null;
  const s=String(text).trim().toUpperCase().replace(/[,/]+/g," ");
  const p=s.split(/\s+/);
  const alias={HC:"high",HIGH:"high",P:"pair",PAIR:"pair",ST:"straight",STRAIGHT:"straight",
    "2P":"two",TP:"two",TWO:"two",TR:"three",THREE:"three","3K":"three",
    FH:"full",FULL:"full","4K":"four",FOUR:"four",SF:"sf","5K":"five",FIVE:"five","6K":"six",SIX:"six"};
  const type=alias[p[0]];
  function rank(v){const map={T:10,J:11,Q:12,K:13,A:14};return map[v]||Number(v);}
  const c={type,a:rank(p[1]),b:rank(p[2]||"0")};
  return isValidClaim(c)?c:null;
}
function counts(cards){
  const r=new Int16Array(15),s=Array.from({length:4},()=>new Int16Array(15));
  let jokers=0;
  for(const id of cards){
    if(id>=52){jokers++;continue;}
    const rank=2+id%13, suit=Math.floor(id/13);
    r[rank]++;s[suit][rank]++;
  }
  return {r,s,jokers};
}
function straightCost(r,top){
  let missing=0;
  for(let k=0;k<5;k++){
    const rank=top===5&&k===4?14:top-k;
    if(!r[rank])missing++;
  }
  return missing;
}
export function existsClaim(count,c){
  const {r,s,jokers:j}=count,a=c.a,b=c.b||0;
  switch(c.type){
    case "high":return r[a]+j>=1;
    case "pair":return r[a]+j>=2;
    case "three":return r[a]+j>=3;
    case "four":return r[a]+j>=4;
    case "five":return r[a]+j>=5;
    case "six":return r[a]+j>=6;
    case "two":return Math.max(0,2-r[a])+Math.max(0,2-r[b])<=j;
    case "full":return Math.max(0,3-r[a])+Math.max(0,2-r[b])<=j;
    case "straight":return straightCost(r,a)<=j;
    case "sf":return s.some(suit=>straightCost(suit,a)<=j);
  }
  return false;
}
export function hasClaim(cards,c){return isValidClaim(c)&&existsClaim(counts(cards),c);}
export function highestClaim(cards){
  const ct=counts(cards);
  for(let k=ALL_CLAIMS.length-1;k>=0;k--)if(existsClaim(ct,ALL_CLAIMS[k]))return ALL_CLAIMS[k];
  return null;
}
export function payout(claim, outcome){
  // Claimant changes score by this amount; challenger receives the negative.
  const tier=TYPE_INDEX[claim.type]>=7?3:TYPE_INDEX[claim.type]>=5?2:1;
  if(outcome==="bluff-true")return tier;
  if(outcome==="bluff-false")return -(4-tier);
  if(outcome==="nuts-true")return -4;
  if(outcome==="nuts-false")return 1;
  if(outcome==="forced-win")return tier;
  if(outcome==="forced-loss")return -(4-tier);
  throw new Error("Unknown outcome");
}
export function decideReaction(exists,nuts,claim,downside=0){
  const p=Math.max(0,Math.min(1,exists)),pn=Math.max(0,Math.min(p,nuts));
  const good=payout(claim,"bluff-false")*-1,bad=payout(claim,"bluff-true")*-1;
  const bluff=(1-p)*good+p*bad;
  const nut=pn*4-(1-pn);
  const aversion=Math.max(0,Math.min(1,downside));
  // A call's chance of losing is penalized more at higher downside sensitivity.
  const bAdj=bluff-aversion*p*Math.abs(bad)*0.35;
  const nAdj=nut-aversion*(1-pn)*0.35;
  if(bAdj>Math.max(0,nAdj))return {action:"BLUFF",ev:bluff,adjusted:bAdj,pExists:p,pNuts:pn};
  if(nAdj>0)return {action:"NUTS",ev:nut,adjusted:nAdj,pExists:p,pNuts:pn};
  return {action:"PASS",ev:0,adjusted:0,pExists:p,pNuts:pn,bluffEV:bluff,nutsEV:nut};
}
function rng(seed){
  let v=(seed>>>0)||123456789;
  return ()=>{v+=0x6D2B79F5;let t=v;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
}
function hash(arr){
  let h=2166136261;
  for(const v of arr)h=Math.imul(h^((v+47)|0),16777619);
  return h>>>0;
}
export function sampleWorlds({known=[],scores=[0,0,0,0],mySeat=0,iterations=400,seed=0}={}){
  const unique=new Set(known);
  if(known.length!==unique.size||known.some(id=>!Number.isInteger(id)||id<0||id>53))
    throw Error("Duplicate or invalid known cards");
  if(scores.length!==4||scores.some(x=>!Number.isFinite(Number(x))))
    throw Error("Four team scores required");
  if(!Number.isInteger(mySeat)||mySeat<0||mySeat>3)throw Error("Invalid seat");
  const total=scores.reduce((n,v)=>n+handSize(Number(v)),5);
  if(known.length>total)throw Error("More known cards than active cards");
  const missing=total-known.length;
  if(missing>54-known.length)throw Error("Not enough cards in deck");
  const remains=DECK.filter(id=>!unique.has(id));
  const rand=rng((seed||hash([...known,...scores.map(Number),mySeat]))>>>0);
  const worlds=[];
  const n=Math.max(1,Math.min(2000,Math.floor(iterations)));
  for(let k=0;k<n;k++){
    // Partial Fisher-Yates, replacing only missing unknown cards.
    const pool=remains.slice(),cards=known.slice();
    for(let j=0;j<missing;j++){
      const t=j+Math.floor(rand()*(pool.length-j));
      const old=pool[j];pool[j]=pool[t];pool[t]=old;
      cards.push(pool[j]);
    }
    const ct=counts(cards);
    let best=0;
    for(let i=ALL_CLAIMS.length-1;i>=0;i--)if(existsClaim(ct,ALL_CLAIMS[i])){best=i;break;}
    worlds.push({ct,best});
  }
  return {worlds,total,missing,known:known.length};
}
export function opponentStats(history=[],seat=0){
  const mine=history.filter(x=>x.claimant===seat&&typeof x.exists==="boolean");
  const trueClaims=mine.filter(x=>x.exists).length;
  const n=mine.length;
  // Shrink toward neutral: only strong evidence substantially affects probabilities.
  const credibility=(2+trueClaims)/(4+n);
  const challenges=history.filter(x=>x.reactor===seat&&["bluff-true","bluff-false","nuts-true","nuts-false"].includes(x.outcome));
  return {n,trueClaims,credibility,challengeCount:challenges.length,
    style:credibility>=.67?"Evidence of credible claims":credibility<=.33?"Evidence of aggressive bluffing":"Uncertain / mixed"};
}
function posterior(p,credibility){
  const odds=Math.max(.25,Math.min(4,(credibility/(1-credibility))||1));
  return p*odds/(1-p+p*odds);
}
export function evaluateGame({known=[],scores=[0,0,0,0],mySeat=0,previous=null,claimant=1,
  history=[],downside=.35,iterations=400,seed=0}={}){
  const sim=sampleWorlds({known,scores,mySeat,iterations,seed});
  const {worlds}=sim,n=worlds.length;
  const ctKnown=counts(known);
  const p=new Float64Array(ALL_CLAIMS.length),pn=new Float64Array(ALL_CLAIMS.length);
  for(let i=0;i<ALL_CLAIMS.length;i++){
    const c=ALL_CLAIMS[i];
    let yes=0,nuts=0;
    for(const w of worlds)if(existsClaim(w.ct,c)){
      yes++;if(w.best===i)nuts++;
    }
    p[i]=yes/n;pn[i]=nuts/n;
  }
  let reaction=null;
  if(previous&&isValidClaim(previous)){
    const idx=ALL_CLAIMS.findIndex(c=>compareClaims(c,previous)===0);
    const stat=opponentStats(history,claimant);
    const adjusted=claimant===mySeat?p[idx]:posterior(p[idx],stat.credibility);
    const adjustedNuts=p[idx]>0?pn[idx]*adjusted/p[idx]:0;
    reaction={...decideReaction(adjusted,adjustedNuts,previous,downside),rawExist:p[idx],
      opponent:stat,claim:previous};
  }
  const baseline=previous&&isValidClaim(previous)?claimScore(previous):-1;
  const candidates=[];
  for(let i=0;i<ALL_CLAIMS.length;i++){
    const c=ALL_CLAIMS[i],score=claimScore(c);
    if(score<=baseline)continue;
    const prob=p[i],nut=pn[i],guaranteed=existsClaim(ctKnown,c);
    const classTier=TYPE_INDEX[c.type];
    const normalWin=payout(c,"bluff-true"),normalLose=-payout(c,"bluff-false");
    // Strategic proxy for opponent challenge behavior, never treated as calibrated.
    const pressure=Math.min(1,score/(9*256+240));
    const callChance=Math.min(.70,.09+.40*(1-prob)+.15*pressure);
    const nutChance=Math.min(.30,.025+.12*nut+.035*pressure);
    const evBluff=prob*normalWin-(1-prob)*normalLose;
    const evNut=(1-nut)-4*nut;
    const expected=callChance*evBluff+nutChance*evNut;
    // Unknown continuation value: prefer claims that increase pressure, but penalize
    // weakly supported bluffs and exposure to a correct Nuts call.
    const utility=expected+.16*pressure-(Math.max(0,Math.min(1,downside)))*(1-prob)*normalLose*.65;
    candidates.push({claim:c,pExists:prob,pNuts:nut,guaranteed,utility,expected});
  }
  candidates.sort((a,b)=>b.utility-a.utility||Number(b.guaranteed)-Number(a.guaranteed)||a.pNuts-b.pNuts||claimScore(a.claim)-claimScore(b.claim));
  return {reaction,claims:candidates.slice(0,8),sim:{total:sim.total,missing:sim.missing,
    trials:n,known:sim.known},top:candidates[0]||null};
}
