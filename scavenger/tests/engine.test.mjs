import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  inverseNormal, parseSamples, sampleCostFraction, sampleHint,
  auctionPayout, guessPayout, roundScore, estimatePool,
  optimalFinalGuess, recommendBid, inferRoomScale, refinePoolFromResults, inferOpponentProfiles, OPPONENT_PROFILES
} from "../engine.js";

test("sample parsing, costs and hint are consistent with the packet",()=>{
  assert.deepEqual(parseSamples(" 3, 4; 5\n 6 | 7 "),[3,4,5,6,7]);
  assert.deepEqual(parseSamples(""),[]);
  assert.equal(sampleCostFraction(0),0);
  assert.ok(Math.abs(sampleCostFraction(9)-0.25)<1e-12);
  assert.equal(sampleHint(50),3);
  assert.equal(sampleHint(95),4);
});

test("normal inverse quantile is symmetric and finite at extreme reported percentiles",()=>{
  assert.ok(Math.abs(inverseNormal(0.5))<1e-5);
  assert.ok(Math.abs(inverseNormal(0.1)+inverseNormal(0.9))<1e-5);
  assert.ok(Number.isFinite(inverseNormal(0)));
  assert.ok(Number.isFinite(inverseNormal(1)));
});

test("auction payout: lowest three paid, middle zero, highest receives leftover less error",()=>{
  const bids=[12,18,24,31,38,45];
  const pool=150;
  assert.equal(auctionPayout(pool,bids,0),12);
  assert.equal(auctionPayout(pool,bids,1),18);
  assert.equal(auctionPayout(pool,bids,2),24);
  assert.equal(auctionPayout(pool,bids,3),0);
  assert.equal(auctionPayout(pool,bids,4),0);
  // Remaining after three low bids = 96, and highest bid = 45.
  assert.equal(auctionPayout(pool,bids,5),96-Math.abs(96-45));
});

test("auction payout: highest overbidding can cause negative payout",()=>{
  const bids=[10,20,30,35,40,200];
  // pool 100, residual 40, final payout = 40 - abs(40-200) = -120
  assert.equal(auctionPayout(100,bids,5),-120);
  assert.equal(auctionPayout(100,bids,0),10);
});

test("auction payout: capped first three never exceed pool",()=>{
  const bids=[30,40,50,60,70,100];
  assert.equal(auctionPayout(45,bids,0),30);
  assert.equal(auctionPayout(45,bids,1),15);
  assert.equal(auctionPayout(45,bids,2),0);
  assert.equal(auctionPayout(45,bids,5),-100);
});

test("guess reward is the exact truncated absolute-error function",()=>{
  assert.equal(guessPayout(100,100),25);
  assert.equal(guessPayout(100,120),5);
  assert.equal(guessPayout(100,126),0);
  assert.equal(guessPayout(100,70),0);
});

test("third auction doubles, sample fee applies once",()=>{
  assert.ok(Math.abs(roundScore(120,4,[10,20,30])-(10+20+60-20))<1e-9);
});
test("pool cannot be deduced from percentile alone",()=>{
  assert.equal(estimatePool({percentile:80,samples:[]}),null);
  assert.equal(estimatePool({percentile:80,samples:[],anchor:500}).value,500);
});
test("sample-driven pool estimates stay finite and have uncertainty",()=>{
  for(const percentile of [0,10,50,90,100]){
    for(const samples of ["20 22 24 26 30 33 35","10 10 10 20 20 20", "100"]){
      const result=estimatePool({percentile,samples});
      assert.ok(Number.isFinite(result.value));
      assert.ok(result.hi>=result.value);
      assert.ok(result.lo<=result.value);
    }
  }
});
test("final guess chooses near known pool for a narrow posterior",()=>{
  const estimate={value:150,lo:150,hi:150,n:200,candidates:[{name:"known",value:150,weight:1}],standardError:0.01};
  const result=optimalFinalGuess(estimate,{count:200});
  assert.ok(Math.abs(result.guess-150)<=1);
  assert.ok(result.expected>37);
});
test("optimizer returns integer nonnegative bids for rooms of 6 or 7",()=>{
  const e=estimatePool({percentile:65,samples:"100 110 130 105 120 135 125 115"});
  for(const roomSize of [6,7]){
    for(const phase of [1,2,3]){
      const r=recommendBid({estimate:e,roomSize,phase,scenarios:80});
      assert.ok(Number.isInteger(r.bid)&&r.bid>=0);
      assert.ok(Number.isFinite(r.expected));
      assert.ok(r.lossProbability>=0&&r.lossProbability<=1);
      assert.equal(r.phaseWeight,phase===3?2:1);
    }
  }
});
test("rank feedback modifies opponent distribution",()=>{
  const estimate=estimatePool({percentile:50,samples:"100 110 120 130 140 150"});
  assert.equal(inferRoomScale([],estimate,6),1);
  const scale=inferRoomScale([{bid:130,rank:2}],estimate,6);
  assert.ok(scale>1);
});
test("live recommendations compute without high-latency dependencies",()=>{
  const t0=performance.now();
  const e=estimatePool({percentile:80,samples:"130 85 95 140 110 100 87"});
  recommendBid({estimate:e,phase:3,scenarios:220});
  optimalFinalGuess(e,{count:300});
  const elapsed=performance.now()-t0;
  assert.ok(elapsed<1500,"Compute took "+elapsed+"ms on test runner");
});

