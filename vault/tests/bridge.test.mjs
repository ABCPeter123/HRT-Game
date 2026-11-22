import test from "node:test";
import assert from "node:assert/strict";
import {createBridgeServer} from "../bridge/server.mjs";
const KEY="a".repeat(36);
async function withServer(fn){
 const b=createBridgeServer({port:0,key:KEY});
 const addr=await b.listen();
 try{return await fn("http://127.0.0.1:"+addr.port);}finally{await b.close();}
}
const headers=(key=KEY)=>({"content-type":"application/json","x-bridge-key":key});
test("Vault bridge stays on loopback, has independent session key",async()=>{
 const b=createBridgeServer({port:0});await b.listen();
 assert.equal(b.server.address().address,"127.0.0.1");
 assert.match(b.key,/^[a-f0-9]{36}$/);
 await b.close();
});
test("unauthenticated calls and foreign web origins are rejected",async()=>{
 await withServer(async url=>{
  assert.equal((await fetch(url+"/health")).status,200);
  assert.equal((await fetch(url+"/snapshot")).status,401);
  assert.equal((await fetch(url+"/snapshot",{headers:headers("b".repeat(36))})).status,401);
  assert.equal((await fetch(url+"/snapshot",{
   headers:{...headers(),origin:"https://untrusted.example"}})).status,403);
 });
});
test("only validated VAULT G5 PUB numeric quote fields survive",async()=>{
 await withServer(async url=>{
  const raw={host:"game.example.org",cookie:"secret-cookie",password:"secret-password",
   books:{VAULT:{bid:160,ask:160.25,askSize:24,description:"SECRET"},
    G5:{bid:14.1,ask:14.2,position:-14},
    PUB:{bid:20.15,ask:20.75},GRID:{bid:30,ask:31}}};
  const post=await fetch(url+"/snapshot",{method:"POST",headers:headers(),body:JSON.stringify(raw)});
  assert.equal(post.status,200);
  const data=await (await fetch(url+"/snapshot",{headers:headers()})).json();
  assert.equal(data.stale,false);
  assert.deepEqual(data.snapshot.books,{
   VAULT:{bid:"160",ask:"160.25",askSize:"24"},
   G5:{bid:"14.1",ask:"14.2",position:"-14"},
   PUB:{ask:"20.75"}});
  assert.equal(JSON.stringify(data).includes("SECRET"),false);
  assert.equal(JSON.stringify(data).includes("secret"),false);
 });
});
test("invalid snapshot preserves previous valid quote and cannot overwrite",async()=>{
 await withServer(async url=>{
  let res=await fetch(url+"/snapshot",{method:"POST",headers:headers(),
   body:JSON.stringify({books:{VAULT:{bid:130,ask:130.25}}})});
  assert.equal(res.status,200);
  res=await fetch(url+"/snapshot",{method:"POST",headers:headers(),
   body:JSON.stringify({books:{VAULT:{bid:"invalid",ask:"also invalid"}}})});
  assert.equal(res.status,422);
  const snapshot=await (await fetch(url+"/snapshot",{headers:headers()})).json();
  assert.equal(snapshot.seq,1);
  assert.equal(snapshot.snapshot.books.VAULT.bid,"130");
 });
});
test("local web and Chrome extension CORS preflight allowed",async()=>{
 await withServer(async url=>{
  const res=await fetch(url+"/snapshot",{method:"OPTIONS",headers:{
    origin:"http://localhost:8000","access-control-request-method":"GET"}});
  assert.equal(res.status,204);
  assert.equal(res.headers.get("access-control-allow-origin"),"http://localhost:8000");
 });
});
