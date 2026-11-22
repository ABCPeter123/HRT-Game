import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const read=rel=>readFileSync(resolve(root,rel),"utf8");

test("Game 5 shows exactly one deal, play and result stage",()=>{
  const html=read("liars-market/index.html");
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  const actualStages=[...html.matchAll(/\bid="stage-(deal|play|result)"/g)].map(m=>m[1]);
  assert.deepEqual(actualStages,["deal","play","result"]);
  assert.equal(new Set(ids).size,ids.length,"HTML element IDs must be unique");
  for(const id of ["flow-steps","flow-next","flow-back","deal-ready","update-cards",
    "to-result","result-summary","record-outcome","reset-game","hand-chips","center-chips"]){
    assert.ok(ids.includes(id),"Missing "+id);
  }
});
test("All static Game 5 app element references exist",()=>{
  const html=read("liars-market/index.html");
  const js=read("liars-market/app.js");
  const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
  const referenced=[...js.matchAll(/\$\("([^"]+)"\)/g)].map(m=>m[1]);
  const missing=[...new Set(referenced.filter(id=>!ids.has(id)))];
  assert.deepEqual(missing,[]);
});
test("Subgame stages persist; revealing cards returns to dealing without losing the claim",()=>{
  const js=read("liars-market/app.js");
  assert.match(js,/stage:"deal"/);
  assert.match(js,/game\(\)\.stage=stage;store\(\);renderFlow\(\)/);
  assert.match(js,/"update-cards"\)\.addEventListener\("click",\(\)=>selectStage\("deal"\)/);
  assert.match(js,/if\(state\.game<state\.maxGames\)\{changeGame\(state\.game\+1\);\}/);
  assert.match(js,/else if\(state\.round<3\)\{changeRound\(state\.round\+1\);\}/);
  assert.match(js,/r\.history\.push\(/);
});
test("Every implemented game has its own confirmed full-reset control",()=>{
  for(const [folder,key] of [
    ["scavenger","quant-comp-scavenger-v1"],
    ["baskets","quant-comp-baskets-v1"],
    ["treasures-and-trash","quant-comp-treasures-v1"],
    ["liars-market","wqc-liars-market-v1"]
  ]){
    const html=read(folder+"/index.html"),js=read(folder+"/app.js");
    assert.match(html,/id="reset-game"/,folder+" has no reset button");
    assert.match(js,/window\.confirm\(/,folder+" must confirm");
    assert.ok(js.includes("localStorage.removeItem("),folder+" must remove saved state");
    assert.ok(js.includes(key),folder+" key mismatch");
  }
});
test("Homepage reset clears only the four game keys with user confirmation",()=>{
  const home=read("index.html");
  assert.match(home,/id="reset-all"/);
  assert.match(home,/window\.confirm\(/);
  assert.match(home,/localStorage\.removeItem\(key\)/);
  for(const key of ["quant-comp-scavenger-v1","quant-comp-baskets-v1",
    "quant-comp-treasures-v1","wqc-liars-market-v1"])assert.ok(home.includes(key));
  assert.doesNotMatch(home,/localStorage\.clear\(/);
});
