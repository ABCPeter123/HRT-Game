import {
  PHASES, clamp, parseSamples, sampleHint, sampleCostFraction, estimatePool,
  recommendBid, optimalFinalGuess, refinePoolFromResults, inferOpponentProfiles,
  learnAcrossRounds, calibratePoolEstimate, recommendSampleCount,
  OPPONENT_PROFILES, roundScore, guessPayout
} from "./engine.js";

const STORAGE_KEY = "quant-comp-scavenger-v1";
document.getElementById("reset-game").addEventListener("click",()=>{
  if(!window.confirm("Reset ALL Scavenger data? This permanently erases all five rounds, auction results, guesses, and learned opponent history. This cannot be undone."))return;
  try{localStorage.removeItem(STORAGE_KEY);}
  catch{window.alert("Could not clear saved data. Reset cancelled.");return;}
  window.location.reload();
});
const NAMES = ["Info", "Auction 1", "Auction 2", "Auction 3", "Final guess"];
const WINDOW_SECONDS = [60, 60, 60, 60, 90];
const $ = (id) => document.getElementById(id);
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const number = (v, fallback = 0) => {
  if (v === "" || v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const format = (value, digits = 1) => Number.isFinite(value)
  ? Number(value).toLocaleString("en-CA",{maximumFractionDigits:digits}) : "—";
const percent = (v) => format(100*v,1)+"%";

function newRound() {
  return {phase:0,roomSize:6,percentile:"",sampleCount:"0",samples:"",anchor:"",
    auctions:[{bid:"",rank:"",payout:""},{bid:"",rank:"",payout:""},{bid:"",rank:"",payout:""}],
    finalGuess:"",actualPool:""};
}
function defaultState() {
  return {version:1,activeRound:0,roomSize:6,style:"auto",risk:0.35,
    crossRoundLearning:true,
    rounds:Array.from({length:5},()=>newRound())};
}
function loadState() {
  try {
    const raw=JSON.parse(localStorage.getItem(STORAGE_KEY));
    if(raw?.version!==1 || !Array.isArray(raw.rounds)||raw.rounds.length!==5)return defaultState();
    const clean=defaultState();
    clean.activeRound=clamp(number(raw.activeRound),0,4);
    clean.roomSize=raw.roomSize===7?7:6;
    clean.style=["auto","cautious","normal","aggressive"].includes(raw.style)?raw.style:"auto";
    clean.risk=clamp(number(raw.risk),0,1);
    clean.crossRoundLearning=raw.crossRoundLearning!==false;
    clean.rounds=raw.rounds.map(item=>({
      ...newRound(),...(item||{}),phase:clamp(number(item?.phase),0,4),
      roomSize:item?.roomSize===7?7:item?.roomSize===6?6:clean.roomSize,
      auctions:Array.from({length:3},(_,i)=>({
        bid:String(item?.auctions?.[i]?.bid??""),
        rank:String(item?.auctions?.[i]?.rank??""),
        payout:String(item?.auctions?.[i]?.payout??"")
      }))
    }));
    return clean;
  }catch {return defaultState();}
}
let state=loadState();
let recommendation=null;
let deadline=null,remaining=60,interval=null,toastTimeout;
const current=()=>state.rounds[state.activeRound];
const phase=()=>current().phase;
const save=()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch{}};
function note(message) {
  const node=$("toast");node.textContent=message;node.classList.add("show");
  clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>node.classList.remove("show"),2900);
}
function setPhase(next) {
  current().phase=clamp(next,0,4);
  save();render();resetTimer();
}
function setRound(next) {
  state.activeRound=clamp(next,0,4);
  save();render();resetTimer();
}
function metric(label,value,small=false) {
  return '<div class="metric"><div class="metric-label">'+escape(label)+'</div><div class="metric-value'+(small?' small':'')+'">'+escape(value)+'</div></div>';
}
function pair(key,val) {return '<div class="journal-bottom"><span>'+escape(key)+'</span><strong>'+escape(val)+'</strong></div>';}
function inputField(label,key,type="number",noteText="") {
  return '<div class="field"><label for="'+key+'">'+escape(label)+'</label>'+
    '<input class="input" id="'+key+'" data-field="'+key+'" type="'+type+'" inputmode="'+(type==="number"?"decimal":"text")+
    '" value="'+escape(current()[key])+'" autocomplete="off" spellcheck="false">'+
    (noteText?'<span class="hint">'+escape(noteText)+'</span>':'')+'</div>';
}
function choiceButtons(options,selected,dataName) {
  return '<div class="choice-row">'+options.map(([value,label])=>
    '<button type="button" class="choice-btn'+(String(value)===String(selected)?' selected':'')+
    '" data-choice="'+dataName+'" data-value="'+escape(value)+'">'+escape(label)+'</button>').join("")+'</div>';
}
function samplePane() {
  const r=current();
  const history=learnAcrossRounds(state.rounds,state.activeRound,{enabled:state.crossRoundLearning});
  const suggested=recommendSampleCount(number(r.percentile,50),history).count;
  return '<div class="field"><label for="percentile">Given distribution percentile</label>'+
    '<div class="stepper"><button type="button" class="step-btn" data-step="-1" aria-label="Percentile minus one">−</button>'+
    '<input class="input" id="percentile" data-field="percentile" type="number" min="0" max="100" step="1" inputmode="numeric" placeholder="e.g. 80" value="'+escape(r.percentile)+'" aria-label="Given percentile">'+
    '<button type="button" class="step-btn" data-step="1" aria-label="Percentile plus one">+</button></div>'+
    '<span class="hint">Required. Copy the displayed percentile, not a sample value. Blank means no pool estimate yet.</span></div>'+
    '<div class="field"><div class="field-inline"><label>Number of samples purchased</label><span class="annotation" id="costAnnotation"></span></div>'+
    '<div class="choice-row" id="sampleChoices">'+[0,1,2,3,4,6,9].map(n=>
      '<button type="button" class="choice-btn mini'+(number(r.sampleCount)===n?' selected':'')+
      '" data-choice="sampleCount" data-value="'+n+'">'+n+'</button>').join("")+'</div>'+
    '<div class="field-inline small-manual"><label for="sampleCountManual">Or enter a custom count</label>'+
    '<input class="input short-input" data-field="sampleCount" id="sampleCountManual" type="number" min="0" step="1" inputmode="numeric" value="'+escape(r.sampleCount)+'"></div>'+
    '<span class="hint">Count of samples you ACTUALLY purchased, not merely typed. Model starting point: '+suggested+'. Sample cost grows as √n/12 of the pool.</span></div>'+
    '<div class="field"><label for="samples">Observed sample values</label>'+
    '<textarea id="samples" data-field="samples" class="textarea" inputmode="decimal" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="e.g. 420 520 390 610">'+escape(r.samples)+'</textarea>'+
    '<span class="hint">Type or paste the values shown after purchase. Separate by spaces, commas, or new lines. Entries update the estimate immediately.</span></div>'+
    '<div class="field"><label for="anchor">Optional rough pool estimate (if no samples)</label>'+
    '<input class="input" data-field="anchor" id="anchor" type="number" inputmode="decimal" placeholder="Leave empty when using samples" value="'+escape(r.anchor)+'">'+
    '<span class="hint">Optional backup, only if you have no samples. A guess at the pool scale does not count as observed evidence.</span></div>'+
    '<button type="button" class="button secondary full" data-nav="1">Go to auction 1 →</button>';
}
function auctionPane(i) {
  const r=current(),a=r.auctions[i],third=i===2;
  return '<div class="field"><div class="field-inline"><label>Room size</label></div>'+
    choiceButtons([[6,"6 players"],[7,"7 players"]],current().roomSize,"roomSize")+
    '<span class="hint">Include yourself when counting the players in your room. Select 6 or 7 from the competition display.</span></div>'+
    '<div class="field"><label>Opponent tendency (optional)</label>'+
    choiceButtons([["auto","AUTO"],["cautious","Mostly low"],["normal","Mixed"],["aggressive","Mostly high"]],state.style,"style")+
    '<span class="hint">AUTO updates probabilities using your bid rank after each auction. Choose a manual tendency only when you have independent evidence. Rival bids are not normally shown.</span></div>'+
    '<div class="field"><label for="risk">Downside sensitivity <span id="riskValue" class="annotation">'+(Math.round(state.risk*100))+'%</span></label>'+
    '<input id="risk" data-global-field="risk" type="range" min="0" max="100" step="10" value="'+Math.round(state.risk*100)+'" style="width:100%;accent-color:var(--teal)">'+
    '<span class="hint">0% seeks the highest average payoff. At 100%, bid score subtracts 0.35 × simulated payout standard deviation. This does NOT cap losses. Use 35% as a cautious starting point.</span></div>'+
    '<div class="divider"></div>'+
    '<div class="field"><label for="actualBid">Your submitted bid</label>'+
    '<input id="actualBid" class="input" data-auction="'+i+'" data-auction-field="bid" type="number" inputmode="numeric" min="0" step="1" value="'+escape(a.bid)+'" placeholder="Use recommendation or enter actual bid"></div>'+
    '<div class="field"><label>Rank shown after auction</label>'+
    '<div class="choice-row rank-buttons" id="rankChoices">'+Array.from({length:current().roomSize},(_,j)=>j+1).map(j=>
      '<button type="button" class="choice-btn mini'+(number(a.rank)===j?' selected':'')+'" data-rank="'+j+'" data-auction="'+i+'">'+j+'</button>').join("")+'</div>'+
    '<span class="hint">1 = lowest bid, '+current().roomSize+' = highest bid. Leave empty before results.</span></div>'+
    '<div class="field"><label for="actualPayout">Your payout after this auction</label>'+
    '<input id="actualPayout" class="input" data-auction="'+i+'" data-auction-field="payout" type="number" step="any" inputmode="decimal" value="'+escape(a.payout)+'" placeholder="Enter displayed points">'+
    '<span class="hint">Use the exact points shown in the result screen. Negative payout is possible if you were the highest bidder.</span></div>'+
    '<div class="row-note"><strong>Round '+(i+1)+' of 3'+(third?' · 2× weighted':'')+'.</strong> '+
    'The three lowest bids win their bids subject to the pool cap. The highest bid receives the remainder minus its absolute bid error. All other bids earn zero.</div>'+
    '<div class="spaced inline-actions"><button type="button" class="button secondary" data-nav="'+(i===2?4:i+2)+'">'+
    (i===2?'Go to final guess':'Next auction →')+'</button>'+
    '<button type="button" class="button" data-nav="'+Math.max(0,i)+'">← Back</button></div>'+
    '<div class="kbd">Alt + Enter fills the recommended bid. Results remain editable.</div>';
}
function finalPane() {
  const r=current();
  return '<div class="field"><label for="finalGuess">Your submitted final guess</label>'+
    '<input class="input" id="finalGuess" type="number" min="0" step="1" inputmode="numeric" data-field="finalGuess" value="'+escape(r.finalGuess)+'" placeholder="Use recommendation or type guess">'+
    '<span class="hint">Final guess pays max(pool ÷ 4 − |guess − pool|, 0). Enter an integer.</span></div>'+
    '<div class="field"><label for="actualPool">Actual pool size, if eventually revealed</label>'+
    '<input class="input" id="actualPool" type="number" step="any" inputmode="decimal" data-field="actualPool" value="'+escape(r.actualPool)+'" placeholder="Optional, for round scoring"></div>'+
    '<div class="spaced inline-actions"><button type="button" class="button secondary" id="nextRound">Finish round / next round →</button>'+
    '<button type="button" class="button" data-nav="3">← Auction 3</button></div>';
}
function renderJournal() {
  const r=current(),samples=parseSamples(r.samples);
  const rows=r.auctions.map((a,i)=>
    '<tr><td>A'+(i+1)+(i===2?' · 2×':'')+'</td><td>'+escape(a.bid||"—")+'</td><td>'+escape(a.rank||"—")+'</td><td>'+escape(a.payout||"—")+'</td></tr>').join("");
  const count=number(r.sampleCount);
  const known=r.actualPool!=="" && number(r.actualPool)>=0;
  const raw=r.auctions.reduce((s,a,i)=>s+number(a.payout)*(i===2?2:1),0);
  let footer=pair("Observed samples",samples.length+" / "+count+" bought");
  footer+=pair("Weighted auction payouts",format(raw));
  footer+=pair("Sample cost",known?format(number(r.actualPool)*sampleCostFraction(count)):"√n / 12 of pool");
  if(known){
    const payout=r.finalGuess!==""?guessPayout(number(r.actualPool),number(r.finalGuess)):0;
    footer+=pair("Final guess points",format(payout));
    footer+=pair("Total round score",format(roundScore(number(r.actualPool),count,r.auctions.map(a=>number(a.payout)))+payout));
  }
  $("journal").innerHTML='<table class="journal-table"><thead><tr><th>Phase</th><th>Bid</th><th>Rank</th><th>Payout</th></tr></thead><tbody>'+rows+'</tbody></table>'+
    '<div class="journal-stats">'+footer+'</div>'+
    '<div class="journal-bottom"><button type="button" class="lowkey" id="clearRound">Reset this round</button>'+
    '<span>Saved automatically</span></div>';
}

