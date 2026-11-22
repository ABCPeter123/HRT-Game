import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const output=join(root,"dist");
const required=[
  "index.html",
  "sw.js",
  "manual.css",
  "mobile.css",
  "scavenger/index.html",
  "scavenger/manual.html",
  "scavenger/app.js",
  "scavenger/engine.js",
  "scavenger/styles.css",
  "scavenger/README.md",
  "baskets/index.html",
  "baskets/manual.html",
  "baskets/app.js",
  "baskets/engine.js",
  "baskets/import.js",
  "baskets/desk-engine.js",
  "baskets/desk-ui.js",
  "baskets/styles.css",
  "baskets/README.md",
  "liars-market/index.html",
  "liars-market/manual.html",
  "liars-market/app.js",
  "liars-market/engine.js",
  "liars-market/styles.css",
  "liars-market/README.md",
  "treasures-and-trash/index.html",
  "treasures-and-trash/manual.html",
  "treasures-and-trash/app.js",
  "treasures-and-trash/engine.js",
  "treasures-and-trash/styles.css",
  "treasures-and-trash/README.md",
  "vault/index.html",
  "vault/manual.html",
  "vault/app.js",
  "vault/engine.js",
  "vault/import.js",
  "vault/styles.css",
  "vault/README.md"
];
rmSync(output,{recursive:true,force:true});
for(const relative of required) {
  const from=join(root,relative);
  if(!existsSync(from))throw new Error("Missing site asset: "+relative);
  const to=join(output,relative);
  mkdirSync(dirname(to),{recursive:true});
  cpSync(from,to);
}
console.log("Built static decision panels:",required.length,"files. No datasets or Python models exposed.");
