import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCards,parseCard,cardCode,deckSupply,scoreHand,scoreAssets,evaluateTrade,marginalValues,jokerMarginal,auctionAdvice,negotiatingEvidence,offerOpportunities} from '../engine.js';
const cards=s=>parseCards(s);
const hand=(list,treasure='H',jokers=0)=>scoreHand(cards(list),treasure,jokers);
const state=(list,cash=500,jokers=0,treasure='H')=>({cards:cards(list),cash,jokers,treasure,contracts:[]});
test('parser accepts standard notation and rejects invalid cards',()=>{
 assert.deepEqual(cards('AS 10♥ 2xKC 3D').map(cardCode),['AS','10H','KC','KC','3D']);
 assert.deepEqual(parseCard('S10'),{rank:10,suit:'S'});
 assert.throws(()=>cards('1Z'));
});
test('deck counts follow all 360 cards in packet',()=>{
 let total=0;
 for(const suit of ['C','D','H','S'])for(let rank=2;rank<=14;rank++)total+=deckSupply('H',{suit,rank});
 assert.equal(total,360);
 assert.equal(deckSupply('H',{suit:'D',rank:10}),4);
 assert.equal(deckSupply('H',{suit:'C',rank:2}),6);
 assert.equal(deckSupply('H',{suit:'S',rank:4}),7);
});
test('base scoring and treasure neutral trash rules',()=>{
 assert.equal(hand('AH').total,100);
 assert.equal(hand('AS').total,50);
 assert.equal(hand('AD').total,100); // lone trash card qualifies for all-trash bonus
 assert.equal(hand('AD KD').total,160); // all-trash, 2*(50+30)
 assert.equal(hand('AD KD 2C').total,10); // adding neutral destroys all-trash bonus
});
test('rank pairing and 3+ bonus applies to every card',()=>{
 assert.equal(hand('AH AS').total,(100+25)+(50+25));
 assert.equal(hand('AH AS AD').total,(100+50)+(50+50)+(0+50)); // three Aces: 100+50+0 + 50 each
 assert.equal(hand('2H 2C 2S 2D').total,20+10+10+0+40);
});
test('joker becomes best possible single card, only once, and can preserve all-trash',()=>{
 assert.equal(hand('', 'H',1).total,100);
 assert.equal(hand('AD KD','H',1).jokerCard.suit,'D'); // off-suit destroys all-trash
 assert.equal(hand('AH','H',2).total,hand('AH','H',1).total);
 assert.equal(hand('AH','H',1).total,250); // 2 treasure aces each 100+25 pair bonus
});
test('valuation reflects removal and non-linear swaps and prohibits overspending',()=>{
 const s=state('AH AS');
 const swap=evaluateTrade(s,{receive:cards('AD'),give:cards('AS'),cashChange:25});
 assert.equal(swap.after.cash,525);
 assert.equal(swap.delta,scoreAssets(swap.after,true).total-scoreAssets(s,true).total);
 assert.throws(()=>evaluateTrade(s,{give:cards('KC')}),/do not own/);
 assert.throws(()=>evaluateTrade(s,{receive:cards('KC'),cashChange:-501}),/cash/);
 assert.throws(()=>evaluateTrade(s,{jokersChange:-1}),/Jokers/);
 assert.throws(()=>evaluateTrade(state('4xAH'),{receive:cards('7xAH')}),/exceeds/);
});
test('contract scoring confirmed vs probability-based preview',()=>{
 const s=state('AH');s.contracts=[{id:'x',payout:80,probability:25,status:'unknown'},
  {id:'y',payout:40,probability:0,status:'fulfilled'},
  {id:'z',payout:90,probability:100,status:'failed'}];
 assert.equal(scoreAssets(s).total,640);
 assert.equal(scoreAssets(s,true).total,660);
 const x=evaluateTrade(s,{giveContractIds:['x']});assert.equal(x.delta,-20);
});
test('marginal buy-sell differ with synergies',()=>{
 const s=state('AH AS');const rows=marginalValues(s);
 assert.equal(rows.find(x=>cardCode(x.card)==='AS').owned,1);
 assert.equal(rows.find(x=>cardCode(x.card)==='AD').buy,100); // triple Aces score 300, pair score 200
 assert.ok(rows.find(x=>cardCode(x.card)==='AH').sell>0);
});
test('auction ceiling never exceeds cash or value and joker duplicate is worthless',()=>{
 const s=state('AH',30,0);
 assert.equal(jokerMarginal(state('AH',500,1)),0);
 assert.equal(auctionAdvice({kind:'joker',state:s}).maxBid,30);
 assert.equal(auctionAdvice({kind:'joker',state:state('AH',500,1)}).maxBid,0);
 const c=auctionAdvice({kind:'contract',state:s,payout:100,probability:50,downside:1,cutoffs:[4,8,10]});
 assert.equal(c.maxBid,0); // 50 EV - 50 sigma = 0
 assert.equal(c.observedCutoff,8);
});
test('opponent summary is evidence-only',()=>{
 const r=negotiatingEvidence([{opponent:'A',direction:'buy',price:45,outcome:'accepted'},
 {opponent:'A',direction:'sell',price:70,outcome:'rejected'}],'a');
 assert.equal(r.highestObservedBid,45);assert.equal(r.lowestObservedAsk,70);
 assert.equal(r.accepted,1);assert.equal(r.rejected,1);
});

test('recorded rival prices become hand-dependent action opportunities',()=>{
 const s=state('AH AS',500);
 const offers=[{opponent:'Team 8',asset:'AD',direction:'sell',price:60,outcome:'offered'},
 {opponent:'Team 9',asset:'AS',direction:'buy',price:120,outcome:'offered'},
 {opponent:'Team 8',asset:'AD',direction:'sell',price:1,outcome:'accepted'}];
 const ranked=offerOpportunities(s,offers);
 assert.equal(ranked.length,2);
 assert.equal(ranked[0].action,'BUY');
 assert.equal(ranked[0].delta,40);
 assert.equal(ranked[1].action,'SELL');
 assert.equal(ranked[1].delta,20);
});
