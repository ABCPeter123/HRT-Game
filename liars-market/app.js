import {TYPES,LABELS,SUITS,cardLabel,handSize,parseClaim,formatClaim,
  claimScore,isValidClaim,evaluateGame,payout,opponentStats} from "./engine.js";

const KEY="wqc-liars-market-v1";
const $=id=>document.getElementById(id);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const pct=x=>(100*x).toFixed(1)+"%";
const signed=n=>(n>0?"+":"")+String(n);
const makeRound=()=>({scores:[0,0,0,0],extensions:[4,4,4,4],games:{},history:[]});
const fresh=()=>({round:1,game:1,maxGames:8,mySeat:0,risk:.35,
  rounds:{"1":makeRound(),"2":makeRound(),"3":makeRound()}});
let state=fresh(),zone="hand",builder={type:"pair",a:14,b:13,step:"a"},lastEvaluation=null;
let timerInterval=null,timerUntil=0,timerRemaining=10;
try{
  const fromStorage=JSON.parse(localStorage.getItem(KEY)||"null");
  if(fromStorage&&fromStorage.rounds&&[1,2,3].includes(fromStorage.round)){
    state={...fresh(),...fromStorage};
    for(let i=1;i<=3;i++)if(!state.rounds[i])state.rounds[i]=makeRound();
  }
}catch{}
function store(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch{}}
function round(){return state.rounds[state.round];}
function game(){
  const r=round();
  if(!r.games[state.game])r.games[state.game]={
    hand:[],center:[],claim:null,claimant:(state.mySeat+1)%4,scores:r.scores.slice(),recorded:false};
  const g=r.games[state.game];
  if(!Array.isArray(g.hand))g.hand=[];
  if(!Array.isArray(g.center))g.center=[];
  if(!Array.isArray(g.scores)||g.scores.length!==4)g.scores=r.scores.slice();
  return g;
}
function seatText(i){return "Seat "+(i+1)+(i===state.mySeat?" (you)":"");}
function historyBefore(){return round().history.filter(h=>h.game<state.game);}
function setNotice(message){$("result-note").textContent=message;}
function setClaim(c,claimant=null){
  if(c!==null&&!isValidClaim(c))return;
  const g=game();g.claim=c;
  if(claimant!==null)g.claimant=claimant;
  $("claim-quick").value=c?shortClaim(c):"";
  renderClaimDisplay();store();calculate();
}
function shortClaim(c){
  if(!c)return "";
  const alias={high:"HC",pair:"P",straight:"ST",two:"2P",three:"TR",full:"FH",
    four:"4K",sf:"SF",five:"5K",six:"6K"};
  return [alias[c.type],LABELS[c.a],c.b?LABELS[c.b]:null].filter(Boolean).join(" ");
}
function renderClaimDisplay(){
  const g=game();
  $("claim-display").textContent=g.claim?formatClaim(g.claim):"None";
  $("claimant").value=String(g.claimant);
}
function renderRoundControls(){
  $("rounds").innerHTML=[1,2,3].map(i=>'<button type="button" data-round="'+i+'" class="'+(state.round===i?"selected":"")+'">Round '+i+"</button>").join("");
  $("max-games").value=String(state.maxGames);
  $("game-number").innerHTML=Array.from({length:state.maxGames},(_,i)=>{
    const n=i+1;return '<option value="'+n+'">'+n+" / "+state.maxGames+"</option>";
  }).join("");
  $("game-number").value=String(state.game);
  $("my-seat").value=String(state.mySeat);
  $("risk").value=String(state.risk);
}
function renderScores(){
  const g=game(),r=round();
  $("scoreboard").innerHTML=g.scores.map((score,i)=>{
    const cards=handSize(Number(score)||0);
    return '<div class="score-box '+(state.mySeat===i?"mine":"")+'"><div class="seat-title">'+seatText(i)+
      '</div><div class="score-edit"><button data-score-step="'+i+':-1" aria-label="Decrease '+seatText(i)+' score">−</button>'+
      '<input aria-label="'+seatText(i)+' points" data-score-seat="'+i+'" type="number" step="1" value="'+score+'">'+
      '<button data-score-step="'+i+':1" aria-label="Increase '+seatText(i)+' score">+</button></div>'+
      '<div class="cards-dealt">'+cards+' cards dealt · '+(r.extensions[i]??4)+' extensions '+
      '<button class="tiny" data-extension="'+i+'" title="Use one +15 second extension">Use 1</button></div></div>';
  }).join("");
  const total=5+g.scores.reduce((n,x)=>n+handSize(Number(x)||0),0);
  $("active-summary").textContent=total+" active cards across four teams and five center cards. "+
    "Jokers can appear in any hand.";
  $("claimant").querySelectorAll("option").forEach((option,i)=>option.textContent=seatText(i));
  $("reactor").querySelectorAll("option").forEach((option,i)=>option.textContent=seatText(i));
}
function renderDeck(){
  const g=game(),hand=new Set(g.hand),center=new Set(g.center);
  $("hand-chips").innerHTML=g.hand.length?g.hand.map(id=>'<button class="chip" data-remove-card="'+id+'">'+cardLabel(id)+' ×</button>').join(""):'<span class="empty">Enter private cards</span>';
  $("center-chips").innerHTML=g.center.length?g.center.map(id=>'<button class="chip" data-remove-card="'+id+'">'+cardLabel(id)+' ×</button>').join(""):'<span class="empty">Enter visible center cards</span>';
  $("deck").innerHTML=SUITS.map((s,si)=>{
    const cards=Array.from({length:13},(_,j)=>{
      const id=si*13+j,tag=hand.has(id)?"in-hand":center.has(id)?"in-center":"";
      return '<button class="playing-card '+tag+' '+((si===1||si===2)?"red":"")+'" data-card="'+id+'" aria-label="'+cardLabel(id)+'">'+LABELS[j+2]+'<small>'+s+'</small></button>';
    }).join("");
    return '<div class="suit-row"><span class="suit-label">'+s+'</span>'+cards+"</div>";
  }).join("")+'<div class="joker-row">'+[52,53].map(id=>'<button class="playing-card joker '+(hand.has(id)?"in-hand":center.has(id)?"in-center":"")+'" data-card="'+id+'">'+cardLabel(id)+"</button>").join("")+"</div>";
  document.querySelectorAll("[data-zone]").forEach(b=>b.classList.toggle("selected",b.dataset.zone===zone));
  const expected=handSize(Number(g.scores[state.mySeat])||0),issues=[];
  if(g.hand.length!==expected)issues.push("Your score implies "+expected+" private cards; entered "+g.hand.length+".");
  if(g.center.length<3)issues.push("Enter the 3 face-up center cards.");
  if(g.center.length>5)issues.push("There are only 5 center cards.");
  $("card-validation").textContent=issues.length?issues.join(" "):"All your private cards entered; 3 to 5 center cards known.";
}
function renderBuilder(){
  $("claim-types").innerHTML=TYPES.map(t=>'<button data-type="'+t[0]+'" class="'+(builder.type===t[0]?"selected":"")+'">'+t[1]+"</button>").join("");
  $("claim-ranks").innerHTML='<span class="mini-label">MAIN RANK</span>'+LABELS.slice(2).map((r,i)=>{
    const a=i+2;
    return '<button data-rank="'+a+'" class="'+(builder.a===a?"selected":"")+'" '+((builder.type==="sf"||builder.type==="straight")&&a<5?"disabled":"")+'>'+r+"</button>";
  }).join("");
  const needsSecond=builder.type==="two"||builder.type==="full";
  $("claim-second").hidden=!needsSecond;
  if(needsSecond){
    $("claim-second").innerHTML='<span class="mini-label">'+(builder.type==="two"?"LOW PAIR":"PAIR RANK")+'</span>'+
      LABELS.slice(2).map((r,i)=>{
        const a=i+2,valid=(builder.type==="two"?a<builder.a:a!==builder.a);
        return '<button data-second="'+a+'" class="'+(builder.b===a?"selected":"")+'" '+(!valid?"disabled":"")+'>'+r+"</button>";
      }).join("");
  }
}
function toggleCard(id){
  const g=game(),key=zone;
  if(g.hand.includes(id)){g.hand=g.hand.filter(x=>x!==id);}
  else if(g.center.includes(id)){g.center=g.center.filter(x=>x!==id);}
  else if(key==="center"&&g.center.length>=5){setNotice("Only five center cards exist.");return;}
  else g[key].push(id);
  g.hand.sort((a,b)=>a-b);g.center.sort((a,b)=>a-b);
  store();renderDeck();calculate();
}
function renderOpponents(){
  const history=historyBefore(),g=game();
  $("opponents").innerHTML=[0,1,2,3].filter(i=>i!==state.mySeat).map(i=>{
    const s=opponentStats(history,i),label=s.n?s.style:"No verified claims";
    return '<div class="opponent"><div><strong>'+seatText(i)+'</strong><span>'+label+
      '</span></div><div><strong>'+pct(s.credibility)+'</strong><span>Credibility · '+s.n+
      ' revealed / '+s.challengeCount+' challenges</span></div></div>';
  }).join("");
  $("counter-note").textContent="Neutral credibility starts at 50%. Known cards remain authoritative. "+
    "Opponent styles are weak estimates; a challenge result is not proof that a player always tells the truth.";
}
function calculate(){
  const start=performance.now(),g=game();
  let evaluation;
  try{
    evaluation=evaluateGame({known:[...g.hand,...g.center],scores:g.scores.map(Number),
      mySeat:state.mySeat,previous:g.claim,claimant:g.claimant,
      history:historyBefore(),downside:Number(state.risk),iterations:400});
  }catch(error){
    lastEvaluation=null;$("reaction-action").textContent="CHECK INPUTS";
    $("reaction-explain").textContent=error.message;
    $("probability").textContent="";$("suggested-claim").textContent="Unavailable";
    $("suggested-prob").textContent="";$("claim-options").textContent="";
    $("use-suggestion").disabled=true;$("perf").textContent="";return;
  }
  lastEvaluation=evaluation;
  const {reaction:r,claims,top,sim}=evaluation;
  const incomplete=g.hand.length!==handSize(Number(g.scores[state.mySeat])||0)||g.center.length<3;
  $("reaction-action").textContent=r?r.action:"ENTER CLAIM";
  $("reaction-action").className="move "+(r?r.action.toLowerCase():"");
  $("probability").textContent=r?"P(exists) "+pct(r.pExists):"";
  $("reaction-explain").textContent=r?
    (r.action==="BLUFF"?"Challenge because the hand is unlikely to exist.":
      r.action==="NUTS"?"Call the claimed hand the highest possible active hand.":
      "Do not challenge on this model. The next player must make a stronger claim.")+
      (incomplete?" Card entry is incomplete; do not rely on this probability.":""):
    "Enter the latest claim to calculate BLUFF / NUTS / PASS. The panel also suggests your next legal claim.";
  $("exist-pct").textContent=r?pct(r.pExists):"—";
  $("nuts-pct").textContent=r?pct(r.pNuts):"—";
  $("bluff-ev").textContent=r?signed(((1-r.pExists)*-payout(g.claim,"bluff-false")+
      r.pExists*-payout(g.claim,"bluff-true")).toFixed(2)):"—";
  $("nuts-ev").textContent=r?signed((r.pNuts*4-(1-r.pNuts)).toFixed(2)):"—";
  $("suggested-claim").textContent=top?formatClaim(top.claim):"No stronger legal hand";
  $("suggested-prob").textContent=top?pct(top.pExists)+(top.guaranteed?" · seen":""):"—";
  $("use-suggestion").disabled=!top;
  $("claim-options").innerHTML=claims.length?claims.map((x,i)=>
    '<button class="claim-option" data-option="'+i+'"><span><strong>'+formatClaim(x.claim)+
    '</strong><small>'+(x.guaranteed?"Already confirmed by known cards":"Uncertain, needs hidden cards")+
    '</small></span><span class="option-p">'+pct(x.pExists)+'</span></button>').join(""):
    '<p class="description">No legal higher claim. The previous claimant wins if the next player cannot raise.</p>';
  $("perf").textContent=sim.trials+" local simulations · "+sim.known+" known / "+sim.total+
    " active cards · "+(performance.now()-start).toFixed(0)+" ms · "+(incomplete?"INCOMPLETE CARD ENTRY":"complete input");
  renderOpponents();
}
function renderAll(){
  const g=game();
  renderRoundControls();renderScores();renderDeck();renderClaimDisplay();renderBuilder();
  $("claim-quick").value=g.claim?shortClaim(g.claim):"";
  $("reactor").value=String((g.claimant+1)%4);
  if(g.recorded){$("record-outcome").disabled=true;setNotice("This sub-game already has a recorded result.");}
  else {$("record-outcome").disabled=false;setNotice("");}
  calculate();store();
}
function changeRound(n){state.round=n;state.game=1;renderAll();}
function changeGame(n){state.game=clamp(n,1,state.maxGames);renderAll();}
$("rounds").addEventListener("click",e=>{
  const b=e.target.closest("[data-round]");if(b)changeRound(Number(b.dataset.round));
});
$("game-number").addEventListener("change",e=>changeGame(Number(e.target.value)));
$("next-game").addEventListener("click",()=>changeGame(Math.min(state.maxGames,state.game+1)));
$("max-games").addEventListener("change",e=>{
  state.maxGames=Number(e.target.value);state.game=Math.min(state.game,state.maxGames);renderAll();
});
$("my-seat").addEventListener("change",e=>{state.mySeat=Number(e.target.value);renderAll();});
$("risk").addEventListener("change",e=>{state.risk=Number(e.target.value);store();calculate();});
$("claimant").addEventListener("change",e=>{game().claimant=Number(e.target.value);store();calculate();});
$("apply-quick").addEventListener("click",()=>{
  const c=parseClaim($("claim-quick").value);
  if(!c){setNotice("Invalid claim. Example: 2P Q 8, FH 9 4, SF K.");return;}
  setClaim(c);setNotice("");
});
$("claim-quick").addEventListener("keydown",e=>{if(e.key==="Enter"){$("apply-quick").click();e.preventDefault();}});
$("clear-claim").addEventListener("click",()=>setClaim(null));
$("claim-types").addEventListener("click",e=>{
  const b=e.target.closest("[data-type]");if(!b)return;
  builder.type=b.dataset.type;
  if((builder.type==="sf"||builder.type==="straight")&&builder.a<5)builder.a=5;
  renderBuilder();
});
$("claim-ranks").addEventListener("click",e=>{
  const b=e.target.closest("[data-rank]");if(!b)return;
  builder.a=Number(b.dataset.rank);
  if(builder.type==="two"&&builder.b>=builder.a)builder.b=builder.a-1;
  if(builder.type==="full"&&builder.b===builder.a)builder.b=builder.a===14?13:14;
  renderBuilder();
});
$("claim-second").addEventListener("click",e=>{
  const b=e.target.closest("[data-second]");if(!b)return;builder.b=Number(b.dataset.second);renderBuilder();
});
$("apply-taps").addEventListener("click",()=>{
  const c={...builder};
  if(!isValidClaim(c)){setNotice("Choose valid ranks for this hand type.");return;}
  setClaim(c);setNotice("");
});
$("card-zone").addEventListener("click",e=>{
  const b=e.target.closest("[data-zone]");if(!b)return;zone=b.dataset.zone;renderDeck();
});
$("deck").addEventListener("click",e=>{const b=e.target.closest("[data-card]");if(b)toggleCard(Number(b.dataset.card));});
document.querySelector(".card-summary").addEventListener("click",e=>{
  const b=e.target.closest("[data-remove-card]");
  if(b)toggleCard(Number(b.dataset.removeCard));
});
$("clear-hand").addEventListener("click",()=>{game().hand=[];store();renderDeck();calculate();});
$("clear-center").addEventListener("click",()=>{game().center=[];store();renderDeck();calculate();});
$("scoreboard").addEventListener("click",e=>{
  const ext=e.target.closest("[data-extension]");
  if(ext){const i=Number(ext.dataset.extension),r=round();
    if(r.extensions[i]>0){r.extensions[i]--;store();renderScores();}return;}
  const b=e.target.closest("[data-score-step]");if(!b)return;
  const [seat,delta]=b.dataset.scoreStep.split(":").map(Number);
  const g=game();g.scores[seat]+=delta;
  if(!g.recorded)round().scores[seat]=g.scores[seat];
  store();renderScores();renderDeck();calculate();
});
$("scoreboard").addEventListener("change",e=>{
  const inp=e.target.closest("[data-score-seat]");if(!inp)return;
  const seat=Number(inp.dataset.scoreSeat);
  const score=Number(inp.value);if(!Number.isInteger(score)){renderScores();return;}
  game().scores[seat]=score;if(!game().recorded)round().scores[seat]=score;
  store();renderScores();renderDeck();calculate();
});
$("claim-options").addEventListener("click",e=>{
  const b=e.target.closest("[data-option]");if(!b||!lastEvaluation)return;
  const c=lastEvaluation.claims[Number(b.dataset.option)]?.claim;
  if(c)setClaim(c,state.mySeat);
});
$("use-suggestion").addEventListener("click",()=>{
  if(lastEvaluation?.top)setClaim(lastEvaluation.top.claim,state.mySeat);
});
$("record-outcome").addEventListener("click",()=>{
  const g=game(),r=round();
  if(g.recorded){setNotice("Already recorded. Undo first.");return;}
  if(!g.claim||!isValidClaim(g.claim)){setNotice("Set the final claimed hand first.");return;}
  const claimant=g.claimant,reactor=Number($("reactor").value);
  if(claimant===reactor){setNotice("The claimant and other team must be different.");return;}
  const outcome=$("outcome").value,delta=payout(g.claim,outcome);
  let exists=null;
  if(outcome==="bluff-false")exists=false;
  if(outcome==="bluff-true"||outcome==="nuts-true")exists=true;
  if(outcome==="nuts-false"&&$("nuts-exists").value)exists=$("nuts-exists").value==="true";
  const before=g.scores.slice(),after=before.slice();
  after[claimant]+=delta;after[reactor]-=delta;
  r.history=r.history.filter(h=>h.game!==state.game);
  r.history.push({game:state.game,claimant,reactor,outcome,exists,delta,scoreBefore:before.slice(),
    claim:{...g.claim}});
  g.recorded=true;r.scores=after;
  store();
  if(state.game<state.maxGames){changeGame(state.game+1);}
  else{renderAll();setNotice("Round complete. Select the next round.");}
});
$("undo-result").addEventListener("click",()=>{
  const r=round();if(!r.history.length){setNotice("No recorded result in this round.");return;}
  const h=r.history.pop();r.scores=h.scoreBefore.slice();
  const prior=r.games[h.game];
  if(prior){prior.recorded=false;prior.scores=h.scoreBefore.slice();}
  for(const [k,g] of Object.entries(r.games)){
    if(Number(k)>h.game&&!g.recorded)g.scores=r.scores.slice();
  }
  state.game=h.game;renderAll();setNotice("Last result removed; scoreboard restored.");
});
function paintTimer(){
  const sec=Math.max(0,timerInterval?Math.ceil((timerUntil-Date.now())/1000):timerRemaining);
  $("timer").textContent="00:"+String(sec).padStart(2,"0");
  if(timerInterval&&sec===0){clearInterval(timerInterval);timerInterval=null;timerRemaining=0;}
}
function startTimer(seconds){
  if(timerInterval)clearInterval(timerInterval);
  timerUntil=Date.now()+seconds*1000;timerRemaining=seconds;
  timerInterval=setInterval(paintTimer,100);paintTimer();
}
document.querySelectorAll("[data-timer]").forEach(b=>b.addEventListener("click",()=>startTimer(Number(b.dataset.timer))));
$("timer-stop").addEventListener("click",()=>{
  if(timerInterval){timerRemaining=Math.max(0,Math.ceil((timerUntil-Date.now())/1000));clearInterval(timerInterval);timerInterval=null;}
  paintTimer();
});
window.addEventListener("keydown",e=>{
  if(e.altKey&&e.key==="Enter"){$("apply-quick").click();e.preventDefault();}
  if(e.altKey&&e.key.toLowerCase()==="r"){startTimer(10);e.preventDefault();}
});
renderAll();paintTimer();
