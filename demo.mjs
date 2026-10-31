import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {Ledger} from './ledger.mjs';
const ledger=new Ledger();
try {
  const digest=createHash('sha256').update('Tech Boss independent demonstration artifact v1').digest('hex');
  const {release}=ledger.create({project:'independent-demo',digest},'demo-v1');
  for(const gate of ['qa','security']) ledger.attest(release.id,{gate,actor:`demo-${gate}`,reference:`demo-evidence/${gate}`,digest});
  const final=ledger.approve(release.id,{actor:'demo-operator',digest,confirmation:'approve-production-release'});
  mkdirSync('examples',{recursive:true});
  writeFileSync('examples/release.json',JSON.stringify({provenance:'Synthetic local walkthrough. Attestations are demo records, not actual external QA/security approval.',release:final},null,2)+'\n');
  console.log('Created examples/release.json; no infrastructure deployed.');
} finally {ledger.close();}