const GUIDE_COMMON=[
  ["Round 1–5","Earlier rounds provide a weak strategic prior. The current room still gets its own rapidly updated opponent model. No later round is used when reviewing an earlier one."],
  ["Phase buttons","Use Info, A1, A2, A3, Final. Switch immediately when the official game advances."],
  ["Timer","Tap Start when a phase starts. This is only your local countdown, not the official clock. Reset restarts this phase's countdown."]
];
const GUIDE_PHASES=[
  [
    ["Given percentile","Enter the percentile displayed by the game, like 80 for 80th percentile. It is not the pool size."],
    ["Samples purchased","The number n you actually bought. Presets save taps; the custom box accepts other nonnegative integers. Fee = pool × √n / 12."],
    ["Observed values","Enter the purchased sample values as shown, separated by spaces or commas, for example 380 450 590."],
    ["Rough pool estimate","Optional fallback if you have no sample observations. It supplies only a provisional scale and may be badly wrong."]
  ],
  [
    ["Room size","Count your own player plus competitors: 6 or 7 total."],
    ["Opponent tendency","AUTO starts from weak patterns learned across previous rooms and updates using THIS room's ranks. A manual tendency overrides much of that prior."],
    ["Downside sensitivity","0–100% controls your simulated-risk penalty: score = expected payout − 0.35 × slider fraction × simulated payout SD. It cannot guarantee a maximum loss."],
    ["Your submitted bid","Record the integer you actually placed in the competition, or tap Fill bid field to copy the suggested value into this panel."],
    ["Your bid rank","After results, tap your rank. Rank 1 is the lowest bidder; rank 6 or 7 is the highest. The game provides your rank and payout, not rivals' full bids."],
    ["Your payout","Enter your own actual auction points exactly, including negative payouts. This can tighten the pool estimate."],
    ["Counterplay rows","The panel shows how you could respond if competitors were mostly low, mixed, or high bidders. They are scenario tests, not known opponent bids."]
  ],
  [
    ["Your final guess","Use the integer in the recommendation and submit it on the competition screen. Fill final guess only records it in this panel."],
    ["Actual pool size","Enter the revealed actual pool. This supplies verified training data for later rounds and enables round scoring. A rank-1 payout below your bid can also reveal the pool."]
  ]
];
function guideLine([label,description]) {
  return '<div class="guide-line"><strong>'+escape(label)+'</strong><span>'+escape(description)+'</span></div>';
}
function renderGuide() {
  const p=phase();
  const stage=p===0?GUIDE_PHASES[0]:p===4?GUIDE_PHASES[2]:GUIDE_PHASES[1];
  $("guideContent").innerHTML='<div class="guide-list">'+
    GUIDE_COMMON.concat(stage).map(guideLine).join("")+'</div>';
}
function renderCounterplay(bidResult,pool,learning) {
  const p=phase(),r=current();
  const through=Math.min(3,p);
  const observations=r.auctions.slice(0,through).filter(a=>a.bid!==""&&a.rank!=="");
  const profile=inferOpponentProfiles({estimate:pool,history:observations,
    roomSize:current().roomSize,style:state.style,seed:state.activeRound*997+2026,
    historicalWeights:learning?.historicalWeights});
  $("opponentStatus").textContent=profile.observations+" / 3 RANKS";
  const top=OPPONENT_PROFILES.find(item=>item.key===profile.dominant);
  const certainty=profile.observations===0?
    (learning?.rankCount?"Prior rounds + fresh room":"Starting assumptions"):
    profile.observations===1?"1 observation in current room":"Updating with current-room ranks";
  const items=OPPONENT_PROFILES.map(item=>{
    const pct=Math.round(100*profile.weights[item.key]);
    return '<div class="profile-line"><div><span>'+escape(item.label)+'</span><strong>'+pct+'%</strong></div>'+
      '<div class="profile-track"><span style="width:'+pct+'%"></span></div></div>';
  }).join("");
  $("opponentInsights").innerHTML=
    '<div class="profile-heading">'+escape(certainty)+'</div>'+
    '<div class="profile-bars">'+items+'</div>'+
    '<div class="row-note counter-tip"><strong>Counterplan:</strong> '+escape(top.counter)+'</div>'+
    '<p class="hint">Scenario percentages reflect previous-round patterns (when enabled), your manual tendency, and current-room bid ranks. Different rounds have different opponents. These are not measured player proportions.</p>';
  let candidates=bidResult;
  let phaseLabel=p>=1&&p<=3?"Current auction":"";
  const currentFinished=p>=1&&p<3&&r.auctions[p-1].bid!==""&&r.auctions[p-1].rank!=="";
  if(currentFinished && pool) {
    candidates=recommendBid({estimate:pool,roomSize:current().roomSize,
      history:observations,style:state.style,risk:state.risk,learning,
      phase:p+1,seed:state.activeRound*997+2026});
    phaseLabel="Next auction";
  }
  if(p===0){
    $("opponentCounters").innerHTML='<p class="hint spaced">Auction counterbids appear when you reach Auction 1.</p>';
  }else if(p===4){
    $("opponentCounters").innerHTML='<p class="hint spaced">All auction ranks are logged. Focus on the final pool guess.</p>';
  }else if(!candidates){
    $("opponentCounters").innerHTML='<p class="hint spaced">Enter the percentile and sample values, or a manual pool estimate, to calculate counterbids.</p>';
  }else{
    $("opponentCounters").innerHTML='<div class="counter-title">COUNTERBIDS BY OPPONENT STRATEGY <span>'+escape(phaseLabel)+'</span></div>'+
      '<div class="counter-grid">'+candidates.profileCounterBids.map(item=>
        '<div class="counter-row"><div><strong>'+escape(item.label)+'</strong>'+
        '<span>EV '+format(item.expected)+' pts · Loss '+percent(item.lossProbability)+'</span></div>'+
        '<div class="counter-number">'+format(item.bid,0)+'</div></div>'
      ).join("")+'</div>'+
      '<p class="hint spaced">Each row assumes that particular crowd style dominates. The large recommendation above combines all three scenarios using their current estimated probabilities.</p>';
  }
}


