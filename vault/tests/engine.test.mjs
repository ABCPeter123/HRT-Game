import test from "node:test";
import assert from "node:assert/strict";
import {SYMBOLS,roleForRound,newChips,validateChip,errorLikelihood,numericLikelihood,
 roundedMean,revealSchedule,chipPosterior,validPrice,bookStatus,capacity,makerPenalty,
 defaultBook,defaultRound,suggest,recommend,applyFill,markedPnl} from "../engine.js";
import {sanitizeMarketSnapshot,mergeMarketSnapshot} from "../import.js";
const close=(x,y,eps=1e-7)=>assert.ok(Math.abs(x-y)<eps, String(x)+" != "+String(y));

test("role cohorts alternate across four rounds",()=>{
 assert.deepEqual([1,2,3,4].map(n=>roleForRound("maker14",n)),["maker","taker","taker","maker"]);
 assert.deepEqual([1,2,3,4].map(n=>roleForRound("maker23",n)),["taker","maker","maker","taker"]);
});
test("uniform chip priors imply 165 VAULT, 110 PUB and 15 G5",()=>{
 const m=chipPosterior(newChips());
 close(m.fair.VAULT,165);close(m.fair.PUB,110);close(m.fair.G5,15);
 close(m.uncertainty.VAULT,Math.sqrt(30*8.25));
 close(m.makerWidths.VAULT,Math.sqrt(30*8.25));
 close(m.makerWidths.PUB,Math.sqrt(20*8.25));
});
test("exact public and private reveals change only applicable maker-width inputs",()=>{
 const cs=newChips();cs[0].trueValue=10;cs[20].trueValue=1;
 const m=chipPosterior(cs);
 close(m.fair.VAULT,165);close(m.fair.PUB,114.5);close(m.fair.G5,15);
 close(m.makerWidths.PUB,Math.sqrt(19*8.25));
 close(m.makerWidths.VAULT,Math.sqrt(29*8.25));
 close(m.details[0].variance,0);
});
test("truncated error likelihood, false type and numeric posterior",()=>{
 close(errorLikelihood(1,1),1/3);close(errorLikelihood(5,7),1/5);
 assert.equal(errorLikelihood(1,4),0);
 assert.equal(numericLikelihood(7,7,"false"),0);
 assert.equal(numericLikelihood(7,7,"true"),1);
 const cs=newChips();cs[0].partial=8;
 assert.ok(chipPosterior(cs).details[0].expected>5.5);
});
test("known combination clue constrains targets and not its own true value",()=>{
 const cs=newChips();cs[0].combo={a:2,b:3,value:10};
 const m=chipPosterior(cs);
 assert.ok(m.details[1].expected>8.5);
 assert.ok(m.details[2].expected>8.5);
 close(m.details[0].expected,5.5);
 assert.equal(roundedMean(9,10),10);
 cs[0].combo={a:1,b:3,value:8};
 assert.equal(validateChip(cs[0]),false);
});
test("known exact values are preserved under compatible combination factors",()=>{
 const cs=newChips();cs[0].combo={a:2,b:3,value:7};
 cs[1].trueValue=6;cs[2].trueValue=8;
 const m=chipPosterior(cs);
 close(m.details[1].expected,6);close(m.details[2].expected,8);
 assert.equal(m.impossible,false);
});
test("public and private reveals implement 30 second information lag",()=>{
 assert.deepEqual(revealSchedule(0,"taker").publicPartial,[1]);
 assert.deepEqual(revealSchedule(0,"maker").publicPartial,[]);
 assert.deepEqual(revealSchedule(30,"taker").publicTrue,[1]);
 assert.deepEqual(revealSchedule(30,"maker").publicPartial,[1]);
 assert.deepEqual(revealSchedule(60,"taker").privateTrue,[21]);
 const mk=revealSchedule(600,"maker"),tk=revealSchedule(600,"taker");
 assert.equal(mk.publicPartial.length,20);
 assert.equal(mk.publicTrue.length,19);
 assert.equal(tk.publicTrue.length,20);
 assert.equal(tk.privateTrue.length,10);
 assert.equal(revealSchedule(630,"maker").publicTrue.length,19);
});
test("legal ticks, bands and top-of-book validation",()=>{
 assert.equal(validPrice("VAULT",30),true);
 assert.equal(validPrice("VAULT",29.75),false);
 assert.equal(validPrice("VAULT",300.25),false);
 assert.equal(validPrice("G5",14.1),true);
 assert.equal(validPrice("G5",14.15),false);
 assert.equal(validPrice("PUB",20.25),true);
 assert.equal(bookStatus("VAULT",{bid:100,ask:99}).valid,false);
});
test("worst-case capacities subtract open order shares",()=>{
 const b={position:299,workingBuys:5,workingSells:30};
 assert.deepEqual(capacity("taker",b),{limit:300,buy:0,sell:569});
 assert.deepEqual(capacity("maker",b),{limit:500,buy:196,sell:769});
});
test("maker penalty respects size >=10, band fallback, first 10s and quote-hit grace",()=>{
 let b=defaultBook();
 let p=makerPenalty("VAULT",b,10,{elapsed:50});
 close(p.effectiveSpread,270);close(p.rate,2.6);
 close(makerPenalty("VAULT",b,10,{elapsed:8}).rate,0);
 b.ownBid="145";b.ownAsk="155";b.ownBidSize=10;b.ownAskSize=10;
 close(makerPenalty("VAULT",b,10,{elapsed:50}).rate,0);
 b.ownAsk="165";
 close(makerPenalty("VAULT",b,10,{elapsed:50}).rate,.1);
 close(makerPenalty("VAULT",b,10,{elapsed:54,lastQuoteFillAt:50}).rate,0);
 b.ownBidSize=9;
 assert.ok(makerPenalty("VAULT",b,10,{elapsed:60}).rate>0);
});
test("marketable orders require observed quotes and available liquidity",()=>{
 const m=chipPosterior(newChips());
 const book={...defaultBook(),bid:150,ask:151,bidSize:100,askSize:8};
 const maker=suggest("VAULT",m,book,{role:"maker",maxOrder:20});
 assert.ok(maker.quotes.qualifying);
 const taker=suggest("VAULT",m,book,{role:"taker",maxOrder:20});
 assert.equal(taker.action?.kind,"IOC");
 assert.equal(taker.action?.side,"BUY");
 assert.equal(taker.action?.qty,8);
 assert.equal(taker.quotes,null);
 assert.equal(suggest("VAULT",m,defaultBook(),{role:"taker"}).action,null);
});
test("inventory capacity enforces taker and maker limits",()=>{
 const m=chipPosterior(newChips());
 const b={...defaultBook(),bid:149,ask:150,bidSize:100,askSize:100,position:299};
 const d=suggest("VAULT",m,b,{role:"taker",maxOrder:100});
 assert.ok(!d.action||d.action.qty<=1);
 const q=suggest("VAULT",m,{...b,position:500},{role:"maker"});
 assert.equal(q.quotes.qualifying,false);
});
test("maker rebates apply to genuinely filled own quotes, and fills are tick checked",()=>{
 const b=defaultBook();
 const buy=applyFill(b,"maker",{symbol:"PUB",side:"BUY",quantity:20,price:105,quoted:true});
 assert.equal(buy.position,20);close(buy.cash,-2099);
 const sell=applyFill(buy,"maker",{symbol:"PUB",side:"SELL",quantity:10,price:108});
 assert.equal(sell.position,10);close(sell.cash,-1019);
 assert.throws(()=>applyFill(b,"taker",{symbol:"G5",side:"BUY",quantity:301,price:10}),/limit/);
 assert.throws(()=>applyFill(b,"maker",{symbol:"VAULT",side:"BUY",quantity:1,price:40.1}),/tick/);
});
test("marked model PNL accounts for maker penalty, incomplete external inventory",()=>{
 const m=chipPosterior(newChips()),b={VAULT:defaultBook(),G5:defaultBook(),PUB:defaultBook()};
 b.VAULT=applyFill(b.VAULT,"maker",{symbol:"VAULT",side:"BUY",quantity:10,price:150});
 const pnl=markedPnl(b,m,{makerPenaltyAccrued:5});
 close(pnl.pnl,145);assert.equal(pnl.complete,true);
 b.PUB.ledgerComplete=false;assert.equal(markedPnl(b,m).complete,false);
});
test("validated read-only snapshots strip secrets and invalid ticks",()=>{
 const safe=sanitizeMarketSnapshot({host:"trade.example.org",password:"SECRET",books:{
 VAULT:{bid:150,ask:150.25,bidSize:20,cookie:"SECRET"},
 G5:{bid:12.1,ask:12.3,position:20},
 PUB:{bid:22.1,ask:22.2},OTHER:{bid:1,ask:2}}});
 assert.deepEqual(safe.books,{VAULT:{bid:"150",ask:"150.25",bidSize:"20"},
  G5:{bid:"12.1",ask:"12.3",position:"20"}});
 assert.equal(JSON.stringify(safe).includes("SECRET"),false);
 const merged=mergeMarketSnapshot({VAULT:defaultBook(),G5:defaultBook(),PUB:defaultBook()},safe);
 assert.equal(merged.changed,2);assert.equal(merged.books.G5.ledgerComplete,false);
});
test("fresh round covers all chips and symbols",()=>{
 const round=defaultRound("taker");
 assert.equal(round.chips.length,30);
 assert.deepEqual(Object.keys(round.books),SYMBOLS);
});

