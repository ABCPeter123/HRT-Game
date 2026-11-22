import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const read=path=>readFileSync(resolve(root,path),"utf8");
test("Vault stage flow and all app DOM IDs are present",()=>{
 const html=read("vault/index.html"),js=read("vault/app.js");
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(new Set(ids).size,ids.length);
 assert.deepEqual([...html.matchAll(/\bid="stage-(reveal|trade|review)"/g)].map(m=>m[1]),["reveal","trade","review"]);
 const found=new Set(ids);
 const refs=[...js.matchAll(/\$\("([^"]+)"\)/g)].map(m=>m[1]);
 assert.deepEqual([...new Set(refs.filter(x=>!found.has(x)))],[]);
});
test("market reader uses independent Vault port, symbol list and session storage key",()=>{
 const background=read("vault/bridge/extension/background.js");
 const capture=read("vault/bridge/extension/capture.js");
 const popup=read("vault/bridge/extension/popup.js");
 const popupHtml=read("vault/bridge/extension/popup.html");
 const server=read("vault/bridge/server.mjs");
 for(const x of [background,capture,popup]){
  for(const sym of ["VAULT","G5","PUB"])assert.ok(x.includes(sym));
  for(const sym of ["GRID","CURE","SAFE"])assert.ok(!x.includes('"'+sym+'"'));
 }
 assert.match(background,/127\.0\.0\.1:8766/);
 assert.match(server,/port=8766/);
 assert.match(popup,/vaultBridgeKey/);
 assert.match(popupHtml,/id="vaultBridgeKey"/);
 assert.match(background,/vaultBridgeKey/);
 assert.match(capture,/valid\(sym,field,result\.value\)/);
});
test("Vault live file build contains imported engine and independent reset",()=>{
 const build=read("scripts/build-site.mjs");
 const home=read("index.html");
 for(const p of ["vault/index.html","vault/app.js","vault/engine.js","vault/styles.css","vault/import.js"]){
  assert.ok(build.includes(p),"Missing "+p);
 }
 assert.ok(home.includes("quant-comp-vault-v1"));
 assert.ok(home.includes("./vault/"));
 assert.ok(read("vault/index.html").includes('id="reset-game"'));
});


test("Vault chip pad supports one-tap values for partial, exact and combo references",()=>{
 const html=read("vault/index.html"),js=read("vault/app.js");
 for(const id of ["chip-tap-pad","chip-pad-kinds","chip-pad-targets","chip-pad-values","chip-pad-note","save-next-chip"])
  assert.ok(html.includes('id="'+id+'"'),"Missing chip entry control "+id);
 for(const target of ["partial-value","true-value","combo-a","combo-b","combo-value"])
  assert.ok(js.includes('"'+target+'"'),"No button target for "+target);
 assert.match(js,/data-chip-pad-number/);
 assert.match(js,/state\.selected=currentRole\(\)==="maker"\?state\.selected%20\+1:state\.selected%30\+1/);
 assert.match(js,/if\(!saveChip\(\)\)return/);
});
