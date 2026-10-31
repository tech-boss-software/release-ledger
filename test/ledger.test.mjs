import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Ledger} from '../ledger.mjs';
import {app} from '../server.mjs';
const digest='a'.repeat(64),other='b'.repeat(64);
test('idempotency conflicts and evidence requirements prevent unsafe transitions',()=>{
  const l=new Ledger();
  try {
    const {release:r}=l.create({project:'demo',digest},'request-1');
    assert.equal(l.create({project:'demo',digest},'request-1').duplicate,true);
    assert.throws(()=>l.create({project:'other',digest},'request-1'));
    assert.throws(()=>l.approve(r.id,{actor:'owner',digest,confirmation:'approve-production-release'}));
    assert.throws(()=>l.attest(r.id,{gate:'qa',actor:'QA',reference:'report',digest:other}));
    for(const gate of ['qa','security']) l.attest(r.id,{gate,actor:gate,reference:`reports/${gate}`,digest});
    assert.throws(()=>l.approve(r.id,{actor:'owner',digest,confirmation:'yes'}));
    const approved=l.approve(r.id,{actor:'owner',digest,confirmation:'approve-production-release'});
    assert.equal(approved.status,'approved');assert.equal(approved.events.length,4);
    assert.throws(()=>l.attest(r.id,{gate:'qa',actor:'QA',reference:'changed',digest}));
  } finally {l.close();}
});
test('validation rejects invalid hashes and duplicate gate evidence',()=>{
  const l=new Ledger();
  try {
    assert.throws(()=>l.create({project:'demo',digest:'wrong'},'k'));
    const {release:r}=l.create({project:'demo',digest},'k');
    l.attest(r.id,{gate:'qa',actor:'QA',reference:'evidence',digest});
    assert.throws(()=>l.attest(r.id,{gate:'qa',actor:'QA',reference:'replacement',digest}));
  } finally {l.close();}
});
test('state and audit events survive a restart',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ledger-'));let l;
  try {const file=join(dir,'db.sqlite');l=new Ledger(file);const r=l.create({project:'demo',digest},'k');l.close();l=new Ledger(file);assert.equal(l.get(r.release.id).events[0].kind,'created');}
  finally {l?.close();rmSync(dir,{recursive:true,force:true});}
});
test('HTTP rejects unauthorized traffic and malformed JSON',async()=>{
  const token='z'.repeat(48),{server}=app({token});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base+'/releases',{method:'POST',body:'{}'})).status,401);
    const headers={Authorization:`Bearer ${token}`,'Idempotency-Key':'http-1'};
    assert.equal((await fetch(base+'/releases',{method:'POST',headers,body:'null'})).status,400);
    for(const malformed of [[digest],{},null,123]) {
      assert.equal((await fetch(base+'/releases',{method:'POST',headers,body:JSON.stringify({project:'demo',digest:malformed})})).status,400);
    }
    const r=await fetch(base+'/releases',{method:'POST',headers,body:JSON.stringify({project:'demo',digest})});
    assert.equal(r.status,201);const {release}=await r.json();
    assert.equal((await fetch(`${base}/releases/${release.id}`,{headers})).status,200);
  } finally {await new Promise(r=>server.close(r));}
});
