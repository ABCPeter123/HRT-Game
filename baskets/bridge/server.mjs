/*
 * Local-only Baskets DOM snapshot relay. Node 20+, zero dependencies.
 * Read-only exchange capture. Never proxies requests to the game.
 * A fresh 144-bit secret is printed at startup; only localhost can connect.
 */
import http from "node:http";
import {randomBytes,timingSafeEqual} from "node:crypto";
import {fileURLToPath} from "node:url";
import {sanitizeMarketSnapshot} from "../import.js";

const LOCAL_ORIGIN=/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;
const EXTENSION_ORIGIN=/^chrome-extension:\/\/[a-p]{32}$/;
function originAllowed(value){
  return !value||LOCAL_ORIGIN.test(value)||EXTENSION_ORIGIN.test(value);
}
function cleanHost(host){
  return typeof host==="string"&&/^[a-z0-9.-]{1,200}$/i.test(host)?host:"unknown";
}
function authenticate(request,key){
  const incoming=request.headers["x-bridge-key"];
  if(typeof incoming!=="string")return false;
  const a=Buffer.from(incoming),b=Buffer.from(key);
  return a.length===b.length&&timingSafeEqual(a,b);
}
function respond(response,code,object){
  response.writeHead(code,{"content-type":"application/json; charset=utf-8",
    "cache-control":"no-store","x-content-type-options":"nosniff"});
  response.end(JSON.stringify(object));
}
export function createBridgeServer({port=8765,host="127.0.0.1",key=randomBytes(18).toString("hex")}={}){
  if(!/^[0-9a-f]{36}$/.test(key))throw new Error("Bridge key must be a 36-character hex string.");
  let latest=null,seq=0,receivedAt=0,lastPost=0;
  const server=http.createServer(async(req,res)=>{
    const origin=req.headers.origin||"";
    if(!originAllowed(origin)){respond(res,403,{error:"Only local web pages and Chrome extensions are allowed."});return;}
    if(origin){
      res.setHeader("access-control-allow-origin",origin);
      res.setHeader("access-control-allow-methods","GET,POST,OPTIONS");
      res.setHeader("access-control-allow-headers","content-type,x-bridge-key");
      res.setHeader("vary","origin");
    }
    if(req.method==="OPTIONS"){res.writeHead(204);res.end();return;}
    const path=(req.url||"").split("?")[0];
    if(path==="/health" && req.method==="GET"){
      respond(res,200,{ready:true,localOnly:true});return;
    }
    if(!authenticate(req,key)){respond(res,401,{error:"Incorrect bridge key."});return;}
    if(path==="/snapshot"&&req.method==="GET"){
      const ageMs=latest?Date.now()-receivedAt:null;
      respond(res,200,{seq,receivedAt,ageMs,stale:ageMs===null||ageMs>3500,
        snapshot:ageMs!==null&&ageMs<=3500?latest:null});return;
    }
    if(path==="/snapshot"&&req.method==="POST"){
      let data="";
      try{
        for await(const chunk of req){
          data+=chunk.toString("utf8");
          if(data.length>16384){respond(res,413,{error:"Snapshot too large."});return;}
        }
        const raw=JSON.parse(data);
        const clean=sanitizeMarketSnapshot(raw);
        if(!clean){respond(res,422,{error:"No valid mapped fields."});return;}
        const now=Date.now();
        if(now-lastPost<120){respond(res,429,{error:"Capture rate exceeds 8 Hz."});return;}
        lastPost=now;seq++;
        receivedAt=now;latest={...clean,host:cleanHost(raw.host)};
        respond(res,200,{ok:true,seq,receivedAt});
      }catch{respond(res,400,{error:"Invalid JSON snapshot."});}
      return;
    }
    respond(res,404,{error:"Unknown bridge route."});
  });
  server.requestTimeout=5000;
  server.headersTimeout=6000;
  return {server,key,port,host,listen:()=>new Promise((resolve,reject)=>{
    server.once("error",reject);
    server.listen(port,host,()=>{server.off("error",reject);resolve(server.address());});
  }),close:()=>new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()))};
}

if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]){
  const instance=createBridgeServer({port:Number(process.env.BASKETS_BRIDGE_PORT)||8765});
  instance.listen().then(address=>{
    process.stdout.write("\nBASKETS READ-ONLY LOCAL BRIDGE\n");
    process.stdout.write("Endpoint: http://127.0.0.1:"+address.port+"\n");
    process.stdout.write("Session key: "+instance.key+"\n");
    process.stdout.write("Keep this terminal open while you play. No game requests or orders are made.\n\n");
  }).catch(error=>{
    process.stderr.write("Could not start local bridge: "+error.message+"\n");
    process.exitCode=1;
  });
}
