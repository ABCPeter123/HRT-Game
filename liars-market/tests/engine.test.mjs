import test from "node:test";
import assert from "node:assert/strict";
import {ALL_CLAIMS,cardLabel,claimScore,compareClaims,parseClaim,hasClaim,
 highestClaim,handSize,payout,decideReaction,opponentStats,sampleWorlds,evaluateGame}
 from "../engine.js";
const id=(rank,suit=0)=>suit*13+rank-2;

test("54 unique cards, two jokers and correct shorthand parsing",()=>{
  assert.equal(new Set(Array.from({length:54},(_,i)=>cardLabel(i))).size,54);
  assert.deepEqual(parseClaim("2P Q 8"),{type:"two",a:12,b:8});
  assert.deepEqual(parseClaim("SF A"),{type:"sf",a:14,b:0});
  assert.equal(parseClaim("ST 4"),null);
  assert.equal(parseClaim("FH A A"),null);
  assert.equal(parseClaim("2P 4 9"),null);
});
test("exact competition hierarchy and specific rank ordering",()=>{
  assert.equal(ALL_CLAIMS[0].type,"high");
  assert.equal(ALL_CLAIMS.at(-1).type,"six");
  assert.ok(compareClaims({type:"two",a:3,b:2},{type:"straight",a:14})>0);
  assert.ok(compareClaims({type:"full",a:3,b:14},{type:"full",a:2,b:14})>0);
  assert.ok(compareClaims({type:"full",a:8,b:3},{type:"full",a:8,b:2})>0);
  assert.ok(compareClaims({type:"sf",a:5},{type:"four",a:14})>0);
  assert.ok(claimScore({type:"two",a:14,b:10})>claimScore({type:"two",a:14,b:9}));
});
test("jokers are wild, no regular flush and ace-low straights are 5-high",()=>{
  const fourSevens=[id(7,0),id(7,1),id(7,2),id(7,3)];
  assert.equal(hasClaim([...fourSevens,52,53],{type:"six",a:7}),true);
  assert.equal(hasClaim([...fourSevens,52],{type:"six",a:7}),false);
  assert.deepEqual(highestClaim([...fourSevens,52,53]),{type:"six",a:7});
  const hearts2345=[id(2,2),id(3,2),id(4,2),id(5,2),52];
  assert.equal(hasClaim(hearts2345,{type:"sf",a:5}),true);
  assert.equal(hasClaim(hearts2345,{type:"sf",a:7}),false);
  assert.equal(hasClaim([id(9,0),id(10,0),id(11,0),id(12,0),id(13,0)],{type:"sf",a:13}),true);
  assert.equal(highestClaim([id(2,0),id(3,0),id(4,0),id(8,0),id(9,0)]).type,"high");
});
test("full-house and two-pair allocations do not double-use a joker",()=>{
  assert.equal(hasClaim([id(10,0),id(10,1),id(12,0),id(12,1),52],{type:"full",a:10,b:12}),true);
  assert.equal(hasClaim([id(10,0),id(12,0),52],{type:"full",a:10,b:12}),false);
  assert.equal(hasClaim([id(10,0),id(12,0),52,53],{type:"two",a:12,b:10}),true);
  const hand=[id(2,0),id(2,1),id(3,0),id(3,1),id(4,2),id(5,1),id(6,2)];
  assert.equal(highestClaim(hand).type,"two");
});
test("point changes follow claimant and challenger tiers, including Nuts",()=>{
  assert.equal(payout({type:"pair",a:9},"bluff-true"),1);
  assert.equal(payout({type:"pair",a:9},"bluff-false"),-3);
  assert.equal(payout({type:"full",a:9,b:8},"bluff-true"),2);
  assert.equal(payout({type:"full",a:9,b:8},"bluff-false"),-2);
  assert.equal(payout({type:"sf",a:9},"bluff-true"),3);
  assert.equal(payout({type:"sf",a:9},"bluff-false"),-1);
  assert.equal(payout({type:"sf",a:9},"nuts-true"),-4);
  assert.equal(payout({type:"sf",a:9},"nuts-false"),1);
});
test("catch-up card counts at exact thresholds",()=>{
  assert.deepEqual([-8,-6,-5,-4,-3,-2,-1,0,1,2,3,4,5,6,12].map(handSize),
    [7,7,6,6,5,5,4,4,4,3,3,2,2,1,1]);
});
test("reaction thresholds and downside behavior",()=>{
  assert.equal(decideReaction(0,0,{type:"pair",a:2}).action,"BLUFF");
  assert.equal(decideReaction(1,1,{type:"six",a:14}).action,"NUTS");
  assert.equal(decideReaction(1,0,{type:"pair",a:2}).action,"PASS");
  assert.equal(decideReaction(.8,.02,{type:"full",a:9,b:4},1).action,"PASS");
});
test("opponent history uses revealed truth and shrinks tiny sample sizes",()=>{
  assert.equal(opponentStats([],1).credibility,.5);
  assert.equal(opponentStats([{claimant:1,exists:true},{claimant:1,exists:true},{claimant:2,exists:false}],1).credibility,4/6);
});
test("unknown worlds sample without replacement and are reproducible",()=>{
  const a=sampleWorlds({known:[id(2),id(3)],scores:[0,0,0,0],iterations:30});
  const b=sampleWorlds({known:[id(2),id(3)],scores:[0,0,0,0],iterations:30});
  assert.equal(a.total,21);assert.equal(a.missing,19);
  assert.deepEqual(a.worlds.map(w=>w.best),b.worlds.map(w=>w.best));
  assert.throws(()=>sampleWorlds({known:[0,0]}),/Duplicate/);
  assert.throws(()=>sampleWorlds({known:[55]}),/invalid/);
});
test("recommendations only return claims higher than the last claim",()=>{
  const input={known:[id(14,0),id(14,1),id(2,1),id(8,0),id(3,1),id(4,2),id(5,0)],
    scores:[0,0,0,0],previous:{type:"two",a:10,b:5},claimant:1,iterations:150};
  const t=performance.now();
  const r=evaluateGame(input);
  assert.ok(r.claims.length>0);
  assert.ok(r.claims.every(x=>compareClaims(x.claim,input.previous)>0));
  assert.ok(r.reaction.pExists>=0&&r.reaction.pExists<=1);
  assert.ok(r.reaction.pNuts<=r.reaction.pExists);
  assert.ok(performance.now()-t<4000,"Compute should stay fast enough for a live turn");
});
test("six-of-a-kind Aces is terminal; no stronger claim exists",()=>{
  const r=evaluateGame({previous:{type:"six",a:14},iterations:25});
  assert.equal(r.top,null);
  assert.equal(r.claims.length,0);
});