function renderLearning(learning,rawEstimate,calibratedEstimate) {
  const flag=learning.enabled,has=learning.verifiedPoolCount||learning.rankCount;
  const toggler=$("toggleLearning");
  toggler.textContent=flag?"Prior rounds ON":"Prior rounds OFF";
  toggler.setAttribute("aria-pressed",flag?"true":"false");
  const status=$("learningStatus");
  status.textContent=!flag?"OFF":!has?"NO HISTORY":learning.verifiedPoolCount+" POOLS · "+learning.rankCount+" RANKS";
  const stats=[];
  stats.push(pair("Previous rounds available",learning.priorRounds+" / 4"));
  stats.push(pair("Verified previous pools",String(learning.verifiedPoolCount)));
  stats.push(pair("Prior auction ranks used",String(learning.rankCount)));
  stats.push(pair("Previous pool relative error",learning.avgRelativePoolError===null?"Need outcomes":percent(learning.avgRelativePoolError)));
  if(learning.bestFamily)stats.push(pair("Best historical candidate",learning.bestFamily));
  if(learning.rankCount)stats.push(pair("Prior rival bid scale",format(learning.roomScale,2)+"×"));
  if(rawEstimate && calibratedEstimate && rawEstimate!==calibratedEstimate){
    const difference=calibratedEstimate.value-rawEstimate.value;
    stats.push(pair("Current pool model shift",(difference>=0?"+":"")+format(difference)));
  }
  const modelRows=learning.rows.filter(x=>x.poolKnown||x.ranks).map(x=>
    '<div class="learning-history"><span>Round '+x.round+'</span><span>'+
    (x.poolKnown?"Pool "+(x.poolSource==="entered"?"entered":"inferred")+
      (x.error!==null?" · error "+percent(x.error):" · no samples"):
      "No verified pool")+
    '</span><strong>'+x.ranks+' ranks</strong></div>'
  ).join("");
  const note=!flag?
    "Historical learning is disabled for this round. Your saved results are unchanged. Current-round auctions still adapt.":
    !has?"Record rank results in earlier rounds. Enter the actual pool after each round, or log a capped lowest-bid payout, to train the pool estimator.":
    "Only earlier rounds train this model. Previous pool outcomes reweight distribution candidates. Previous bid ranks give a weak prior for a new room. Live auction ranks still carry more weight.";
  $("learningDetails").innerHTML=
    '<div class="learning-stats">'+stats.join("")+'</div>'+
    (modelRows?'<div class="learning-history-list">'+modelRows+'</div>':"")+
    '<p class="hint spaced">'+escape(note)+'</p>';
}

