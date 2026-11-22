import {
  PHASES, clamp, parseSamples, sampleHint, sampleCostFraction, estimatePool,
  recommendBid, optimalFinalGuess, roundScore, guessPayout
} from "./engine.js";

const STORAGE_KEY = "quant-comp-scavenger-v1";
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
  return {phase:0,percentile:"50",sampleCount:"0",samples:"",anchor:"",
    auctions:[{bid:"",rank:"",payout:""},{bid:"",rank:"",payout:""},{bid:"",rank:"",payout:""}],
    finalGuess:"",actualPool:""};
}
function defaultState() {
  return {version:1,activeRound:0,roomSize:6,style:"normal",risk:0,
    rounds:Array.from({length:5},()=>newRound())};
}
function loadState() {
  try {
    const raw=JSON.parse(localStorage.getItem(STORAGE_KEY));
    if(raw?.version!==1 || !Array.isArray(raw.rounds)||raw.rounds.length!==5)return defaultState();
    const clean=defaultState();
    clean.activeRound=clamp(number(raw.activeRound),0,4);
    clean.roomSize=raw.roomSize===7?7:6;
    clean.style=["cautious","normal","aggressive"].includes(raw.style)?raw.style:"normal";
    clean.risk=clamp(number(raw.risk),0,1);
    clean.rounds=raw.rounds.map(item=>({
      ...newRound(),...(item||{}),phase:clamp(number(item?.phase),0,4),
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
  const r=current(), suggested=sampleHint(number(r.percentile,50));
  return '<div class="field"><label for="percentile">Given distribution percentile</label>'+
    '<div class="stepper"><button type="button" class="step-btn" data-step="-1" aria-label="Percentile minus one">−</button>'+
    '<input class="input" id="percentile" data-field="percentile" type="number" min="0" max="100" step="1" inputmode="numeric" value="'+escape(r.percentile)+'" aria-label="Given percentile">'+
    '<button type="button" class="step-btn" data-step="1" aria-label="Percentile plus one">+</button></div>'+
    '<span class="hint">Enter the percentile the game shows, 0 to 100. The distribution family and parameters are unknown.</span></div>'+
    '<div class="field"><div class="field-inline"><label>Number of samples purchased</label><span class="annotation" id="costAnnotation"></span></div>'+
    '<div class="choice-row" id="sampleChoices">'+[0,1,2,3,4,6,9].map(n=>
      '<button type="button" class="choice-btn mini'+(number(r.sampleCount)===n?' selected':'')+
      '" data-choice="sampleCount" data-value="'+n+'">'+n+'</button>').join("")+'</div>'+
    '<span class="hint">Model starting point: '+suggested+' samples. This is a heuristic, not a proven optimal purchase.</span></div>'+
    '<div class="field"><label for="samples">Observed sample values</label>'+
    '<textarea id="samples" data-field="samples" class="textarea" inputmode="decimal" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="e.g. 420 520 390 610">'+escape(r.samples)+'</textarea>'+
    '<span class="hint">Fast entry: type numbers separated by spaces, commas or new lines. Paste all at once if possible.</span></div>'+
    '<div class="field"><label for="anchor">Optional rough pool estimate (if no samples)</label>'+
    '<input class="input" data-field="anchor" id="anchor" type="number" inputmode="decimal" placeholder="Leave empty when using samples" value="'+escape(r.anchor)+'">'+
    '<span class="hint">Percentile alone cannot determine the pool size. An estimate provides a provisional scale, not new evidence.</span></div>'+
    '<button type="button" class="button secondary full" data-nav="1">Go to auction 1 →</button>';
}
function auctionPane(i) {
  const r=current(),a=r.auctions[i],third=i===2;
  return '<div class="field"><div class="field-inline"><label>Room size</label></div>'+
    choiceButtons([[6,"6 players"],[7,"7 players"]],state.roomSize,"roomSize")+'</div>'+
    '<div class="field"><label>Opponent bid model</label>'+
    choiceButtons([["cautious","Cautious"],["normal","Typical"],["aggressive","Aggressive"]],state.style,"style")+
    '<span class="hint">Change if previous bids ranked much lower or higher than expected. Recorded bid ranks adjust the next auction automatically.</span></div>'+
    '<div class="field"><label for="risk">Downside sensitivity <span id="riskValue" class="annotation">'+(Math.round(state.risk*100))+'%</span></label>'+
    '<input id="risk" data-global-field="risk" type="range" min="0" max="100" step="10" value="'+Math.round(state.risk*100)+'" style="width:100%;accent-color:var(--teal)">'+
    '<span class="hint">0% maximizes estimated average payout. Higher values penalize volatile outcomes.</span></div>'+
    '<div class="divider"></div>'+
    '<div class="field"><label for="actualBid">Your submitted bid</label>'+
    '<input id="actualBid" class="input" data-auction="'+i+'" data-auction-field="bid" type="number" inputmode="numeric" min="0" step="1" value="'+escape(a.bid)+'" placeholder="Use recommendation or enter actual bid"></div>'+
    '<div class="field"><label>Rank shown after auction</label>'+
    '<div class="choice-row rank-buttons" id="rankChoices">'+Array.from({length:state.roomSize},(_,j)=>j+1).map(j=>
      '<button type="button" class="choice-btn mini'+(number(a.rank)===j?' selected':'')+'" data-rank="'+j+'" data-auction="'+i+'">'+j+'</button>').join("")+'</div>'+
    '<span class="hint">1 = lowest bid, '+state.roomSize+' = highest bid. Leave empty before results.</span></div>'+
    '<div class="field"><label for="actualPayout">Your payout after this auction</label>'+
    '<input id="actualPayout" class="input" data-auction="'+i+'" data-auction-field="payout" type="number" step="any" inputmode="decimal" value="'+escape(a.payout)+'" placeholder="Enter displayed points"></div>'+
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
  renderAdvice();
  renderJournal();
  renderTimer();
}
function renderAdvice() {
  const r=current(),p=r.phase;
  const pool=estimatePool({percentile:number(r.percentile,50),samples:r.samples,anchor:r.anchor});
  const cost=sampleCostFraction(number(r.sampleCount));
  const metrics=[],set=(k,v)=>metrics.push(metric(k,v));
  $("confidenceChip").textContent=pool?.confidence||"NO SCALE";
  $("actionNumber").classList.remove("missing");
  if(p===0){
    const hint=sampleHint(number(r.percentile,50));
    recommendation=hint;
    $("actionLabel").textContent="Suggested sample purchase";
    $("actionNumber").textContent=String(hint);
    $("actionSub").textContent="Samples · "+percent(sampleCostFraction(hint))+" of pool as fee";
    set("Current sample fee",percent(cost)+" of pool");
    set("Entered / purchased",parseSamples(r.samples).length+" / "+number(r.sampleCount));
    if(pool){set("Estimated pool",format(pool.value));set("Model range",format(pool.lo)+" to "+format(pool.hi));}
    else{set("Pool estimate","Need scale");set("Estimate confidence","Not available");}
    $("modelNote").textContent="The sample count is a starting heuristic. With no known distribution parameters or rival bidding behavior, the information purchase cannot be optimized exactly. More samples improve inference but cost more points.";
    $("ruleReminder").innerHTML="<strong>60 seconds.</strong> Buy samples at cost pool × √n / 12. You receive the pool's distribution percentile but not its distribution or parameters. Negative net scores are possible.";
  }else if(p>=1&&p<=3){
    const history=r.auctions.slice(0,p-1).filter(a=>a.bid!==""&&a.rank!=="");
    const result=recommendBid({estimate:pool,roomSize:state.roomSize,style:state.style,
      history,phase:p,risk:state.risk,seed:state.activeRound*997+2026});
    recommendation=result?.bid??null;
    $("actionLabel").textContent="Recommended integer bid"+(p===3?" · 2× round":"");
    $("actionNumber").textContent=result?format(result.bid,0):"Need estimate";
    $("actionNumber").classList.toggle("missing",!result);
    $("actionSub").textContent=result?"Maximizes modeled payout"+(state.risk?" with downside control":""):"Enter samples or a rough pool estimate in Info";
    if(result){
      set("Expected payout",format(result.expected)+" pts");
      set("Positive payout",percent(result.winProbability));
      set("Loss probability",percent(result.lossProbability));
      set("Pool 10–90% range",format(result.range[0])+" – "+format(result.range[1]));
      set("Rival bid adjustment",format(result.roomScale,2)+"×");
      set("Pool estimate",format(pool.value));
    } else {set("Available pool scale","None");set("Auction rank","1–3 or highest pays");}
    $("modelNote").textContent="Optimizes expected payout across simulated pool values and opponent bids. Rank observations from earlier auctions update the rival bid model. Actual rival bids and distributions are unknown. Tied bids are modeled conservatively, after equal-priced rivals.";
    $("ruleReminder").innerHTML="<strong>Auction "+p+" of 3.</strong> One nonnegative integer bid. Lowest three bids get capped payouts. Highest gets remainder − |remainder − bid| and can lose points. Other ranks get 0. Auction 3 earns double points in the round score.";
  }else{
    const result=optimalFinalGuess(pool,{seed:state.activeRound*113+2026});
    recommendation=result?.guess??null;
    $("actionLabel").textContent="Recommended final guess";
    $("actionNumber").textContent=result?format(result.guess,0):"Need estimate";
    $("actionNumber").classList.toggle("missing",!result);
    $("actionSub").textContent=result?"Highest modeled expected final-guess points":"Enter samples or a rough pool estimate in Info";
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
  const canUse=recommendation!==null;
  $("useSuggestion").disabled=!canUse;
  $("copySuggestion").disabled=!canUse;
  $("useSuggestion").textContent=p===0?"Set sample count":p===4?"Fill final guess":"Fill bid field";
  const costEl=$("costAnnotation");
  if(costEl)costEl.textContent=percent(cost)+" OF POOL";
}
function updateChoice(key,value) {
  if(key==="sampleCount"){current().sampleCount=value;}
  else if(key==="roomSize"){state.roomSize=Number(value)===7?7:6;}
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
    if(el.dataset.field==="percentile"&&el.value!==""){
      current().percentile=String(clamp(number(el.value),0,100));
    }
  }else return;
  save();
  if(el.dataset.field==="percentile" || el.dataset.field==="samples" || el.dataset.field==="anchor" ||
    el.dataset.field==="sampleCount" || el.dataset.globalField==="risk"){
    clearTimeout(handleInput.delayed);
    handleInput.delayed=setTimeout(renderAdvice,70);
  }
  if(el.dataset.field==="sampleCount"||el.dataset.field==="samples") {
    const c=$("costAnnotation");if(c)c.textContent=percent(sampleCostFraction(number(current().sampleCount)))+" OF POOL";
  }
  renderJournal();
}
document.addEventListener("input",handleInput);
document.addEventListener("click",async (event)=>{
  const button=event.target.closest("button");
  if(!button)return;
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
