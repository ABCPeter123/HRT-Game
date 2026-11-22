/*
 * Scavenger decision engine. No dependencies, network, or training state.
 * Bids and final guesses are recommendations under explicitly uncertain models,
 * not guaranteed optimal play against unknown opponents/distributions.
 */
export const PHASES = ["info", "auction1", "auction2", "auction3", "final"];
export const ROOM_SIZES = [6, 7];

export function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}
export function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
export function parseSamples(input) {
  if (Array.isArray(input)) return input.map(Number).filter(Number.isFinite).slice(0, 200);
  if (!String(input ?? "").trim()) return [];
  return String(input).trim().split(/[\s,;|]+/).filter(Boolean).map(Number).filter(Number.isFinite).slice(0, 200);
}
export function sampleCostFraction(n) {
  return Math.sqrt(Math.max(0, finite(n))) / 12;
}
export function sampleHint(percentile) {
  // Heuristic only. An exact sample-buying optimum requires a prior on the
  // unknown family/parameters and a model of all competitors' bids.
  const q = clamp(finite(percentile, 50), 0, 100);
  return q <= 10 || q >= 90 ? 4 : 3;
}
export function roundScore(p, sampleCount, auctionPayouts) {
  const payouts = auctionPayouts.map(x => finite(x));
  return payouts[0] + payouts[1] + 2 * payouts[2] - Math.max(0, p) * sampleCostFraction(sampleCount);
}
export function guessPayout(pool, guess) {
  return Math.max(0, pool / 4 - Math.abs(guess - pool));
}
export function auctionPayout(pool, bids, myIndex = bids.length - 1) {
  if (!Number.isFinite(pool) || pool < 0 || !Array.isArray(bids) || bids.length < 5) return NaN;
  const ranked = bids.map((bid, index) => ({
    bid: Math.max(0, Math.round(finite(bid))), index
  })).sort((a, b) => a.bid - b.bid || a.index - b.index);
  let remaining = pool;
  const payout = new Array(bids.length).fill(0);
  for (let k = 0; k < 3; k++) {
    payout[ranked[k].index] = Math.min(remaining, ranked[k].bid);
    remaining -= payout[ranked[k].index];
  }
  const highest = ranked[ranked.length - 1];
  payout[highest.index] = remaining - Math.abs(remaining - highest.bid);
  return payout[myIndex];
}
function normalCdf(x) {
  // Abramowitz/Stegun style approximation, accuracy adequate for scoring.
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const polynomial = t * (0.254829592 + t * (-0.284496736 +
    t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - polynomial * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}
export function inverseNormal(p) {
  const q = clamp(p, 0.00001, 0.99999);
  // Peter Acklam rational approximation.
  const a = [-39.69683028665376,220.9460984245205,-275.9285104469687,138.3577518672690,-30.66479806614716,2.506628277459239];
  const b = [-54.47609879822406,161.5858368580409,-155.6989798598866,66.80131188771972,-13.28068155288572];
  const c = [-0.007784894002430293,-0.3223964580411365,-2.400758277161838,-2.549732539343734,4.374664141464968,2.938163982698783];
  const d = [0.007784695709041462,0.3224671290700398,2.445134137142996,3.754408661907416];
  if (q < 0.02425 || q > 0.97575) {
    const t = Math.sqrt(-2 * Math.log(q < 0.5 ? q : 1 - q));
    const r = (((((c[0]*t+c[1])*t+c[2])*t+c[3])*t+c[4])*t+c[5]) /
      ((((d[0]*t+d[1])*t+d[2])*t+d[3])*t+1);
    return q < 0.5 ? r : -r;
  }
  const t = q-0.5, z=t*t;
  return (((((a[0]*z+a[1])*z+a[2])*z+a[3])*z+a[4])*z+a[5])*t /
    (((((b[0]*z+b[1])*z+b[2])*z+b[3])*z+b[4])*z+1);
}
function mean(values) {
  return values.reduce((s, v) => s + v, 0) / values.length;
}
function stdev(values, mu) {
  return Math.sqrt(values.reduce((s, v) => s+(v-mu)**2, 0) / Math.max(1, values.length-1));
}
function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const ix = clamp(q, 0, 1) * (sorted.length - 1), k=Math.floor(ix);
  return sorted[k] + (sorted[Math.min(k+1,sorted.length-1)]-sorted[k])*(ix-k);
}
function hashedSeed(values) {
  let seed = 2166136261;
  for (const value of values) {
    const text = String(value);
    for (let j=0;j<text.length;j++) seed = Math.imul(seed ^ text.charCodeAt(j),16777619);
  }
  return seed >>> 0;
}
function rngFromSeed(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rng) {
  return Math.sqrt(-2*Math.log(Math.max(1e-10,rng()))) * Math.cos(2*Math.PI*rng());
}
function twoNormalQuantile(q, left, right, leftSd, rightSd, weight) {
  let lo = Math.min(left-7*leftSd,right-7*rightSd), hi=Math.max(left+7*leftSd,right+7*rightSd);
  for(let i=0;i<36;i++) {
    const mid=(lo+hi)/2;
    const cdf=weight*normalCdf((mid-left)/leftSd)+(1-weight)*normalCdf((mid-right)/rightSd);
    if(cdf<q) lo=mid; else hi=mid;
  }
  return (lo+hi)/2;
}
export function estimatePool({percentile, samples, anchor} = {}) {
  const xs=parseSamples(samples).sort((a,b)=>a-b);
  const n=xs.length;
  const q=clamp(finite(percentile,50)/100, 0.005, 0.995);
  const anchored=Number(anchor)>0 && Number.isFinite(Number(anchor)) ? Number(anchor) : null;
  if (!n && !anchored) return null;
  if (!n) {
    return {value:anchored,lo:Math.max(0,anchored*0.45),hi:anchored*1.65,
      n, family:"Manual estimate", confidence:"LOW", candidates:[{name:"Manual estimate",value:anchored,weight:1}]};
  }
  const mu=mean(xs), sd=stdev(xs,mu), xMin=xs[0],xMax=xs[n-1];
  const spread=Math.max(sd,0.08*Math.max(1,Math.abs(mu)),1);
  const z=inverseNormal(q);
  const normal=mu+z*spread;
  const width=n>1?(xMax-xMin)*n/Math.max(1,n-1):2*spread;
  const uniform=xMin-(width-(xMax-xMin))/2+width*q;
  const exponentialScale=n>1?Math.max(1,(xs.reduce((s,v)=>s+v-xMin,0))/(n-1)):spread;
  const exponential=xMin-exponentialScale/n-exponentialScale*Math.log(1-q);
  const empirical=quantile(xs,q);
  const distinct=[...new Set(xs.map(x=>x.toFixed(6)))];
  const discrete=distinct.length<=2 && n>=3;
  const skew=n>=3 && sd>1e-8 ? xs.reduce((s,v)=>s+(v-mu)**3,0)/n/(sd**3):0;
  const split=Math.max(1, Math.floor(n/2));
  const l=xs.slice(0,split),r=xs.slice(split);
  const muL=mean(l),muR=mean(r.length?r:l);
  const sep=Math.abs(muR-muL)/Math.max(1,spread);
  const sdL=Math.max(spread*0.17,stdev(l,muL));
  const sdR=Math.max(spread*0.17,stdev(r.length?r:l,muR));
  const bimodal=n>=6?twoNormalQuantile(q,muL,muR,sdL,sdR,split/n):normal;
  let candidates=[
    {name:"Normal",value:normal,weight:0.36},
    {name:"Uniform",value:uniform,weight:0.23},
    {name:"Shifted exponential",value:exponential,weight:Math.abs(skew)>0.8&&skew>0?0.34:0.15},
    {name:"Two-humped",value:bimodal,weight:n>=6&&sep>1.35?0.24:0.08},
    {name:"Empirical",value:empirical,weight:n>=5?0.16:0.04}
  ];
  if(discrete) candidates.push({name:"Two-point",value:q<=xs.filter(x=>x===xMin).length/n?xMin:xMax,weight:0.55});
  let total=candidates.reduce((s,c)=>s+c.weight,0);
  candidates=candidates.map(c=>({...c,value:Math.max(0,c.value),weight:c.weight/total}));
  const value=candidates.reduce((s,c)=>s+c.value*c.weight,0);
  // Effective sampling uncertainty, intentionally wide with small n.
  const standardError=spread*(0.65+0.35*Math.abs(z))/Math.sqrt(Math.max(1,n)) +
    Math.max(1,Math.abs(value))*(n<4?0.15:0.035);
  const values=candidates.map(c=>c.value), min=Math.min(...values), max=Math.max(...values);
  const lo=Math.max(0,Math.min(min,value)-1.15*standardError);
  const hi=Math.max(value+1,Math.max(max,value)+1.15*standardError);
  return {value,lo,hi,n,family:discrete?"Possible two-point":skew>0.8?"Right-skew possible":"Multiple families",
    confidence:n>=12?"MODERATE":n>=5?"LOW / MODERATE":"LOW",
    candidates,standardError};
}
export function posteriorDraws(estimate, count=240, seed=2026) {
  if(!estimate) return [];
  const rng=rngFromSeed(seed>>>0), out=[];
  const c=estimate.candidates||[{value:estimate.value,weight:1}];
  for(let i=0;i<count;i++){
    const u=rng(), idx=c.findIndex((x,k)=>u<=c.slice(0,k+1).reduce((s,v)=>s+v.weight,0));
    const selected=c[Math.max(0,idx)];
    const spread=estimate.standardError || estimate.value*0.4;
    out.push(Math.max(0,selected.value+gaussian(rng)*spread));
  }
  return out.sort((a,b)=>a-b);
}
export function optimalFinalGuess(estimate, {seed=2026,count=300}={}) {
  if(!estimate) return null;
  const pools=posteriorDraws(estimate,count,seed);
  const top=Math.max(1,Math.ceil(quantile(pools,0.99)*1.3));
  const grid=new Set([0,Math.round(estimate.value)]);
  for(let k=0;k<=220;k++) grid.add(Math.round(top*k/220));
  for(let k=0;k<=40;k++) grid.add(Math.round(quantile(pools,k/40)));
  let best={guess:0,expected:-Infinity,chance:0};
  for(const guess of grid) {
    let sum=0,hits=0;
    for(const p of pools){const points=guessPayout(p,guess);sum+=points;if(points>0)hits++;}
    const expected=sum/pools.length;
    if(expected>best.expected){best={guess,expected,chance:hits/pools.length};}
  }
  return { ...best,mid:quantile(pools,0.5),low:quantile(pools,0.1),high:quantile(pools,0.9)};
}
export function refinePoolFromResults(estimate, history = [], roomSize = 6) {
  let minimum = 0, exact = null;
  for (const entry of history) {
    if (entry?.bid === "" || entry?.rank === "" || entry?.payout === "" ||
      entry?.bid == null || entry?.rank == null || entry?.payout == null) continue;
    const bid=Number(entry.bid),rank=Number(entry.rank),paid=Number(entry.payout);
    if (![bid,rank,paid].every(Number.isFinite) || bid<0 || rank<1 || rank>roomSize) continue;
    if(rank===1) {
      if(paid < bid - 1e-8 && paid>=0) exact=paid;
      else if(Math.abs(paid-bid)<1e-7) minimum=Math.max(minimum,bid);
    } else if(rank===roomSize) {
      // A high bidder gets residual - |residual - bid|.
      // If underpaid, residual=(bid+payout)/2; the total pool is at least residual.
      const residual=paid<bid-1e-8?(bid+paid)/2:bid;
      minimum=Math.max(minimum,residual);
    } else if(rank<=3 && paid>=0) {
      minimum=Math.max(minimum,paid);
    }
  }
  if(exact!==null) return {value:exact,lo:exact,hi:exact,n:estimate?.n || 0,
    family:"Inferred from capped lowest bid",confidence:"EXACT FROM PAYOUT",
    standardError:0.001,candidates:[{name:"Observed pool",value:exact,weight:1}]};
  if(!estimate) return null;
  if(minimum<=0 || minimum<=estimate.lo) return estimate;
  // Lower-bound conditioning, not an exact fit to unknown prior probabilities.
  const candidates=estimate.candidates.map(c=>({...c,value:Math.max(minimum,c.value)}));
  const value=candidates.reduce((total,c)=>total+c.value*c.weight,0);
  return {...estimate,value,lo:minimum,hi:Math.max(minimum+1,estimate.hi),
    family:estimate.family+" + payout bound",candidates};
}
export function inferRoomScale(history, estimate, roomSize=6) {
  if(!estimate?.value || !history?.length)return 1;
  // Convert past rank to an approximate cumulative distribution of rival bids.
  // Observations are coarse and involve changing opponents; shrink aggressively.
  const expectedQuantiles=[0.10,0.16,0.25,0.36,0.53,0.74,0.95];
  const scales=[];
  for(const item of history) {
    const rank=Number(item.rank), bid=Number(item.bid);
    if(!Number.isFinite(bid)||bid<0||!Number.isFinite(rank)||rank<1||rank>roomSize) continue;
    const target=expectedQuantiles[Math.min(expectedQuantiles.length-1,rank-1)];
    if(target>0)scales.push(clamp(bid/(Math.max(1,estimate.value)*target),0.4,2.5));
  }
  if(!scales.length)return 1;
  const logAverage=scales.reduce((s,v)=>s+Math.log(v),0)/scales.length;
  return clamp(Math.exp(logAverage*0.45),0.65,1.65);
}
export const OPPONENT_PROFILES = [
  {key:"cautious",label:"Low-bid crowd",counter:"Small bids crowd the three lowest slots. Compare a cheap qualifying bid with a well-calibrated highest bid."},
  {key:"normal",label:"Mixed crowd",counter:"Use the balance of low-slot and highest-bid opportunities. Avoid the unpaid middle ranks."},
  {key:"aggressive",label:"High-bid crowd",counter:"Larger bids leave room to win a low slot. Be careful when bidding high into the overbid penalty."}
];
const PROFILE_KEYS=OPPONENT_PROFILES.map(x=>x.key);
function opponentBid(rng, estimateValue, style, roomScale) {
  // A deliberately simple mixture: low-slot competitors and high/remainder hunters.
  // Real rival bids are hidden by the packet, so this is scenario analysis, not observation.
  const variants={cautious:[0.72,0.20],normal:[1,0.31],aggressive:[1.22,0.44]};
  const [scale,hunterProbability]=variants[style]||variants.normal;
  const center=Math.max(0,estimateValue)*scale*roomScale;
  const r=rng(),belief=clamp(1+gaussian(rng)*0.2,0.4,1.8);
  if(r<0.045)return 0;
  const fraction=r<hunterProbability+0.045 ? 0.56+0.52*rng() : 0.10+0.34*rng();
  return Math.max(0,Math.round(center*belief*fraction));
}
function startingProfileWeights(style) {
  const priors={
    auto:[0.32,0.36,0.32],
    cautious:[0.70,0.20,0.10],
    normal:[0.18,0.64,0.18],
    aggressive:[0.10,0.20,0.70]
  };
  return priors[style]||priors.auto;
}
function choose(n,k) {
  if(k<0||k>n)return 0;
  let c=1;
  for(let j=1;j<=Math.min(k,n-k);j++)c=c*(n-j+1)/j;
  return c;
}
export function inferOpponentProfiles({estimate,history=[],roomSize=6,style="auto",seed=2026}={}) {
  const prior=startingProfileWeights(style), room=roomSize===7?7:6;
  const evidence=history.filter(item=>item && item.bid!=="" && item.rank!=="" &&
    item.bid!==null && item.rank!==null && Number.isFinite(Number(item.bid)) &&
    Number.isInteger(Number(item.rank)) && Number(item.rank)>=1 && Number(item.rank)<=room);
  const result=(weights,observations)=>({
    weights:Object.fromEntries(PROFILE_KEYS.map((key,j)=>[key,weights[j]])),
    observations,prior:style,dominant:PROFILE_KEYS[weights.indexOf(Math.max(...weights))],
    evidenceLabel:observations?observations===1?"1 auction rank recorded":observations+" auction ranks recorded":"No auction results yet"
  });
  if(!estimate || !estimate.value || evidence.length===0)return result(prior,0);
  const n=room-1;
  const log=prior.map(w=>Math.log(w));
  const rng=rngFromSeed(hashedSeed([seed,Math.round(estimate.value),"profile-evidence"]));
  const perProfile=PROFILE_KEYS.map(key=>{
    const bids=Array.from({length:320},()=>opponentBid(rng,estimate.value,key,1)).sort((a,b)=>a-b);
    return bids;
  });
  for(const row of evidence) {
    const bid=Math.max(0,Number(row.bid)), k=Number(row.rank)-1;
    for(let j=0;j<3;j++){
      const bids=perProfile[j];
      let left=0,right=bids.length;
      while(left<right){const mid=(left+right)>>1;if(bids[mid]<=bid)left=mid+1;else right=mid;}
      const q=clamp(left/bids.length,0.02,0.98);
      const likelihood=choose(n,k)*q**k*(1-q)**(n-k);
      // Shrink evidence because bids are correlated and the model is only approximate.
      log[j]+=0.65*Math.log(Math.max(1e-8,likelihood));
    }
  }
  const top=Math.max(...log);
  const w=log.map(x=>Math.exp(x-top)),sum=w.reduce((a,b)=>a+b,0);
  return result(w.map(x=>x/sum),evidence.length);
}
function payoffAtBid(b,pool,rivals) {
  let below=0;
  for(const rival of rivals)if(rival<=b)below++;
  const rank=below+1,room=rivals.length+1;
  if(rank<=3){
    let remain=pool;
    for(let j=0;j<rank-1;j++)remain-=Math.min(remain,rivals[j]);
    return {rank,payout:Math.min(Math.max(0,remain),b)};
  }
  if(rank===room){
    let remain=pool;
    for(let j=0;j<3;j++)remain-=Math.min(remain,rivals[j]);
    return {rank,payout:remain-Math.abs(remain-b)};
  }
  return {rank,payout:0};
}
export function recommendBid({estimate,roomSize=6,history=[],style="auto",phase=1,seed=2026,
  scenarios=220,risk=0}={}) {
  if(!estimate)return null;
  const room=roomSize===7?7:6;
  const profile=inferOpponentProfiles({estimate,roomSize:room,history,style,seed});
  const rng=rngFromSeed(hashedSeed([seed,room,"opponent-scenarios"]));
  const pools=posteriorDraws(estimate,Math.max(80,Math.min(600,scenarios)),seed);
  const roomScale=inferRoomScale(history,estimate,room);
  const simulations=pools.map(pool=>({
    pool,rivals:PROFILE_KEYS.map(key=>Array.from({length:room-1},
      ()=>opponentBid(rng,estimate.value,key,roomScale)).sort((a,b)=>a-b))
  }));
  const upper=clamp(Math.ceil(Math.max(estimate.hi*1.35,estimate.value*1.7,10)),20,1e7);
  const candidates=new Set([0,1,Math.round(estimate.value/4),Math.round(estimate.value*0.7),
    Math.round(estimate.value),Math.round(estimate.value*1.15)]);
  for(let k=0;k<=126;k++)candidates.add(Math.round(upper*k/126));
  const phaseWeight=phase===3?2:1;
  const penalty=clamp(risk,0,1)*0.35;
  const scoreBid=b=>{
    const sums=[0,0,0],squares=[0,0,0],positive=[0,0,0],negative=[0,0,0],ranks=[0,0,0],
      lowRanks=[0,0,0],highRanks=[0,0,0];
    for(const {pool,rivals} of simulations){
      for(let j=0;j<3;j++){
        const value=payoffAtBid(b,pool,rivals[j]);
        const payoff=value.payout;
        sums[j]+=payoff;squares[j]+=payoff*payoff;
        if(payoff>0)positive[j]++;if(payoff<0)negative[j]++;
        if(value.rank<=3)lowRanks[j]++;
        if(value.rank===room)highRanks[j]++;
        ranks[j]+=value.rank;
      }
    }
    const count=simulations.length;
    const profileScores=Object.fromEntries(PROFILE_KEYS.map((key,j)=>{
      const expected=sums[j]/count,sd=Math.sqrt(Math.max(0,squares[j]/count-expected*expected));
      return [key,{expected:expected*phaseWeight,sd:sd*phaseWeight,
        score:(expected-penalty*sd)*phaseWeight,
        winProbability:positive[j]/count,lossProbability:negative[j]/count,
        lowSlotProbability:lowRanks[j]/count,highestProbability:highRanks[j]/count,
        meanRank:ranks[j]/count}];
    }));
    let weightedMean=0,weightedSecond=0,wins=0,losses=0,lowSlot=0,highest=0,rank=0;
    for(const key of PROFILE_KEYS){
      const weight=profile.weights[key],x=profileScores[key];
      weightedMean+=weight*x.expected;
      weightedSecond+=weight*(x.sd*x.sd+x.expected*x.expected);
      wins+=weight*x.winProbability;losses+=weight*x.lossProbability;
      lowSlot+=weight*x.lowSlotProbability;highest+=weight*x.highestProbability;
      rank+=weight*x.meanRank;
    }
    const sd=Math.sqrt(Math.max(0,weightedSecond-weightedMean*weightedMean));
    return {bid:b,expected:weightedMean,objective:weightedMean-penalty*sd,
      sd,winProbability:wins,lossProbability:losses,lowSlotProbability:lowSlot,
      highestProbability:highest,rank,profileScores};
  };
  let rated=[...candidates].filter(b=>b>=0).map(scoreBid).sort((a,b)=>b.objective-a.objective);
  const bestCoarse=rated.slice(0,4).map(x=>x.bid);
  const step=Math.max(1,Math.round(upper/126));
  const refined=new Set();
  for(const center of bestCoarse)for(let d=-step;d<=step;d+=Math.max(1,Math.floor(step/7))){
    refined.add(Math.max(0,center+d));
  }
  rated=rated.concat([...refined].map(scoreBid)).sort((a,b)=>b.objective-a.objective);
  const winners=PROFILE_KEYS.map(key=>{
    let best=rated[0];
    for(const b of rated)if(b.profileScores[key].score>best.profileScores[key].score)best=b;
    return {style:key,label:OPPONENT_PROFILES.find(x=>x.key===key).label,bid:best.bid,
      expected:best.profileScores[key].expected,
      lossProbability:best.profileScores[key].lossProbability,
      probability:profile.weights[key]};
  });
  const best=rated[0];
  const spread=Math.max(1,step*1.5);
  const alternatives=rated.filter(x=>Math.abs(x.bid-best.bid)>spread).slice(0,2).map(x=>({
    bid:x.bid,expected:x.expected,lossProbability:x.lossProbability
  }));
  const worstStyle=PROFILE_KEYS.reduce((a,b)=>
    best.profileScores[b].expected<best.profileScores[a].expected?b:a);
  return {...best,alternatives,roomScale,phaseWeight,scenarios:simulations.length,
    profile,profileCounterBids:winners,worstStyle,
    worstStyleExpected:best.profileScores[worstStyle].expected,
    range:[quantile(pools,0.10),quantile(pools,0.90)]};
}