test("maker action prioritizes restoring qualifying two-way quotes over a profitable taker order",()=>{
 const m=chipPosterior(newChips());
 const books={VAULT:{...defaultBook(),bid:140,ask:141,bidSize:100,askSize:100},
   G5:defaultBook(),PUB:defaultBook()};
 const choice=recommend(m,books,{role:"maker",maxOrder:30,elapsed:100});
 assert.equal(choice.best?.kind,"QUOTE");
 assert.ok(["VAULT","G5","PUB"].includes(choice.best?.symbol));
 const t=recommend(m,books,{role:"taker",maxOrder:30,elapsed:100});
 assert.equal(t.best?.kind,"IOC");
});
test("maker width rate retains sub-cent precision for the round timer",()=>{
 const b={...defaultBook(),ownBid:"140",ownAsk:"151",ownBidSize:20,ownAskSize:20};
 const rate=makerPenalty("VAULT",b,10.33,{elapsed:50}).rate;
 close(rate,.01*.67,1e-8);
});
test("each Vault round keeps distinct maker quote fill timestamp slots",()=>{
 const row=defaultRound("maker");
 assert.deepEqual(Object.keys(row.lastQuoteFillAt),SYMBOLS);
 row.lastQuoteFillAt.G5=90;
 assert.equal(row.lastQuoteFillAt.VAULT,-Infinity);
});
