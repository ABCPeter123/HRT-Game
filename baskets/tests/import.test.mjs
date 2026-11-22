import test from "node:test";
import assert from "node:assert/strict";
import {performance} from "node:perf_hooks";
import {parseMarketText,validateMarketValue,validateMarketUpdate,sanitizeMarketSnapshot,
  mergeMarketSnapshot} from "../import.js";
import {emptyRound} from "../engine.js";

test("fast paste supports complete three-basket table and preserves signed positions",()=>{
  const input="GRID 399.5 400.5 100 80 0\nCURE 398.5 400.0 55 70 -25\nSAFE 401.0 402.0 90 85 40";
  const r=parseMarketText(input);
  assert.equal(r.valid,true);
  assert.equal(r.found,3);
  assert.equal(r.updates.GRID.bid,"399.5");
  assert.equal(r.updates.CURE.position,"-25");
  assert.equal(r.updates.SAFE.askSize,"85");
});
test("two-column quotes remain fast, size and position optional",()=>{
  const r=parseMarketText("GRID 399.5 400.5\nCURE 398.5 400\nSAFE 401 402");
  assert.equal(r.valid,true);
  assert.equal(r.found,3);
  assert.deepEqual(r.updates.CURE,{bid:"398.5",ask:"400"});
});
test("labeled paste can include arbitrary order and all 7 values",()=>{
  const r=parseMarketText(
    "GRID best ask 401 best bid 399 position -10 bid size 85 ask size 92 open buys 5 open sells 3");
  assert.equal(r.valid,true);
  assert.deepEqual(r.updates.GRID,{
    bid:"399",ask:"401",bidSize:"85",askSize:"92",position:"-10",
    openBuys:"5",openSells:"3"
  });
});
test("copying a CSV grid with a normal header works",()=>{
  const r=parseMarketText("symbol,bid,ask,bidSize,askSize,position\nGRID,399.5,400.5,10,20,0");
  assert.equal(r.valid,true);
  assert.equal(r.updates.GRID.bid,"399.5");
});
test("malformed or crossed quotes are rejected rather than silently guessed",()=>{
  for(const text of ["GRID 399.7 400","GRID 402 401","GRID 399","GRID 399 400 10",
    "GRID 399 400 10 10 1001","GRID 399 400 10 10 bad"]){
    const r=parseMarketText(text);
    assert.equal(r.valid,false,text);
    assert.ok(r.errors.length>0);
  }
  assert.equal(validateMarketUpdate({bid:"399",ask:"399"}),null);
});
test("duplicate symbols are treated as a paste error",()=>{
  const r=parseMarketText("GRID 399 400\nGRID 401 402");
  assert.equal(r.valid,false);assert.match(r.errors.join(" "),/duplicate GRID/);
});
test("bridge sanitation ignores unrelated data and rejects unsupported formats",()=>{
  const result=sanitizeMarketSnapshot({
    host:"game.example",cookies:"must never travel",
    books:{GRID:{bid:399.5,ask:400.5,cookie:"secret"},CURE:{bid:400.12,ask:401},
      SAFE:{position:0,openBuys:12}}
  });
  assert.deepEqual(result,{books:{GRID:{bid:"399.5",ask:"400.5"},
    SAFE:{position:"0",openBuys:"12"}}});
  assert.equal(sanitizeMarketSnapshot({books:{GRID:{bid:"not a number"}}}),null);
  assert.equal(validateMarketValue("position",-1001),false);
  assert.equal(validateMarketValue("openSells",5.5),false);
});
test("snapshot import updates only fields mapped by the user and preserves ledger status",()=>{
  const books=emptyRound().books;
  books.GRID.bid="399";books.GRID.ask="402";books.GRID.position="17";
  const r=mergeMarketSnapshot(books,{books:{GRID:{bid:400,ask:401}}});
  assert.equal(r.changed,1);
  assert.equal(r.books.GRID.bid,"400");
  assert.equal(r.books.GRID.askSize,"");
  assert.equal(r.books.GRID.position,"17");
  assert.equal(r.books.GRID.ledgerComplete,true);
  const move=mergeMarketSnapshot(r.books,{books:{GRID:{position:20}}});
  assert.equal(move.books.GRID.position,"20");
  assert.equal(move.books.GRID.ledgerComplete,false);
  assert.equal(books.GRID.position,"17");
});
test("empty and invalid bridge snapshots cannot wipe last known good data",()=>{
  const books=emptyRound().books;
  books.GRID.bid="399.5";
  for(const input of [null,{}, {books:{}}, {books:{GRID:{ask:"NaN"}}}]){
    const result=mergeMarketSnapshot(books,input);
    assert.equal(result.changed,0);
    assert.strictEqual(result.books,books);
  }
});
test("parser remains interactive under repeated clipboard updates",()=>{
  const start=performance.now();
  const text="GRID 399.5 400.5\nCURE 399 401\nSAFE 400 402";
  for(let i=0;i<1000;i++)parseMarketText(text);
  assert.ok(performance.now()-start<1000);
});
