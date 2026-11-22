import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  inverseNormal, parseSamples, sampleCostFraction, sampleHint,
  auctionPayout, guessPayout, roundScore, estimatePool,
  optimalFinalGuess, recommendBid, inferRoomScale, refinePoolFromResults,
  inferOpponentProfiles, learnAcrossRounds, calibratePoolEstimate,
  recommendSampleCount, OPPONENT_PROFILES
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

const roundForTraining=(percentile,samples,actualPool,auctions=[],roomSize=6)=>({
  roomSize,percentile:String(percentile),samples,actualPool:String(actualPool??""),
  sampleCount:String(parseSamples(samples).length),
  auctions:Array.from({length:3},(_,i)=>auctions[i]||{bid:"",rank:"",payout:""})
});
const closeTo=(actual,expected,tolerance=1e-9)=>
  assert.ok(Math.abs(actual-expected)<=tolerance,actual+" differs from "+expected);

test("cross-round learning begins neutral and does not require hidden training state",()=>{
  const rounds=Array.from({length:5},()=>roundForTraining(50,"",""));
  const l=learnAcrossRounds(rounds,0);
  assert.equal(l.priorRounds,0);
  assert.equal(l.verifiedPoolCount,0);
  assert.equal(l.rankCount,0);
  closeTo(l.roomScale,1);
  closeTo(Object.values(l.historicalWeights).reduce((a,b)=>a+b,0),1);
  assert.equal(recommendSampleCount(50,l).count,3);
});
test("learning uses strictly earlier rounds, never future rounds or current true pool",()=>{
  const first=roundForTraining(75,"10 20 30 40 50",28,[
    {bid:"8",rank:"6",payout:"8"}]);
  const current=roundForTraining(20,"100 200 300",900,[
    {bid:"500",rank:"1",payout:"400"}]);
  const future=roundForTraining(90,"900 1200 2000",3100,[
    {bid:"2000",rank:"7",payout:"30"}],7);
  const full=[first,current,future];
  const initial=learnAcrossRounds(full,0);
  const next=learnAcrossRounds(full,1);
  const editedFuture=learnAcrossRounds([first,current,{
    ...future,actualPool:"10",auctions:[{bid:"5",rank:"1",payout:"4"}]
  }],1);
  assert.equal(initial.verifiedPoolCount,0);
  assert.equal(next.verifiedPoolCount,1);
  assert.equal(next.rankCount,1);
  assert.deepEqual(editedFuture,next,"Future edits must not retroactively affect Round 2 recommendations");
  const round3=learnAcrossRounds(full,2);
  assert.equal(round3.verifiedPoolCount,2);
  assert.equal(round3.rankCount,2);
});
test("missing true outcomes and manual anchors never fabricate pool training",()=>{
  const first=roundForTraining(50,"10 15 20","",[{bid:"80",rank:"4",payout:"0"}]);
  first.anchor="1500";
  const l=learnAcrossRounds([first,roundForTraining(50,"","")],1);
  assert.equal(l.verifiedPoolCount,0);
  assert.equal(l.rankCount,1);
  assert.equal(l.avgRelativePoolError,null);
  const raw=estimatePool({percentile:50,samples:"10 15 20"});
  assert.strictEqual(calibratePoolEstimate(raw,l),raw);
});
test("capped rank-one payout supplies logically exact prior pool for training",()=>{
  const prior=roundForTraining(55,"35 42 50 70 80",null,[
    {bid:"100",rank:"1",payout:"65"}]);
  const l=learnAcrossRounds([prior,roundForTraining(50,"","")],1);
  assert.equal(l.verifiedPoolCount,1);
  assert.equal(l.payoutInferredPools,1);
  assert.equal(l.rows[0].poolSource,"inferred from rank-1 payout");
  assert.ok(Number.isFinite(l.avgRelativePoolError));
});
test("prior-round pool outcomes reweight candidates without pretending exact confidence",()=>{
  const first=roundForTraining(80,"60 70 75 85 120 160",200);
  const second=roundForTraining(85,"45 70 80 100 115 185",175);
  const history=learnAcrossRounds([first,second,roundForTraining(50,"","")],2);
  assert.equal(history.verifiedPoolCount,2);
  assert.ok(Object.keys(history.familyMultipliers).length>=4);
  assert.ok(history.poolStrength>0 && history.poolStrength<=0.55);
  const baseline=estimatePool({percentile:90,samples:"30 50 90 100 120 180"});
  const modified=calibratePoolEstimate(baseline,history);
  closeTo(modified.candidates.reduce((sum,c)=>sum+c.weight,0),1);
  assert.ok(modified.lo<=modified.value && modified.hi>=modified.value);
  assert.ok(modified.standardError>=baseline.standardError);
  assert.equal(modified.calibratedFrom,2);
  const firstPass=calibratePoolEstimate(baseline,history);
  assert.deepEqual(modified,firstPass,"Calibration should be reproducible on every render");
});
test("exact current pool inference and rough manual anchor override history calibration",()=>{
  const old=roundForTraining(90,"20 40 50 90 100 120",200);
  const l=learnAcrossRounds([old,roundForTraining(50,"","")],1);
  const manual=estimatePool({percentile:50,samples:[],anchor:500});
  assert.strictEqual(calibratePoolEstimate(manual,l),manual);
  const exact=refinePoolFromResults(null,[{bid:"120",rank:"1",payout:"80"}],6);
  assert.strictEqual(calibratePoolEstimate(exact,l),exact);
  assert.equal(exact.value,80);
});
test("previous-room opponent model contributes a weak but non-zero adaptive prior",()=>{
  const past=[
    roundForTraining(50,"10 20 25 30 40 50",45,[
      {bid:"15",rank:"6",payout:"0"},{bid:"18",rank:"6",payout:"0"},{bid:"20",rank:"5",payout:"0"}],6),
    roundForTraining(50,"25 30 40 50 70 90",55,[
      {bid:"15",rank:"7",payout:"0"},{bid:"20",rank:"6",payout:"0"},{bid:"21",rank:"6",payout:"0"}],7),
    roundForTraining(50,"50 60 70 80 85 95",80,[
      {bid:"20",rank:"6",payout:"0"},{bid:"25",rank:"5",payout:"0"}],6)
  ];
  const l=learnAcrossRounds([...past,roundForTraining(50,"","")],3);
  assert.equal(l.rankCount,8);
  assert.equal(l.evidenceRounds,3);
  assert.ok(l.historicalWeights.cautious>0.32);
  closeTo(Object.values(l.historicalWeights).reduce((a,b)=>a+b,0),1);
  assert.ok(l.roomScale>=0.8 && l.roomScale<=1.25);
  const e=estimatePool({percentile:50,samples:"40 50 60 70 80"});
  const baseline=inferOpponentProfiles({estimate:e,style:"auto",history:[]});
  const adapted=inferOpponentProfiles({estimate:e,style:"auto",history:[],
    historicalWeights:l.historicalWeights});
  assert.ok(adapted.weights.cautious>baseline.weights.cautious);
  const result=recommendBid({estimate:e,learning:l,phase:1,scenarios:90});
  assert.ok(Number.isInteger(result.bid));
  assert.ok(result.profile.weights.cautious>baseline.weights.cautious);
  assert.ok(result.roomScale>=0.65&&result.roomScale<=1.65);
});
test("manual opponent choice retains priority over weak cross-round model",()=>{
  const e=estimatePool({percentile:60,samples:"20 30 35 42 55 80"});
  const weights={cautious:1,normal:0,aggressive:0};
  const manual=inferOpponentProfiles({estimate:e,style:"aggressive",
    historicalWeights:weights,history:[]});
  assert.ok(manual.weights.aggressive>manual.weights.cautious);
});
test("disabling historical learning leaves current-room rank adaptation intact",()=>{
  const previous=roundForTraining(75,"10 15 20 30 60",100,[
    {bid:"15",rank:"6",payout:"0"}]);
  const disabled=learnAcrossRounds([previous,roundForTraining(70,"","")],1,{enabled:false});
  assert.equal(disabled.enabled,false);
  assert.equal(disabled.verifiedPoolCount,0);
  assert.equal(disabled.rankCount,0);
  const e=estimatePool({percentile:70,samples:"25 35 40 50 60"});
  const ranks=[{bid:"10",rank:"6"}];
  const withToggle=recommendBid({estimate:e,learning:disabled,history:ranks,scenarios:80});
  const withoutToggle=recommendBid({estimate:e,history:ranks,scenarios:80});
  assert.equal(withToggle.bid,withoutToggle.bid);
  assert.deepEqual(withToggle.profile.weights,withoutToggle.profile.weights);
  assert.equal(inferOpponentProfiles({estimate:e,history:ranks}).observations,1);
});
test("sample policy changes by at most one and only with adequate verified outcomes",()=>{
  const noHistory=recommendSampleCount(95);
  assert.equal(noHistory.count,4);
  const poor={enabled:true,verifiedPoolCount:3,avgRelativePoolError:.28,avgSamples:3};
  assert.equal(recommendSampleCount(95,poor).count,5);
  assert.equal(recommendSampleCount(50,poor).count,4);
  const good={enabled:true,verifiedPoolCount:3,avgRelativePoolError:.025,avgSamples:5};
  assert.equal(recommendSampleCount(95,good).count,3);
  assert.equal(recommendSampleCount(50,good).count,2);
  const tooFew={enabled:true,verifiedPoolCount:1,avgRelativePoolError:.75,avgSamples:2};
  assert.equal(recommendSampleCount(50,tooFew).count,3);
});
test("old rounds without explicit room-size remain valid for historical learning",()=>{
  const old=roundForTraining(50,"10 15 20 22 25",20,[{bid:"10",rank:"6",payout:"0"}]);
  delete old.roomSize;
  const l=learnAcrossRounds([old,roundForTraining(60,"","")],1);
  assert.equal(l.rankCount,1);
  assert.equal(l.verifiedPoolCount,1);
});
test("learning calculations remain responsive on all five rounds",()=>{
  const rounds=Array.from({length:5},(_,i)=>roundForTraining(25+i*15,
    "25 35 45 50 60 70 90",80+i*10,[
      {bid:"12",rank:"1",payout:"12"},
      {bid:"25",rank:"4",payout:"0"},
      {bid:"85",rank:"6",payout:"20"}]));
  const start=performance.now();
  for(let i=0;i<15;i++){
    const learn=learnAcrossRounds(rounds,4);
    const e=calibratePoolEstimate(estimatePool({percentile:80,samples:"30 45 50 65 75"}),learn);
    const r=recommendBid({estimate:e,learning:learn,phase:3,scenarios:100});
    assert.ok(Number.isInteger(r.bid));
  }
  assert.ok(performance.now()-start<4000,"Repeated learned recommendations exceeded interactive latency");
});
