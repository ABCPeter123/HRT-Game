import test from "node:test";
import assert from "node:assert/strict";
import {performance} from "node:perf_hooks";
import { SYMBOLS,INDICES,emptyBook,emptyRound,settlement,impliedIndices,tickValid,
 tickFloor,tickCeil,capacities,validateBook,indexExposure,inventoryStress,
 estimateTactics,recommend,applyFill,projectedPnl } from "../engine.js";
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,String(a)+" differs from "+String(b));
const allBooks=(bid=399,ask=401)=>Object.fromEntries(SYMBOLS.map(sym=>
  [sym,{...emptyBook(),bid:String(bid),ask:String(ask)}]));
const allFlow=()=>emptyRound().flow;
test("WQC settlement equations include doubled GRID event impact",()=>{
  const flow=allFlow();flow.GRID.confirmed=100;flow.CURE.confirmed=40;flow.SAFE.confirmed=-20;
  const r=settlement({flow,trust:0});
  close(r.index.TEK,201.2);close(r.index.NRG,200.9);close(r.index.MED,200.1);
  close(r.baskets.GRID,402.1);close(r.baskets.CURE,401.3);close(r.baskets.SAFE,401);
  close(r.confirmedBaskets.GRID,402.1);close(r.basketSigma.GRID,0);
});
test("no event volume means three $400 baskets",()=>{
  const r=settlement({flow:allFlow()});
  for(const sym of SYMBOLS)close(r.baskets[sym],400);
  for(const ix of INDICES)close(r.index[ix],200);
});
test("public tape does not change settlement",()=>{
  const f=allFlow();f.GRID.tape=10000;f.CURE.tape=-9999;
  const r=settlement({flow:f,trust:1});
  for(const sym of SYMBOLS)close(r.baskets[sym],400);
});
test("suspected volume is discounted by stated confidence",()=>{
  const f=allFlow();f.GRID.suspected=200;
  close(settlement({flow:f,trust:0}).baskets.GRID,400);
  close(settlement({flow:f,trust:0.5}).baskets.GRID,402);
  close(settlement({flow:f,trust:1}).baskets.GRID,404);
  close(settlement({flow:f,trust:0.5}).basketSigma.GRID,2);
  close(settlement({flow:f,trust:0}).basketSigma.GRID,0);
});
test("order tick restrictions apply to bids, not settlement",()=>{
  for(const p of [0,0.5,399.5,400,800])assert.ok(tickValid(p));
  for(const p of [-1,0.1,400.01,800.5])assert.ok(!tickValid(p));
  assert.equal(tickFloor(400.31),400);assert.equal(tickCeil(400.31),400.5);
  const b=allBooks(399.5,400.5).GRID;assert.ok(validateBook(b).valid);
  b.bid="399.3";assert.equal(validateBook(b).valid,false);
});
test("missing or inverted orderbooks cannot generate trades",()=>{
  const books=allBooks();books.CURE.bid="401";books.CURE.ask="400";
  books.SAFE.bid="";books.SAFE.ask="";
  const r=recommend({books,flow:allFlow()});
  assert.deepEqual(r.missing.sort(),["CURE","SAFE"]);
  assert.equal(r.perSymbol.CURE.best,null);
});
test("outstanding buy and sell orders reserve position headroom",()=>{
  const b={...emptyBook(),position:"920",openBuys:"60",openSells:"900"};
  assert.equal(capacities(b).buy,20);
  assert.equal(capacities(b).sell,1020);
  assert.equal(capacities({...b,position:"-980",openSells:"15"}).sell,5);
});
test("recommendations respect remaining shares and valid order prices",()=>{
  const books=allBooks(385,393),flow=allFlow();
  flow.GRID.confirmed=300;books.GRID.position="990";books.GRID.openBuys="7";
  const r=recommend({books,flow,risk:0,maxOrder:250});
  for(const a of r.candidates){
    assert.ok(a.qty>0&&a.qty<=250);
    assert.ok(a.qty<=capacities(books[a.symbol])[a.side.toLowerCase()]);
    assert.ok(tickValid(a.price));
  }
  for(const a of r.perSymbol.GRID.candidates.filter(x=>x.side==="BUY"))assert.ok(a.qty<=3);
});
test("marketable LIMIT orders cap shares to displayed quote size",()=>{
  const books=allBooks(385,390),flow=allFlow();
  flow.GRID.confirmed=500;books.GRID.askSize="8";
  const r=recommend({books,flow,risk:0,maxOrder:150});
  const take=r.perSymbol.GRID.candidates.find(x=>x.kind==="TAKE"&&x.side==="BUY");
  assert.ok(take);assert.equal(take.price,390);assert.ok(take.qty<=8);
});
test("without book size assume only small immediately executable depth",()=>{
  const books=allBooks(385,390),flow=allFlow();flow.GRID.confirmed=500;
  const r=recommend({books,flow,risk:0,maxOrder:150});
  const take=r.perSymbol.GRID.candidates.find(x=>x.kind==="TAKE"&&x.side==="BUY");
  assert.ok(take);assert.ok(take.qty<=20);
});
test("passive limit orders do not cross the spread",()=>{
  const books=allBooks(394,406),r=recommend({books,flow:allFlow(),risk:0,maxOrder:50});
  for(const x of r.candidates.filter(x=>x.kind==="MAKE")){
    assert.ok(x.side==="BUY"?x.price<Number(books[x.symbol].ask):x.price>Number(books[x.symbol].bid));
    assert.ok(tickValid(x.price));
  }
});
test("fills record signed inventory and cash and enforce position limits",()=>{
  let b=emptyBook();b=applyFill(b,{side:"BUY",quantity:100,price:400.5});
  assert.equal(b.position,"100");assert.equal(b.cash,String(-40050));
  b=applyFill(b,{side:"SELL",quantity:50,price:403.5});
  assert.equal(b.position,"50");assert.equal(Number(b.cash),-19875);
  assert.throws(()=>applyFill(b,{side:"BUY",quantity:1000,price:400}));
  assert.throws(()=>applyFill(b,{side:"BUY",quantity:1,price:400.2}));
  assert.throws(()=>applyFill(b,{side:"SELL",quantity:0,price:400}));
});
test("marked-to-model PnL requires full fill history from flat position",()=>{
  const books=allBooks();
  books.GRID=applyFill(books.GRID,{side:"BUY",quantity:100,price:399});
  close(projectedPnl({books,fair:settlement({flow:allFlow()})}),100);
  assert.equal(projectedPnl({books,fair:settlement({flow:allFlow()}),ledgerComplete:false}),null);
});
test("basket midpoints invert to implied TEK NRG MED",()=>{
  const b=allBooks();
  b.GRID.bid="401";b.GRID.ask="403";
  b.CURE.bid="400";b.CURE.ask="402";
  b.SAFE.bid="399";b.SAFE.ask="401";
  const i=impliedIndices(b);
  close(i.TEK,201.5);close(i.NRG,200.5);close(i.MED,199.5);
});
test("market behavior counters respond to prints and prices",()=>{
  const books=allBooks(399.5,400.5),flow=allFlow();
  const first=estimateTactics({books,flow,observations:[]});
  close(Object.values(first.weights).reduce((a,b)=>a+b,0),1);
  flow.GRID.tape=100;flow.CURE.tape=50;
  const snapshots=[
    {sym:"GRID",mid:400,spread:1},{sym:"GRID",mid:402,spread:1},
    {sym:"CURE",mid:400,spread:1},{sym:"CURE",mid:402,spread:1}
  ];
  const chaser=estimateTactics({books,flow,observations:snapshots});
  assert.ok(chaser.weights.chaser>first.weights.chaser);
  flow.GRID.tape=-100;flow.CURE.tape=-50;
  const fader=estimateTactics({books,flow,observations:snapshots});
  assert.ok(fader.weights.fader>chaser.weights.fader);
});
test("cross-basket underlying risk and example event shock are consistent",()=>{
  const books=allBooks();
  books.GRID.position="100";books.CURE.position="80";books.SAFE.position="-50";
  assert.deepEqual(indexExposure(books),{TEK:180,NRG:50,MED:30});
  const shock=inventoryStress(books,200);
  assert.equal(shock.byEvent.GRID,460);
  assert.equal(shock.byEvent.CURE,210);
  assert.equal(shock.byEvent.SAFE,80);
  assert.equal(shock.worstCaseShockLoss,460);
});
test("100 recalculations complete within interactive latency",()=>{
  const books=allBooks(398.5,401.5),flow=allFlow();
  flow.GRID.confirmed=150;flow.SAFE.suspected=-200;flow.CURE.tape=100;
  const start=performance.now();
  for(let i=0;i<100;i++)recommend({books,flow,trust:0.35,risk:0.35,seconds:460,maxOrder:100});
  const duration=performance.now()-start;
  assert.ok(duration<500,"100 evaluations took "+duration+"ms");
});

test("new round contains empty market snapshots for first session",()=>{
  const r=emptyRound();
  assert.deepEqual(r.snapshots,[]);
  assert.equal(r.clock,600);
  assert.equal(Object.keys(r.books).length,3);
});
