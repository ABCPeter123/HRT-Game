/**
 * Cross-game manual integration smoke test. Run after the static build.
 * Only built-in Node modules are used.
 */
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
const names=["scavenger","baskets","vault","treasures-and-trash","liars-market"];
const sections=["quick","setup","roles","steps","calls","recover","finish"];
const read=p=>readFileSync(join(root,p),"utf8");
const homepage=read("index.html"),build=read("scripts/build-site.mjs"),sw=read("sw.js");
const css=read("manual.css");
assert.match(css,/@media print/,"Manuals must be printable");
assert.match(css,/@media\(max-width:840px\)/,"Manuals need a mobile breakpoint");
assert.ok(homepage.includes("Step-by-step game manuals"),"Homepage manual directory missing");
assert.ok(homepage.includes('class="home-manual-cta"'),"Homepage manual launcher is missing");
assert.ok(build.includes('"manual.css"'),"Printable styling not bundled");
assert.ok(sw.includes('"./manual.css"'),"Manual styling not cached");
for(let i=0;i<names.length;i++){
 const name=names[i],manualPath=name+"/manual.html",appPath=name+"/index.html",stylesPath=name+"/styles.css";
 const manual=read(manualPath),app=read(appPath),styles=read(stylesPath);
 assert.ok(manual.startsWith("<!doctype html>"),name+": manual must be a standalone HTML page");
 assert.match(manual,/<html lang="en">/);
 assert.match(manual,/<meta name="viewport"/);
 assert.match(manual,/href="\.\.\/manual\.css"/);
 assert.match(manual,/href="\.\/"/);
 assert.match(manual,/href="\.\/README\.md"/);
 assert.ok(app.includes('href="./manual.html"'),name+": live panel lacks manual shortcut");
 assert.ok(app.includes('class="manual-callout"'),name+": no prominent manual launcher");
 assert.ok(app.includes('class="manual-callout-button"'),name+": no manual action button");
 assert.ok(styles.includes('.manual-callout{'),name+": manual banner lacks styles");
 assert.match(styles,/\.manual-shortcut/);
 assert.ok(homepage.includes('href="./'+manualPath+'"'),name+": no homepage manual link");
 assert.ok(build.includes('"'+manualPath+'"'),name+": manual excluded from static build");
 assert.ok(sw.includes('"./'+manualPath+'"'),name+": manual missing offline cache");
 assert.ok(existsSync(join(root,"dist",manualPath)),name+": no built manual file");
 assert.equal(read("dist/"+manualPath),manual,name+": built manual differs from source");
 for(const id of sections){
  assert.ok(manual.includes('id="'+id+'"'),name+": missing "+id+" section");
  assert.ok(manual.includes('href="#'+id+'"'),name+": broken "+id+" navigation");
 }
 const ids=[...manual.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(ids.length,new Set(ids).size,name+": duplicate HTML ID");
 const wordCount=manual.replace(/<[^>]*>/g," ").split(/\s+/).filter(Boolean).length;
 assert.ok(wordCount>600,name+": guide must be actionable; got "+wordCount+" words");
 assert.match(manual,/Reset entire/,"Explain erasing local data");
 assert.match(manual,/actual|official/,"Don't imply local panel submits official actions");
 if(name==="scavenger"){
  assert.match(manual,/individually|individual game|Individual competition/i);
  assert.match(manual,/unless the organizer explicitly permits/);
 }else{
  assert.match(manual,/TEAMMATE|TEAM OF|team of/i);
 }
}
console.log("Manual validation passed: five complete guides, source/build/nav/shortcut/offline links.");