test("lowest rank capped payout reveals the exact pool, even without samples",()=>{
  const r=refinePoolFromResults(null,[{bid:"50",rank:"1",payout:"35"}],6);
  assert.equal(r.value,35);
  assert.equal(r.lo,35);
  assert.equal(r.hi,35);
  assert.equal(r.confidence,"EXACT FROM PAYOUT");
});
test("highest rank underpaid establishes residual lower bound",()=>{
  const prior=estimatePool({percentile:50,samples:"10 15 17 20 25"});
  const r=refinePoolFromResults(prior,[{bid:"100",rank:"6",payout:"-40"}],6);
  assert.ok(r.value>=30);
});

test("opponent profile weights are valid and ranks adapt their probabilities",()=>{
  const e=estimatePool({percentile:70,samples:"90 105 120 100 112 132"});
  const baseline=inferOpponentProfiles({estimate:e,history:[],style:"auto",roomSize:6});
  assert.equal(baseline.observations,0);
  assert.ok(Math.abs(Object.values(baseline.weights).reduce((a,b)=>a+b,0)-1)<1e-12);
  const lowCrowd=inferOpponentProfiles({estimate:e,style:"auto",roomSize:6,
    history:[{bid:String(Math.round(e.value*0.37)),rank:"6"}]});
  const highCrowd=inferOpponentProfiles({estimate:e,style:"auto",roomSize:6,
    history:[{bid:String(Math.round(e.value*0.37)),rank:"1"}]});
  assert.equal(lowCrowd.observations,1);
  assert.ok(lowCrowd.weights.cautious>highCrowd.weights.cautious,
    "Being the highest bidder should increase belief in a low-bid room");
  assert.ok(highCrowd.weights.aggressive>lowCrowd.weights.aggressive,
    "Being the lowest bidder should increase belief in high-bid room");
});
test("missing, invalid or incomplete rank observations are safely ignored",()=>{
  const e=estimatePool({percentile:50,samples:"40 50 60 80 90"});
  const result=inferOpponentProfiles({estimate:e,roomSize:6,style:"auto",
    history:[{bid:"100",rank:""},{bid:"",rank:"1"},{bid:"10",rank:"8"}]});
  assert.equal(result.observations,0);
  assert.ok(Math.abs(Object.values(result.weights).reduce((a,b)=>a+b,0)-1)<1e-12);
});
test("manual opponent assumptions create explainable priors while rank evidence still updates them",()=>{
  const e=estimatePool({percentile:50,samples:"100 110 130 140 160"});
  const conservative=inferOpponentProfiles({estimate:e,history:[],style:"cautious"});
  const aggressive=inferOpponentProfiles({estimate:e,history:[],style:"aggressive"});
  assert.ok(conservative.weights.cautious>aggressive.weights.cautious);
  assert.ok(aggressive.weights.aggressive>conservative.weights.aggressive);
  const updated=inferOpponentProfiles({estimate:e,roomSize:7,style:"cautious",
    history:[{bid:"35",rank:"1"}]});
  assert.equal(updated.observations,1);
  assert.notDeepEqual(updated.weights,conservative.weights);
});
test("counterbids and defense statistics are returned for all three opponent scenarios",()=>{
  const e=estimatePool({percentile:55,samples:"100 105 110 115 125 150"});
  const r=recommendBid({estimate:e,roomSize:7,phase:3,risk:0.35,
    history:[{bid:"36",rank:"2"},{bid:"65",rank:"6"}]});
  assert.equal(r.profileCounterBids.length,3);
  assert.equal(OPPONENT_PROFILES.length,3);
  assert.ok(r.lossProbability>=0&&r.lossProbability<=1);
  assert.ok(r.lowSlotProbability>=0&&r.lowSlotProbability<=1);
  assert.ok(r.highestProbability>=0&&r.highestProbability<=1);
  for(const alternative of r.profileCounterBids) {
    assert.ok(Number.isInteger(alternative.bid) && alternative.bid>=0);
    assert.ok(Number.isFinite(alternative.expected));
    assert.ok(alternative.probability>=0 && alternative.probability<=1);
  }
  const weights=r.profileCounterBids.reduce((sum,item)=>sum+item.probability,0);
  assert.ok(Math.abs(weights-1)<1e-12);
  assert.ok(Number.isFinite(r.worstStyleExpected));
});
test("risk sensitivity does not claim an actual loss cap",()=>{
  const e=estimatePool({percentile:85,samples:"60 70 100 130 170 220"});
  for(const risk of [0,0.35,1]) {
    const bid=recommendBid({estimate:e,risk,phase:2,scenarios:110});
    assert.ok(Number.isFinite(bid.expected));
    assert.ok(Number.isFinite(bid.objective));
    assert.ok(Number.isFinite(bid.sd));
    assert.ok(bid.lossProbability>=0&&bid.lossProbability<=1);
  }
});
