import {
  SUITS,SUIT_SYMBOLS,RANKS,cardCode,cardName,parseCards,parseCard,deckSupply,assertCards,
  scoreAssets,scoreHand,contractExpected,evaluateTrade,tradeSuggestion,
  auctionAdvice,negotiatingEvidence,offerOpportunities,trashSuit
} from './engine.js';

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const money=n=>'$'+Number(n).toLocaleString('en-CA',{maximumFractionDigits:1});
const pts=n=>Number(n).toLocaleString('en-CA',{maximumFractionDigits:1});
const newRound=()=>({treasure:'H',cards:[],cash:500,jokers:0,contracts:[],offers:[],cutoffs:[],wins:[],undo:[],downside:35});
const KEY='quant-comp-treasures-v1';
let data;try{data=JSON.parse(localStorage.getItem(KEY));}catch{data=null;}
if(!data||!data.rounds||typeof data.rounds!=='object')data={activeRound:1,rounds:{1:newRound(),2:newRound(),3:newRound()}};
let round=Number(data.activeRound)||1,state=data.rounds[round]||newRound(),selectedSuit='H',cardMode='add',tab='hand';
const persist=()=>{data.activeRound=round;data.rounds[round]=state;localStorage.setItem(KEY,JSON.stringify(data));};
function notice(message,error=false){$('status').textContent=message;$('status').style.color=error?'#fb999c':'#75ddca';}
function pushUndo(label){
  const {undo,...snapshot}=state;
  state.undo.push({label, snapshot:JSON.parse(JSON.stringify(snapshot))});
  state.undo=state.undo.slice(-35);
}
function mutate(label,action){
  const old=JSON.stringify(state);
  try{pushUndo(label);action();persist();render();notice(`${label} recorded. Use Undo to reverse.`);}
  catch(e){state=JSON.parse(old);notice(e.message,true);render();}
}
function uniqueId(){return String(Date.now())+'-'+Math.floor(Math.random()*1e8);}
function readNumber(id,min=0,max=Infinity){
  const raw=$(id).value.trim(),n=Number(raw);
  if(raw===''||!Number.isFinite(n)||n<min||n>max)throw Error(`Invalid ${$(id).closest('label')?.textContent.trim()||id}.`);
  return n;
}
function contract(name,payout,probability,status='unknown'){
  if(!name.trim())throw Error('A contract needs a name or condition.');
  if(!Number.isInteger(payout)||payout<0||!Number.isInteger(probability)||probability<0||probability>100)throw Error('Contract payout and probability must be valid whole numbers.');
  return {id:uniqueId(),name:name.trim().slice(0,120),payout,probability,status};
}
function changeRound(next){
  if(next===round)return;
  persist();round=next;state=data.rounds[round]||newRound();selectedSuit=state.treasure;persist();render();notice(`Round ${round} selected. Its hand and history are separate.`);
}
function renderNavigation(){
  $('round-buttons').innerHTML=[1,2,3].map(n=>`<button type="button" data-round="${n}" class="${n===round?'active':''}">Round ${n}</button>`).join('');
  $('treasure-suit').value=state.treasure;
  $('suit-explain').textContent=`Treasure ${SUIT_SYMBOLS[state.treasure]} · Trash ${SUIT_SYMBOLS[trashSuit(state.treasure)]}`;
  document.querySelectorAll('.tab').forEach(b=>{b.classList.toggle('selected',b.dataset.tab===tab);b.setAttribute('aria-selected',String(b.dataset.tab===tab));});
  document.querySelectorAll('.workspace').forEach(x=>x.classList.toggle('active',x.id===`tab-${tab}`));
}
function showTab(next){tab=next;renderNavigation();}
function renderHero(summary){
  const exact=scoreAssets(state),expected=summary.summary;
  $('score-exact').textContent=pts(exact.total);
  $('score-expected').textContent=pts(expected.total);
  $('score-cash').textContent=money(state.cash);
  $('score-cards').textContent=`${state.cards.length} / ${state.jokers}`;
  const buy=summary.buys[0],sell=summary.sells[0];
  if(!state.cards.length){$('best-move').textContent='ENTER YOUR HAND';$('best-reason').textContent='Choose the treasure suit and tap the nine starting cards. No trade recommendation is reliable before you enter your hand.';return;}
  const opportunity=offerOpportunities(state,state.offers)[0];
  if(opportunity){
    $('best-move').textContent=`${opportunity.action} ${cardName(opportunity.card)} · +${pts(opportunity.delta)} PTS`;
    $('best-reason').textContent=`${opportunity.offer.opponent} previously offered to ${opportunity.offer.direction} ${cardCode(opportunity.card)} for ${money(opportunity.price)}. At that price, your current hand improves by ${pts(opportunity.delta)} points. Confirm the offer is still available before trading.`;
  }else if(buy&&buy.buy>0){
    $('best-move').textContent=`TARGET ${cardName(buy.card)} · VALUE +${pts(buy.buy)}`;
    $('best-reason').textContent=`Buying one ${cardCode(buy.card)} increases your current hand score by ${pts(buy.buy)} points. Pay less than ${money(buy.buy)} to make an immediate point gain. ${sell?'Lowest-value card to sell: '+cardName(sell.card)+' (break-even '+money(sell.sell)+').':''}`;
  }else{$('best-move').textContent='PRICE OFFERS BEFORE TRADING';$('best-reason').textContent='No available single card raises the current hand score. Evaluate full swaps and contract offers before agreeing.';}
}
function renderHand(summary){
  $('hand-count').textContent=`${state.cards.length} cards`;
  $('suit-picker').innerHTML=SUITS.map(s=>`<button type="button" class="suit-button ${s} ${s===selectedSuit?'active':''}" data-suit="${s}" title="${s} cards">${SUIT_SYMBOLS[s]} ${s}</button>`).join('');
  document.querySelectorAll('.mode-button').forEach(b=>b.classList.toggle('active',b.dataset.mode===cardMode));
  $('rank-grid').innerHTML=RANKS.map(r=>{
    const card={rank:r,suit:selectedSuit},count=state.cards.filter(x=>x.rank===r&&x.suit===selectedSuit).length;
    const label=r===14?'A':r===13?'K':r===12?'Q':r===11?'J':String(r);
    const supply=deckSupply(state.treasure,card);
    return `<button data-rank="${r}" title="${cardMode==='add'?'Add':'Remove'} ${label}${selectedSuit}. ${count} owned, ${supply} in play." ${cardMode==='add'&&count>=supply||cardMode==='remove'&&!count?'disabled':''}>${label}${count?`<small>×${count}</small>`:''}</button>`;
  }).join('');
  $('hand-list').innerHTML=state.cards.length?state.cards.map((c,i)=>`<button title="Remove ${cardCode(c)}" class="chip ${'HD'.includes(c.suit)?'red':'black'}" data-remove-index="${i}">${cardName(c)} ×</button>`).join(''):'<span class="quiet">No cards yet. Start with your nine dealt cards.</span>';
  $('cash').value=state.cash;$('jokers').value=state.jokers;
  $('undo').disabled=!state.undo.length;
  $('undo-label').textContent=state.undo.length?`Last saved action: ${state.undo.at(-1).label}`:'No action to undo.';
  $('buy-list').innerHTML=summary.buys.map(x=>`<div class="value-row"><span><b>${cardName(x.card)}</b> <span class="detail">${x.owned} owned / ${x.supply} total</span></span><strong>+${pts(x.buy)}</strong><button type="button" data-try-buy="${cardCode(x.card)}">Try buy</button></div>`).join('')||'<p>No eligible positive marginal buy.</p>';
  $('sell-list').innerHTML=summary.sells.map(x=>`<div class="value-row"><span><b>${cardName(x.card)}</b> <span class="detail">${x.owned} owned</span></span><strong>${money(x.sell)}</strong><button type="button" data-try-sell="${cardCode(x.card)}">Try sell</button></div>`).join('')||'<p>No cards to sell.</p>';
  const score=scoreHand(state.cards,state.treasure,state.jokers);
  $('score-explain').innerHTML=`<div class="statline"><span>Cards without Joker</span><strong>${pts(score.natural)} pts</strong></div>
    <div class="statline"><span>Added Joker scoring value</span><strong>+${pts(score.jokerGain)} pts</strong></div>
    <div class="statline"><span>Rank synergy within scored hand</span><strong>+${pts(score.synergy)} pts</strong></div>
    <div class="statline"><span>Confirmed contracts</span><strong>+${pts(scoreAssets(state).contracts)} pts</strong></div>
    <div class="statline"><span>Cash</span><strong>+${pts(state.cash)} pts</strong></div>
    <div class="statline"><span>All-trash bonus active</span><strong>${score.allTrash?'YES':'NO'}</strong></div>
    ${score.jokerCard?`<p>The scoring Joker becomes <b>${cardName(score.jokerCard)}</b>. Extra Jokers do not score.</p>`:''}`;
}
function clearTrade(){
  for(const id of ['trade-receive','trade-give','trade-contract-name'])$(id).value='';
  $('trade-cash').value=0;$('trade-jokers').value=0;$('trade-give-contract').value='';
  $('trade-contract-payout').value=0;$('trade-contract-prob').value=50;
  renderTrade();
}
function readTrade(){
  const name=$('trade-contract-name').value.trim();
  const giveContractIds=$('trade-give-contract').value?[$('trade-give-contract').value]:[];
  return {receive:parseCards($('trade-receive').value),give:parseCards($('trade-give').value),
    cashChange:readNumber('trade-cash',-1000000,1000000),jokersChange:readNumber('trade-jokers',-100,100),
    giveContractIds,receiveContracts:name?[contract(name,readNumber('trade-contract-payout',0,1000000),readNumber('trade-contract-prob',0,100))]:[]};
}
let latestTrade=null;
function renderTrade(){
  const selected=$('trade-give-contract').value;
  $('trade-give-contract').innerHTML='<option value="">None</option>'+state.contracts.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} · ${pts(c.payout)} pts</option>`).join('');
  if(state.contracts.some(c=>c.id===selected))$('trade-give-contract').value=selected;
  let draft;
  try{
    draft=readTrade();
    const isEmpty=!draft.receive.length&&!draft.give.length&&!draft.cashChange&&!draft.jokersChange&&!draft.receiveContracts.length&&!draft.giveContractIds.length;
    if(isEmpty){latestTrade=null;$('trade-result').className='decision';$('trade-result').innerHTML='<strong>Enter a proposed exchange</strong><p>Positive change increases your current projected score.</p>';$('confirm-trade').disabled=true;}
    else{
      const res=evaluateTrade(state,draft);latestTrade=draft;
      const ok=res.delta>0,action=ok?'FAVORABLE':res.delta<0?'UNFAVORABLE':'BREAK EVEN';
      $('trade-result').className=`decision ${res.delta<0?'error':''}`;
      $('trade-result').innerHTML=`<div class="eyebrow">CURRENT-HAND POINT DELTA</div><strong>${action}: ${res.delta>=0?'+':''}${pts(res.delta)} pts</strong>
      <div class="metric">Before ${pts(res.beforeValue)} → after ${pts(res.afterValue)}. Card/Joker impact: ${res.cardAndJokerDelta>=0?'+':''}${pts(res.cardAndJokerDelta)}. Contract estimate: ${res.contractDelta>=0?'+':''}${pts(res.contractDelta)}. Cash change: ${draft.cashChange>=0?'+':''}${pts(draft.cashChange)}.</div>
      <p>Use this as a negotiation threshold, not a forecast of future trades or final placement.</p>`;
      $('confirm-trade').disabled=false;
    }
  }catch(e){latestTrade=null;$('trade-result').className='decision error';$('trade-result').innerHTML=`<strong>Check the proposal</strong><p>${esc(e.message)}</p>`;$('confirm-trade').disabled=true;}
  const suggest=tradeSuggestion(state);
  const best=suggest.buys[0],cheap=suggest.sells[0];
  $('trade-tips').innerHTML=`<p>${best?`Your highest one-card marginal gain is <b>${cardName(best.card)}</b>: ${pts(best.buy)} points. Try offering below ${money(best.buy)}.`:'Add your hand to get buy targets.'}</p>
  <p>${cheap?`Your least costly owned card to part with is <b>${cardName(cheap.card)}</b>. Current hand loses ${pts(cheap.sell)} points if sold.`:'No sale values yet.'}</p>
  <p>Bundled swaps can outperform the sum of individual card prices. Always evaluate the full swap here, especially when a rank pair or the all-trash condition changes.</p>`;
  $('contract-list').innerHTML=state.contracts.length?state.contracts.map(c=>`<div class="value-row"><span><b>${esc(c.name)}</b> <span class="detail">${pts(c.payout)} pts · estimate ${pts(c.probability)}%</span></span>
    <select data-contract-status="${esc(c.id)}" aria-label="Status of ${esc(c.name)}" style="width:125px"><option value="unknown" ${c.status==='unknown'?'selected':''}>Unknown</option><option value="fulfilled" ${c.status==='fulfilled'?'selected':''}>Fulfilled</option><option value="failed" ${c.status==='failed'?'selected':''}>Failed</option></select>
    <button data-delete-contract="${esc(c.id)}" title="Remove contract">×</button></div>`).join(''):'<p>No bounty contracts in your holdings.</p>';
}
function renderAuction(){
  const kind=$('auction-kind').value,conditional=kind==='contract';
  $('auction-contract-fields').hidden=!conditional;
  $('downside').value=state.downside;$('downside-value').textContent=`${state.downside}%`;
  let advice;
  try{advice=auctionAdvice({kind,state,payout:readNumber('auction-payout',0,1000000),probability:readNumber('auction-prob',0,100),downside:state.downside/100,
    cutoffs:state.cutoffs.filter(c=>c.kind===kind).map(c=>c.cutoff)});
    $('auction-result').className='decision';
    $('auction-result').innerHTML=`<div class="eyebrow">${conditional?'CONTRACT':'JOKER'} AUCTION · CASH AFFORDABILITY ${money(advice.affordable)}</div>
    <strong>ENTRY ${money(advice.entryBid)} · CEILING ${money(advice.maxBid)}</strong>
    <div class="metric">Modeled incremental value ${pts(advice.gain)} pts${conditional?` · downside adjustment ${pts(advice.penalty)} pts`:''}.</div>
    <p>${esc(advice.note)}</p>`;
  }catch(e){$('auction-result').className='decision error';$('auction-result').innerHTML=`<strong>Correct auction inputs</strong><p>${esc(e.message)}</p>`;}
  $('cutoff-list').innerHTML=[...state.cutoffs].reverse().map(x=>`<div class="value-row"><span>Auction ${x.number} · ${x.kind==='joker'?'Joker':'Contract'} third winner</span><strong>${money(x.cutoff)}</strong></div>`).join('')||'<p>No winning thresholds entered yet. The first bid is exploratory.</p>';
  $('joker-explain').innerHTML=`<p>One Joker currently adds <strong class="good">${pts(tradeSuggestion(state).joker)} points</strong> to this hand${state.jokers?'; you already own at least one, so an additional Joker has no direct scoring value.':'.'} A Joker affects rank bonuses and the all-trash rule.</p>`;
}
function renderOpponents(){
  const selected=$('opponent-focus').value;
  const names=[...new Set(state.offers.map(o=>o.opponent))].sort();
  $('opponent-focus').innerHTML='<option value="">Choose a recorded team</option>'+names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
  if(names.includes(selected))$('opponent-focus').value=selected;
  const focus=$('opponent-focus').value;
  if(!focus){$('opponent-summary').innerHTML='<strong>No focused team</strong><p>Select a rival after recording an observation.</p>';}
  else{
    const stats=negotiatingEvidence(state.offers,focus);
    $('opponent-summary').innerHTML=`<div class="eyebrow">OBSERVED NEGOTIATION · ${esc(focus)}</div>
      <strong>${stats.offers} recorded offers</strong><div class="metric">${stats.accepted} accepted · ${stats.rejected} rejected<br>
      Highest seen buy bid: ${stats.highestObservedBid===null?'unknown':money(stats.highestObservedBid)}<br>
      Lowest seen sell ask: ${stats.lowestObservedAsk===null?'unknown':money(stats.lowestObservedAsk)}</div>
      <p>${stats.highestObservedBid!==null?'A rival bid may signal interest in that asset. Compare it against your sell break-even before countering.':'No buy bids recorded.'} ${stats.lowestObservedAsk!==null?'A rival ask is a candidate purchase price, not proof of their minimum acceptable price.':''}</p>`;
  }
  const opportunities=offerOpportunities(state,state.offers);
  $('opponent-summary').insertAdjacentHTML('beforeend',opportunities.length?`<p><b>${opportunities.length} positive current-hand opportunities from recorded open offers.</b> Best: ${esc(opportunities[0].offer.opponent)} ${opportunities[0].action} ${cardName(opportunities[0].card)} at ${money(opportunities[0].price)}, modeled benefit +${pts(opportunities[0].delta)}. Reconfirm availability.</p>`:'<p>No currently recorded open offer beats your current hand value.</p>');
  $('opponent-list').innerHTML=[...state.offers].reverse().slice(0,16).map(o=>`<div class="value-row"><span><b>${esc(o.opponent)}</b> ${esc(o.direction.toUpperCase())} ${esc(o.asset)}<span class="detail"> · ${esc(o.outcome)} </span></span><strong>${money(o.price)}</strong></div>`).join('')||'<p>Record offers to compare rival buying and selling patterns during the round.</p>';
}
function render(){
  renderNavigation();
  let summary;
  try{assertCards(state.cards,state.treasure);summary=tradeSuggestion(state);}
  catch(e){notice(`Saved hand data needs correction: ${e.message}`,true);return;}
  renderHero(summary);renderHand(summary);renderTrade();renderAuction();renderOpponents();
}
function tryCard(code,side){
  showTab('trade');clearTrade();
  const card=parseCard(code);
  const row=tradeSuggestion(state)[side==='buy'?'buys':'sells'].find(x=>cardCode(x.card)===code);
  if(side==='buy'){$('trade-receive').value=code;$('trade-cash').value=-Math.min(state.cash,Math.max(0,Math.floor(row?.buy*.7||0)));}
  else{$('trade-give').value=code;$('trade-cash').value=Math.max(0,Math.ceil(row?.sell||0));}
  renderTrade();$('trade-cash').focus();notice(`Prepared ${side} proposal. Edit the offered price before recording any trade.`);
}
// Navigation and fast card entry.
$('round-buttons').addEventListener('click',e=>{const b=e.target.closest('[data-round]');if(b)changeRound(Number(b.dataset.round));});
$('tabs').addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(b)showTab(b.dataset.tab);});
$('treasure-suit').addEventListener('change',e=>mutate('Change treasure suit',()=>{const next=e.target.value;assertCards(state.cards,next);state.treasure=next;selectedSuit=next;}));
$('suit-picker').addEventListener('click',e=>{const b=e.target.closest('[data-suit]');if(b){selectedSuit=b.dataset.suit;renderHand(tradeSuggestion(state));}});
document.querySelectorAll('.mode-button').forEach(b=>b.addEventListener('click',()=>{cardMode=b.dataset.mode;renderHand(tradeSuggestion(state));}));
$('rank-grid').addEventListener('click',e=>{
  const b=e.target.closest('[data-rank]');if(!b)return;
  const card={suit:selectedSuit,rank:Number(b.dataset.rank)};
  mutate(`${cardMode==='add'?'Add':'Remove'} ${cardCode(card)}`,()=>{
    if(cardMode==='add'){state.cards.push(card);assertCards(state.cards,state.treasure);}
    else{const at=state.cards.findIndex(c=>cardCode(c)===cardCode(card));if(at<0)throw Error('Card not held');state.cards.splice(at,1);}
  });
});
$('hand-list').addEventListener('click',e=>{const b=e.target.closest('[data-remove-index]');if(!b)return;
  const i=Number(b.dataset.removeIndex);mutate(`Remove ${cardCode(state.cards[i])}`,()=>state.cards.splice(i,1));});
function applyPaste(replace){try{const list=parseCards($('paste-cards').value);if(!list.length)throw Error('Enter cards first.');
  mutate(replace?'Replace hand':'Append cards',()=>{state.cards=replace?list:[...state.cards,...list];assertCards(state.cards,state.treasure);});
  $('paste-cards').value='';
}catch(e){notice(e.message,true);}}
$('replace-hand').addEventListener('click',()=>applyPaste(true));$('append-hand').addEventListener('click',()=>applyPaste(false));
for(const id of ['cash','jokers'])$(id).addEventListener('change',()=>{
  try{const value=readNumber(id,0,1e6);if(!Number.isInteger(value))throw Error('Use a whole number.');
    if(value===state[id])return;mutate(`Set ${id}`,()=>{state[id]=value;});}
  catch(e){notice(e.message,true);$(id).value=state[id];}
});
$('undo').addEventListener('click',()=>{
  const prev=state.undo.pop();if(!prev)return;
  const stack=state.undo;state={...prev.snapshot,undo:stack};persist();render();notice(`Undid ${prev.label}.`);
});
$('buy-list').addEventListener('click',e=>{const b=e.target.closest('[data-try-buy]');if(b)tryCard(b.dataset.tryBuy,'buy');});
$('sell-list').addEventListener('click',e=>{const b=e.target.closest('[data-try-sell]');if(b)tryCard(b.dataset.trySell,'sell');});
// Trade evaluation and contract inventory.
['trade-receive','trade-give','trade-cash','trade-jokers','trade-give-contract','trade-contract-name','trade-contract-payout','trade-contract-prob']
  .forEach(id=>$(id).addEventListener('input',renderTrade));
$('clear-trade').addEventListener('click',clearTrade);
$('confirm-trade').addEventListener('click',()=>{
  if(!latestTrade)return;
  try{const proposal=readTrade();const result=evaluateTrade(state,proposal);
    mutate('Execute confirmed trade',()=>{state.cards=result.after.cards;state.cash=result.after.cash;state.jokers=result.after.jokers;state.contracts=result.after.contracts;});
    clearTrade();
  }catch(e){notice(e.message,true);}
});
$('add-contract').addEventListener('click',()=>{
  try{const c=contract($('contract-name').value,readNumber('contract-payout',0,1e6),readNumber('contract-prob',0,100));
    mutate(`Add contract ${c.name}`,()=>state.contracts.push(c));$('contract-name').value='';
  }catch(e){notice(e.message,true);}
});
$('contract-list').addEventListener('change',e=>{const s=e.target.closest('[data-contract-status]');if(!s)return;
  mutate('Update contract result',()=>{state.contracts.find(c=>c.id===s.dataset.contractStatus).status=s.value;});
});
$('contract-list').addEventListener('click',e=>{const b=e.target.closest('[data-delete-contract]');if(!b)return;
  mutate('Remove contract',()=>{state.contracts=state.contracts.filter(c=>c.id!==b.dataset.deleteContract);});
});
// Auction observations are stored separately for each of the three rounds.
for(const id of ['auction-number','auction-kind','auction-payout','auction-prob'])$(id).addEventListener('input',renderAuction);
$('downside').addEventListener('input',e=>{state.downside=Number(e.target.value);persist();renderAuction();});
$('record-cutoff').addEventListener('click',()=>{
  try{const cutoff=readNumber('auction-cutoff',0,1e6);if(!Number.isInteger(cutoff))throw Error('Use a whole dollar bid.');
    const kind=$('auction-kind').value,number=Number($('auction-number').value);
    mutate('Save third-place winning bid',()=>state.cutoffs.push({kind,number,cutoff}));$('auction-cutoff').value='';
  }catch(e){notice(e.message,true);}
});
$('record-win').addEventListener('click',()=>{
  try{const paid=readNumber('auction-paid',0,1e6);if(!Number.isInteger(paid))throw Error('Use whole dollars.');
    if(paid>state.cash)throw Error('Bid exceeds cash on hand. Check auction payment before recording.');
    const kind=$('auction-kind').value,number=Number($('auction-number').value);
    const received=kind==='contract'?contract($('auction-contract-name').value,readNumber('auction-payout',0,1e6),readNumber('auction-prob',0,100)):null;
    mutate(`Won ${kind} auction ${number} for ${money(paid)}`,()=>{
      state.cash-=paid;
      if(kind==='joker')state.jokers+=1;
      else state.contracts.push(received);
      state.wins.push({kind,number,paid});
    });$('auction-paid').value='';
  }catch(e){notice(e.message,true);}
});
// Real opponent observations, kept separate from card holdings.
$('record-offer').addEventListener('click',()=>{
  try{
    const opponent=$('opponent-name').value.trim(),asset=$('opponent-asset').value.trim();
    const price=readNumber('opponent-price',0,1e6);
    if(!opponent||!asset||!Number.isInteger(price))throw Error('Enter a team name, asset, and whole dollar price.');
    const direction=$('opponent-direction').value,outcome=$('opponent-outcome').value;
    mutate(`Record ${opponent} offer`,()=>state.offers.push({opponent:opponent.slice(0,70),asset:asset.slice(0,80),price,direction,outcome}));
    $('opponent-focus').value=opponent;$('opponent-asset').value='';renderOpponents();
  }catch(e){notice(e.message,true);}
});
$('opponent-focus').addEventListener('change',renderOpponents);
document.addEventListener('keydown',e=>{
  if(e.altKey&&!e.ctrlKey&&!e.metaKey&&['1','2','3','4'].includes(e.key)){
    e.preventDefault();showTab(['hand','trade','auction','opponents'][Number(e.key)-1]);
  }
});
selectedSuit=state.treasure;
render();notice('Panel ready. Updates are saved in this browser for each round.');
