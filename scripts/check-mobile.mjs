import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {dirname,resolve,join} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>readFileSync(join(root,p),"utf8");
const css=read("mobile.css");
const apps=[
  ["scavenger","game-scavenger"],
  ["baskets","game-baskets"],
  ["vault","game-vault"],
  ["treasures-and-trash","game-treasures"],
  ["liars-market","game-liars"]
];

test("responsive stylesheet is syntactically balanced, with phone and compact breakpoints",()=>{
  assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
  assert.match(css,/@media \(max-width: 767px\)/);
  assert.match(css,/@media \(max-width: 390px\)/);
  assert.match(css,/safe-area-inset-left/);
  assert.match(css,/font-size: 16px !important/);
  assert.match(css,/min-height: 44px/);
});
test("all five panels include the mobile CSS after their original CSS",()=>{
  for(const [path,cls] of apps){
    const html=read(path+"/index.html");
    const older=html.indexOf('href="./styles.css"'),later=html.indexOf('href="../mobile.css"');
    assert.ok(older>=0&&later>older,path+": mobile stylesheet must override desktop rules");
    assert.ok(html.includes('<body class="'+cls+'">'),path+": body class missing");
    assert.ok(css.includes("body."+cls+" "),path+": no responsive layout rules");
    assert.ok(existsSync(join(root,"dist",path,"index.html")),path+": missing compiled panel");
    assert.equal(read("dist/"+path+"/index.html"),html,path+": compiled HTML stale");
  }
});
test("mobile quote panels display input labels instead of an unreadable desktop spreadsheet",()=>{
  assert.match(read("baskets/app.js"),/class="quick-cell"/);
  assert.match(read("baskets/app.js"),/quick-cell-label/);
  assert.match(read("vault/app.js"),/class="market-cell"/);
  assert.match(css,/\.quick-header \{ display: none; \}/);
  assert.match(css,/\.market-head \{ display: none; \}/);
  assert.match(css,/\.market-row \{ display: grid; min-width: 0; grid-template-columns: repeat\(2/);
});
test("mobile card selection and command controls stay accessible at phone width",()=>{
  assert.match(css,/body\.game-liars \.suit-row \{ min-width: 0; display: grid/);
  assert.match(css,/body\.game-treasures \.trade-picker-ranks/);
  assert.match(css,/body\.game-vault \.pad-values\.long-pad/);
  assert.match(css,/body\.game-baskets \.quick-status-button/);
  assert.match(css,/body\.game-scavenger \.phase-button/);
});
test("homepage, manuals and offline cache all carry the mobile experience",()=>{
  const home=read("index.html"),build=read("scripts/build-site.mjs"),sw=read("sw.js");
  assert.ok(home.includes('href="./mobile.css"'));
  assert.ok(home.includes('class="competition-home"'));
  assert.ok(build.includes('"mobile.css"'));
  assert.ok(sw.includes('"./mobile.css"'));
  assert.ok(existsSync(join(root,"dist","mobile.css")));
  assert.equal(read("dist/mobile.css"),css);
  assert.match(read("manual.css"),/@media \(max-width: 640px\)/);
});