function render() {
  const r=current(),p=r.phase;
  $("roundButtons").innerHTML=state.rounds.map((round,i)=>
    '<button type="button" data-round="'+i+'" class="round-button'+(i===state.activeRound?' active':'')+
    (round.finalGuess!==""?' done':'')+'">'+(i+1)+'</button>').join("");
  $("phases").innerHTML=NAMES.map((title,i)=>
    '<button type="button" class="phase-button'+(p===i?' active':i<p?' finished':'')+
    '" data-nav="'+i+'" aria-current="'+(i===p?'step':'false')+'"><span class="phase-num">'+String(i+1).padStart(2,"0")+
    '</span><span class="phase-name">'+escape(title)+'</span></button>').join("");
  $("inputHeading").textContent=p===0?"Information stage":p===4?"Final pool-size guess":NAMES[p];
  $("phaseTag").textContent=String(p+1).padStart(2,"0")+" / 05";
  $("inputFields").innerHTML=p===0?samplePane():p===4?finalPane():auctionPane(p-1);
  $("timerPhase").textContent=p===0?"INFO WINDOW":p===4?"FINAL GUESS":"BID WINDOW";
  renderGuide();
  renderAdvice();
  renderJournal();
  renderTimer();
}
function renderAdvice() {
  const r=current(),p=r.phase;
  const learning=learnAcrossRounds(state.rounds,state.activeRound,{enabled:state.crossRoundLearning});
  const initialPool=r.percentile===""?null:estimatePool({percentile:number(r.percentile),samples:r.samples,anchor:r.anchor});
  const calibrated=calibratePoolEstimate(initialPool,learning);
  const pool=p===0?calibrated:refinePoolFromResults(calibrated,r.auctions.slice(0,p-1),current().roomSize);
  const cost=sampleCostFraction(number(r.sampleCount));
  let currentBidResult=null;
  const metrics=[],set=(k,v)=>metrics.push(metric(k,v));
  $("confidenceChip").textContent=pool?.confidence||"NO SCALE";
  $("actionNumber").classList.remove("missing");
  if(p===0){
    const samples=recommendSampleCount(number(r.percentile,50),learning);
    const hint=samples.count;
    recommendation=hint;
    $("actionLabel").textContent="Suggested sample purchase";
    $("actionNumber").textContent=String(hint);
    $("actionSub").textContent="Samples · "+percent(sampleCostFraction(hint))+" of pool as fee";
    set("Current sample fee",percent(cost)+" of pool");
    set("Entered / purchased",parseSamples(r.samples).length+" / "+number(r.sampleCount));
    if(pool){set("Estimated pool",format(pool.value));set("Model range",format(pool.lo)+" to "+format(pool.hi));}
    else{set("Pool estimate","Need scale");set("Estimate confidence","Not available");}
    $("modelNote").textContent=samples.reason+" Sample purchasing is heuristic: previous outcomes cannot tell us what would have happened if we had bought a different number. Buying samples costs pool × √n / 12.";
    $("ruleReminder").innerHTML="<strong>60 seconds.</strong> Buy samples at cost pool × √n / 12. You receive the pool's distribution percentile but not its distribution or parameters. Negative net scores are possible.";
  }else if(p>=1&&p<=3){
    const history=r.auctions.slice(0,p-1).filter(a=>a.bid!==""&&a.rank!=="");
    const result=recommendBid({estimate:pool,roomSize:current().roomSize,style:state.style,
      history,phase:p,risk:state.risk,learning,seed:state.activeRound*997+2026});
    currentBidResult=result;
    recommendation=result?.bid??null;
    $("actionLabel").textContent="Recommended integer bid"+(p===3?" · 2× round":"");
    $("actionNumber").textContent=result?format(result.bid,0):"Need estimate";
    $("actionNumber").classList.toggle("missing",!result);
    $("actionSub").textContent=result?"Highest risk-adjusted payout across modeled rival strategies":"Enter the percentile and sample values, or a manual pool estimate, in Info";
    if(result){
      set("Expected payout",format(result.expected)+" pts");
      set("Positive payout",percent(result.winProbability));
      set("Loss probability",percent(result.lossProbability));
      set("Pool 10–90% range",format(result.range[0])+" – "+format(result.range[1]));
      set("Rival bid adjustment",format(result.roomScale,2)+"×");
      set("Pool estimate",format(pool.value));
    } else {set("Available pool scale","None");set("Auction rank","1–3 or highest pays");}
    $("modelNote").textContent="Simulates low-, mixed- and high-bid opponents. Prior rounds provide weak shared assumptions; ranks from THIS round update the current room. Downside sensitivity penalizes volatility, not worst-case loss.";
    $("ruleReminder").innerHTML="<strong>Auction "+p+" of 3.</strong> One nonnegative integer bid. Lowest three bids get capped payouts. Highest gets remainder − |remainder − bid| and can lose points. Other ranks get 0. Auction 3 earns double points in the round score.";
  }else{
    const result=optimalFinalGuess(pool,{seed:state.activeRound*113+2026});
    recommendation=result?.guess??null;
    $("actionLabel").textContent="Recommended final guess";
    $("actionNumber").textContent=result?format(result.guess,0):"Need estimate";
    $("actionNumber").classList.toggle("missing",!result);
    $("actionSub").textContent=result?"Highest modeled expected final-guess points":"Enter the percentile and samples, or manual pool estimate, in Info";
    if(result){
      set("Expected guess payout",format(result.expected)+" pts");
      set("Chance to earn points",percent(result.chance));
      set("Model pool median",format(result.mid));
      set("Pool 10–90% range",format(result.low)+" – "+format(result.high));
    }else{set("Available pool scale","None");}
    $("modelNote").textContent="The engine maximizes the exact final-guess reward over simulated possible pool values. The best guess may differ from a sample mean or median because the reward is truncated at zero.";
    $("ruleReminder").innerHTML="<strong>90 seconds.</strong> Final guess reward is max(pool/4 − |guess − pool|, 0). Total round score is A1 + A2 + 2×A3 + final guess − pool×√n/12.";
  }
  $("metrics").innerHTML='<div class="metric-grid">'+metrics.join("")+'</div>';
  renderCounterplay(currentBidResult,pool,learning);
  renderLearning(learning,initialPool,calibrated);
  const canUse=recommendation!==null;
  $("useSuggestion").disabled=!canUse;
  $("copySuggestion").disabled=!canUse;
  $("useSuggestion").textContent=p===0?"Set sample count":p===4?"Fill final guess":"Fill bid field";
  const costEl=$("costAnnotation");
  if(costEl)costEl.textContent=percent(cost)+" OF POOL";
}
function updateChoice(key,value) {
  if(key==="sampleCount"){current().sampleCount=value;}
  else if(key==="roomSize"){current().roomSize=Number(value)===7?7:6;}
  else if(key==="style"){state.style=value;}
  save();render();
}
function useRecommendation() {
  if(recommendation===null)return;
  const p=phase(),r=current();
  if(p===0){r.sampleCount=String(recommendation);save();render();note("Sample count set. Purchase samples in the competition interface.");}
  else if(p===4){r.finalGuess=String(recommendation);save();render();note("Guess filled. Submit it in the competition interface.");}
  else {
    r.auctions[p-1].bid=String(recommendation);save();render();
    note("Bid filled. Submit it in the competition interface.");
  }
}
function renderTimer() {
  const el=$("timerDisplay");
  const seconds=Math.max(0,Math.ceil(remaining));
  el.textContent=String(Math.floor(seconds/60)).padStart(2,"0")+":"+String(seconds%60).padStart(2,"0");
  $("timerToggle").textContent=deadline?"Pause":"Start";
  document.querySelector(".clock")?.classList.toggle("warning",seconds<=15);
}
function tick() {
  if(deadline!==null){remaining=Math.max(0,(deadline-Date.now())/1000);
    if(remaining<=0){deadline=null;note("Phase timer ended.");}
  }
  renderTimer();
}
function resetTimer() {deadline=null;remaining=WINDOW_SECONDS[phase()];renderTimer();}
function toggleTimer() {
  if(deadline!==null){remaining=Math.max(0,(deadline-Date.now())/1000);deadline=null;}
  else deadline=Date.now()+Math.max(0,remaining)*1000;
  tick();
}
function handleInput(e) {
  const el=e.target;
  if(el.dataset.globalField==="risk"){
    state.risk=clamp(number(el.value)/100,0,1);$("riskValue").textContent=Math.round(state.risk*100)+"%";
  }else if(el.dataset.auctionField){
    current().auctions[number(el.dataset.auction)][el.dataset.auctionField]=el.value;
  }else if(el.dataset.field){
    current()[el.dataset.field]=el.value;
    if(el.dataset.field==="samples") {
      const observed=parseSamples(el.value).length;
      if(number(current().sampleCount)<observed) {
        current().sampleCount=String(observed);
        document.querySelectorAll('[data-choice="sampleCount"]').forEach(btn=>
          btn.classList.toggle("selected",number(btn.dataset.value)===observed));
      }
    }
    if(el.dataset.field==="percentile"&&el.value!==""){
      current().percentile=String(clamp(number(el.value),0,100));
    }
  }else return;
  save();
  if(el.dataset.field || el.dataset.auctionField || el.dataset.globalField==="risk"){
    clearTimeout(handleInput.delayed);
    handleInput.delayed=setTimeout(renderAdvice,70);
  }
  if(el.dataset.field==="sampleCount"||el.dataset.field==="samples") {
    const b=document.querySelectorAll('[data-choice="sampleCount"]');
    b.forEach(btn=>btn.classList.toggle("selected",Number(btn.dataset.value)===number(current().sampleCount)));
    const c=$("costAnnotation");if(c)c.textContent=percent(sampleCostFraction(number(current().sampleCount)))+" OF POOL";
  }
  renderJournal();
}
document.addEventListener("input",handleInput);
document.addEventListener("click",async (event)=>{
  const button=event.target.closest("button");
  if(!button)return;
  if(button.id==="toggleLearning"){
    state.crossRoundLearning=!state.crossRoundLearning;save();render();
    note(state.crossRoundLearning?"Using earlier rounds in recommendations.":"Historical learning off. Past data preserved.");
    return;
  }
  if(button.id==="timerToggle")return toggleTimer();
  if(button.id==="timerReset")return resetTimer();
  if(button.id==="useSuggestion")return useRecommendation();
  if(button.id==="copySuggestion"){
    if(recommendation===null)return;
    try{await navigator.clipboard.writeText(String(recommendation));note("Copied "+recommendation);}
    catch{note("Clipboard unavailable. Use the recommendation shown above.");}
    return;
  }
  if(button.id==="clearRound"){
    if(!window.confirm("Reset only this round? Existing inputs and results will be lost."))return;
    state.rounds[state.activeRound]=newRound();save();render();resetTimer();return;
  }
  if(button.id==="nextRound"){setRound(Math.min(4,state.activeRound+1));return;}
  if(button.dataset.round!==undefined)return setRound(number(button.dataset.round));
  if(button.dataset.nav!==undefined)return setPhase(number(button.dataset.nav));
  if(button.dataset.choice)return updateChoice(button.dataset.choice,button.dataset.value);
  if(button.dataset.rank!==undefined){
    const i=number(button.dataset.auction);
    const old=current().auctions[i].rank;
    current().auctions[i].rank=old===button.dataset.rank?"":button.dataset.rank;
    save();render();
    return;
  }
  if(button.dataset.step!==undefined){
    current().percentile=String(clamp(number(current().percentile,50)+number(button.dataset.step),0,100));
    save();render();return;
  }
});
document.addEventListener("keydown",e=>{
  if(e.altKey&&!e.ctrlKey&&!e.metaKey){
    if(/^[1-5]$/.test(e.key)){e.preventDefault();setPhase(Number(e.key)-1);}
    else if(e.key==="Enter"){e.preventDefault();useRecommendation();}
  }
});
interval=setInterval(tick,150);
remaining=WINDOW_SECONDS[phase()];
render();
if("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("../sw.js").catch(()=>{});
}
