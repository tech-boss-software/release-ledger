import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {Ledger,Conflict,Validation} from './ledger.mjs';
export function app({token,database=':memory:'}) {
  if(typeof token!=='string' || token.length<32) throw new Validation('LEDGER_TOKEN requires at least 32 characters');
  const ledger=new Ledger(database),expected=Buffer.from(`Bearer ${token}`);
  const server=createServer(async(req,res)=>{
    const send=(status,payload)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(payload));};
    if(req.url==='/healthz' && req.method==='GET') return send(200,{status:'ok',service:'release-ledger'});
    const actual=Buffer.from(req.headers.authorization||'');
    if(actual.length!==expected.length || !timingSafeEqual(actual,expected)) return send(401,{error:'Unauthorized'});
    const match=/^\/releases\/([a-f0-9-]+)(?:\/(attest|approve))?$/.exec(req.url||'');
    if(req.method==='GET' && match && !match[2]) {
      try{return send(200,ledger.get(match[1]));}catch{return send(404,{error:'Unknown release'});}
    }
    if(req.method!=='POST' || (req.url!=='/releases' && !match?.[2])) return send(404,{error:'Not found'});
    const chunks=[];let size=0;
    try {
      for await(const chunk of req) {
        size+=chunk.length;
        if(size>16384) return send(413,{error:'Request exceeds 16 KiB'});
        chunks.push(chunk);
      }
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!body || typeof body!=='object' || Array.isArray(body)) throw new Validation('Expected JSON object');
      if(req.url==='/releases') {
        const result=ledger.create(body,req.headers['idempotency-key']);return send(result.duplicate?200:201,result);
      }
      return send(200,match[2]==='attest'?ledger.attest(match[1],body):ledger.approve(match[1],body));
    } catch(e) {send(e instanceof Conflict?409:e instanceof Validation || e instanceof SyntaxError?400:500,{error:e instanceof Conflict || e instanceof Validation?e.message:'Invalid request or internal failure'});}
  });
  server.requestTimeout=10000;server.headersTimeout=8000;
  server.on('close',()=>ledger.close());return {server,ledger};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {server}=app({token:process.env.LEDGER_TOKEN,database:process.env.LEDGER_DB||'ledger.sqlite'});
  server.listen(Number(process.env.PORT||8790),'127.0.0.1',()=>console.log('Release ledger listening on localhost; no deployments are executed.'));
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close());
}
