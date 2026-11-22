import test from "node:test";
import assert from "node:assert/strict";
import {emptyBook,emptyRound} from "../engine.js";
import {emptyDesk,createCall,teammateCallText,parseTeammateStatus,
 updateCall,observeRepricing,addPriceAlert,classifyPriceAlert,pendingAlerts} from "../desk-engine.js";
const action={symbol:"GRID",side:"BUY",qty:20,price:399.5,kind:"MAKE"};
const make=()=>createCall(emptyDesk(),action,1,1000).call;
test("teammate call has stable reference, executable details and explicit response syntax",()=>{
 const result=createCall(emptyDesk(),action,1,1000);
 assert.equal(result.call.id,"R1-001");
 assert.equal(result.call.status,"CALLED");
 assert.equal(result.call.filledQty,0);
 assert.match(teammateCallText(result.call),/BUY 20 GRID LIMIT @ 399.50/);
 const next=createCall(result.desk,action,1,1100);
 assert.equal(next.call.id,"R1-002");
 assert.equal(next.desk.calls.length,2);
});
test("status parser supports cumulative fills and rejects ambiguous messages",()=>{
 assert.deepEqual(parseTeammateStatus("R1-001 FILLED 20 @ 399.50"),{
  id:"R1-001",status:"FILLED",qty:20,price:399.5});
 assert.equal(parseTeammateStatus("r2-002 placed").status,"WORKING");
 assert.equal(parseTeammateStatus("R1-001 CANCELED").status,"CANCELLED");
 for(const x of ["FILLED 20","R1-001 PARTIAL 5","R1-001 FILL 5 @ 400",
  "R1-001 FILLED 3 @ 400 EXTRA","R1-001 WORKING 3 @ 400"])
  assert.throws(()=>parseTeammateStatus(x));
});
test("working status reserves shares and does not fabricate a fill",()=>{
 const call=make(),book=emptyBook();
 const r=updateCall(book,call,{status:"WORKING"},{at:1200});
 assert.equal(r.book.position,"0");
 assert.equal(r.book.openBuys,"20");
 assert.equal(r.call.reserved,20);
 assert.equal(r.fillDelta,0);
 assert.equal(book.openBuys,"0");
});
test("partial cumulative report reconciles open shares, cash and positions",()=>{
 let call=make(),book=emptyBook();
 ({call,book}=updateCall(book,call,{status:"WORKING"}));
 const a=updateCall(book,call,{status:"PARTIAL",qty:8,price:399.5});
 assert.equal(a.fillDelta,8);
 assert.equal(a.book.position,"8");
 assert.equal(a.book.cash,String(-8*399.5));
 assert.equal(a.book.openBuys,"12");
 assert.equal(a.call.filledQty,8);
 const twice=updateCall(a.book,a.call,{status:"PARTIAL",qty:8,price:399.5});
 assert.equal(twice.fillDelta,0);
 assert.equal(twice.book.position,"8");
 assert.equal(twice.book.cash,String(-8*399.5));
});
test("cumulative VWAP updates apply only new notional",()=>{
 let call=make(),book=emptyBook();
 ({call,book}=updateCall(book,call,{status:"WORKING"}));
 ({call,book}=updateCall(book,call,{status:"PARTIAL",qty:8,price:399.5}));
 const done=updateCall(book,call,{status:"FILLED",qty:20,price:400.1});
 assert.equal(done.fillDelta,12);
 assert.equal(done.book.position,"20");
 assert.equal(done.book.cash,"-8002");
 assert.equal(done.book.openBuys,"0");
 assert.equal(done.call.avgFill,400.1);
 assert.equal(done.call.status,"FILLED");
});
test("cancelling a partially filled order releases only outstanding portion",()=>{
 let call=make(),book=emptyBook();
 ({call,book}=updateCall(book,call,{status:"WORKING"}));
 ({call,book}=updateCall(book,call,{status:"PARTIAL",qty:6,price:399.5}));
 const stopped=updateCall(book,call,{status:"CANCELLED"});
 assert.equal(stopped.book.position,"6");
 assert.equal(stopped.book.openBuys,"0");
 assert.equal(stopped.call.filledQty,6);
 assert.throws(()=>updateCall(stopped.book,stopped.call,{status:"WORKING"}),/closed/);
});
test("prevent double-accounting when live inventory and open orders are mapped",()=>{
 let call=make(),book=emptyBook();
 book.position="15";book.openBuys="30";book.ledgerComplete=false;
 const working=updateCall(book,call,{status:"WORKING"},{livePosition:true,liveOrders:true});
 assert.equal(working.book.openBuys,"30");
 const fill=updateCall(working.book,working.call,{status:"FILLED",qty:20,price:399.5},
  {livePosition:true,liveOrders:true});
 assert.equal(fill.book.position,"15");
 assert.equal(fill.book.cash,"0");
 assert.equal(fill.book.openBuys,"30");
 assert.equal(fill.book.ledgerComplete,false);
 assert.equal(fill.fillDelta,20);
});
test("sell fills correctly reduce inventory and increase cash",()=>{
 const call=createCall(emptyDesk(),{...action,side:"SELL",qty:15},2).call;
 const b=emptyBook();b.position="20";
 const a=updateCall(b,call,{status:"FILLED",qty:15,price:399.5});
 assert.equal(a.book.position,"5");
 assert.equal(a.book.cash,String(15*399.5));
});
test("worst-case capacity checks prevent impossible teammate working orders",()=>{
 let book=emptyBook();book.position="995";
 assert.throws(()=>updateCall(book,make(),{status:"WORKING"}),/1000/);
});
test("fill reports cannot regress, duplicate VWAP cannot change, and final fills require total",()=>{
 let call=make(),book=emptyBook();
 ({call,book}=updateCall(book,call,{status:"PARTIAL",qty:10,price:400}));
 assert.throws(()=>updateCall(book,call,{status:"PARTIAL",qty:7,price:400}),/decrease/);
 assert.throws(()=>updateCall(book,call,{status:"PARTIAL",qty:10,price:400.5}),/different average/);
 assert.throws(()=>updateCall(book,call,{status:"FILLED",qty:12,price:400}),/full/);
});
test("no inferred flow from rising prices, and first quote establishes baseline",()=>{
 const book={...emptyBook(),bid:"399.5",ask:"400.5"};
 const start=observeRepricing(null,{symbol:"GRID",book,at:1000});
 assert.equal(start.alert,null);
 assert.equal(start.state.anchorMid,400);
 const up=observeRepricing(start.state,{symbol:"GRID",book:{...book,bid:"401.5",ask:"402.5"},at:2000});
 assert.equal(up.alert.symbol,"GRID");
 assert.equal(up.alert.delta,2);
 assert.equal(up.alert.direction,1);
 assert.equal(up.alert.classification,null);
});
test("tiny oscillations and stale timestamps do not trigger spurious events",()=>{
 const book={...emptyBook(),bid:"400",ask:"401"};
 let x=observeRepricing(null,{symbol:"CURE",book,at:1000});
 const little=observeRepricing(x.state,{symbol:"CURE",book:{...book,bid:"400.5",ask:"401.5"},at:1500});
 assert.equal(little.alert,null);
 const stale=observeRepricing(little.state,{symbol:"CURE",book:{...book,bid:"406",ask:"407"},at:25000});
 assert.equal(stale.alert,null);
 assert.equal(stale.state.anchorMid,406.5);
});
test("cooldown suppresses repeated alerts and resets the new price anchor",()=>{
 const b={...emptyBook(),bid:"400",ask:"401"};
 let x=observeRepricing(null,{symbol:"SAFE",book:b,at:1000});
 x=observeRepricing(x.state,{symbol:"SAFE",book:{...b,bid:"402",ask:"403"},at:2000});
 assert.ok(x.alert);
 const next=observeRepricing(x.state,{symbol:"SAFE",book:{...b,bid:"404",ask:"405"},at:3000});
 assert.equal(next.alert,null);
 const mature=observeRepricing(next.state,{symbol:"SAFE",book:{...b,bid:"407",ask:"408"},at:11000});
 assert.ok(mature.alert);
});
test("price-only alerts require human review before adjusting event model",()=>{
 const initial=emptyDesk();
 const quote={symbol:"GRID",from:400,to:402,delta:2,direction:1,at:2000};
 const {desk,alert}=addPriceAlert(initial,quote,1);
 assert.equal(alert.id,"R1-A001");
 assert.equal(pendingAlerts(desk).length,1);
 assert.throws(()=>classifyPriceAlert(alert,"confirmed",{direction:1,volume:null}),/Enter observed/);
 const investigated=classifyPriceAlert(alert,"reviewed");
 assert.equal(investigated.volume,null);
 assert.equal(investigated.status,"REVIEWED");
 assert.throws(()=>classifyPriceAlert(investigated,"confirmed",{direction:1,volume:50}),/already reviewed/);
});
test("classification preserves signed *observed trade* volume, not price delta",()=>{
 const {alert}=addPriceAlert(emptyDesk(),{
  symbol:"SAFE",from:405,to:403,delta:-2,direction:-1,at:5000},2);
 const classified=classifyPriceAlert(alert,"suspected",{direction:1,volume:40});
 assert.equal(classified.volume,40);
 assert.equal(classified.classification,"suspected");
 const dismissed=classifyPriceAlert(alert,"dismissed");
 assert.equal(dismissed.volume,null);
});
test("fifty fast quote updates and status transitions remain responsive",()=>{
 const start=performance.now();
 let tracking=null;
 for(let i=0;i<50;i++){
  const m=400+(i%6)*0.5;
  tracking=observeRepricing(tracking,{symbol:"GRID",
   book:{...emptyBook(),bid:String(m),ask:String(m+0.5)},at:1000+i*500}).state;
 }
 const call=make();
 for(let i=0;i<30;i++){
  updateCall(emptyBook(),call,{status:"WORKING"});
 }
 assert.ok(performance.now()-start<1000);
});
