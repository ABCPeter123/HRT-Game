import test from "node:test";
import assert from "node:assert/strict";
import {createBridgeServer} from "../bridge/server.mjs";
const KEY="a".repeat(36);
async function runServer(fn){
  const bridge=createBridgeServer({port:0,key:KEY});
  const address=await bridge.listen();
  const url="http://127.0.0.1:"+address.port;
  try{return await fn(url);}finally{await bridge.close();}
}
function headers(key=KEY){return {"x-bridge-key":key,"content-type":"application/json"};}
test("bridge responds only on localhost and generates a secret",async()=>{
  const b=createBridgeServer({port:0});
  assert.match(b.key,/^[0-9a-f]{36}$/);
  await b.listen();
  assert.equal(b.server.address().address,"127.0.0.1");
  await b.close();
});
test("unauthenticated access cannot read the current game snapshot",async()=>{
  await runServer(async url=>{
    const health=await fetch(url+"/health");
    assert.equal(health.status,200);
    const denied=await fetch(url+"/snapshot");
    assert.equal(denied.status,401);
    const wrong=await fetch(url+"/snapshot",{headers:headers("b".repeat(36))});
    assert.equal(wrong.status,401);
  });
});
test("bridge transfers only mapped valid numeric quotes, never page text",async()=>{
  await runServer(async url=>{
    const sent=await fetch(url+"/snapshot",{method:"POST",headers:headers(),
      body:JSON.stringify({host:"trade.example.org",cookies:"secret",
        bookBody:"PRIVATE CONTENT",
        books:{GRID:{bid:399.5,ask:400.5,cookie:"secret"},
          CURE:{ask:400.25},SAFE:{position:3}}})});
    assert.equal(sent.status,200);
    const received=await fetch(url+"/snapshot",{headers:headers()});
    const data=await received.json();
    assert.equal(data.stale,false);
    assert.equal(data.seq,1);
    assert.equal(data.snapshot.host,"trade.example.org");
    assert.deepEqual(data.snapshot.books,{GRID:{bid:"399.5",ask:"400.5"},SAFE:{position:"3"}});
    assert.equal(JSON.stringify(data).includes("secret"),false);
    assert.equal(JSON.stringify(data).includes("PRIVATE"),false);
  });
});
test("invalid input does not overwrite the most recent known good snapshot",async()=>{
  await runServer(async url=>{
    let response=await fetch(url+"/snapshot",{method:"POST",headers:headers(),
      body:JSON.stringify({books:{GRID:{bid:399.5,ask:400.5}}})});
    assert.equal(response.status,200);
    response=await fetch(url+"/snapshot",{method:"POST",headers:headers(),
      body:JSON.stringify({books:{GRID:{bid:"not a number"}}})});
    assert.equal(response.status,422);
    const state=await (await fetch(url+"/snapshot",{headers:headers()})).json();
    assert.equal(state.seq,1);
    assert.equal(state.snapshot.books.GRID.bid,"399.5");
  });
});
test("cross-site origins are rejected even if a key is supplied",async()=>{
  await runServer(async url=>{
    const rejected=await fetch(url+"/snapshot",{
      headers:{"x-bridge-key":KEY,origin:"https://malicious.example"}});
    assert.equal(rejected.status,403);
    const local=await fetch(url+"/snapshot",{
      headers:{"x-bridge-key":KEY,origin:"http://localhost:8000"}});
    assert.equal(local.status,200);
    assert.equal(local.headers.get("access-control-allow-origin"),"http://localhost:8000");
  });
});
test("preflight permits only local Baskets pages and extension origin",async()=>{
  await runServer(async url=>{
    const res=await fetch(url+"/snapshot",{
      method:"OPTIONS",
      headers:{origin:"http://127.0.0.1:8000","access-control-request-method":"GET"}});
    assert.equal(res.status,204);
    assert.equal(res.headers.get("access-control-allow-origin"),"http://127.0.0.1:8000");
  });
});
