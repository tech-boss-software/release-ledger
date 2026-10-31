import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';

export class Conflict extends Error {}
export class Validation extends Error {}
const digestPattern=/^[a-f0-9]{64}$/;
const gates=new Set(['qa','security']);
function text(value,label) {
  if(typeof value!=='string' || !value.trim() || value.length>200) throw new Validation(`${label} must contain 1–200 characters`);
  return value.trim();
}

export class Ledger {
  constructor(path=':memory:') {
    this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS releases(id TEXT PRIMARY KEY, project TEXT NOT NULL, digest TEXT NOT NULL, status TEXT NOT NULL, request_key TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS evidence(release_id TEXT NOT NULL REFERENCES releases(id), gate TEXT NOT NULL, actor TEXT NOT NULL, reference TEXT NOT NULL, PRIMARY KEY(release_id,gate));
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY, release_id TEXT NOT NULL, kind TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL);
      PRAGMA foreign_keys=ON;`);
  }
  create({project,digest},requestKey) {
    project=text(project,'project');requestKey=text(requestKey,'Idempotency-Key');
    if(typeof digest!=='string' || !digestPattern.test(digest)) throw new Validation('digest must be lowercase SHA-256');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior=this.db.prepare('SELECT * FROM releases WHERE request_key=?').get(requestKey);
      if(prior) {
        if(prior.project!==project || prior.digest!==digest) throw new Conflict('Idempotency key already used for different content');
        this.db.exec('COMMIT');return {release:this.get(prior.id),duplicate:true};
      }
      const id=randomUUID();
      this.db.prepare('INSERT INTO releases VALUES(?,?,?,?,?)').run(id,project,digest,'candidate',requestKey);
      this.event(id,'created','operator');this.db.exec('COMMIT');
      return {release:this.get(id),duplicate:false};
    } catch(e) {this.db.exec('ROLLBACK');throw e;}
  }
  get(id) {
    const release=this.db.prepare('SELECT id,project,digest,status FROM releases WHERE id=?').get(id);
    if(!release) throw new Validation('Unknown release');
    return {...release,evidence:this.db.prepare('SELECT gate,actor,reference FROM evidence WHERE release_id=? ORDER BY gate').all(id),events:this.db.prepare('SELECT kind,actor,at FROM events WHERE release_id=? ORDER BY seq').all(id)};
  }
  event(id,kind,actor) {this.db.prepare('INSERT INTO events(release_id,kind,actor,at) VALUES(?,?,?,?)').run(id,kind,actor,new Date().toISOString());}
  attest(id,{gate,actor,reference,digest}) {
    if(!gates.has(gate)) throw new Validation('gate must be qa or security');
    actor=text(actor,'actor');reference=text(reference,'reference');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const release=this.get(id);
      if(release.status!=='candidate') throw new Conflict('Released candidates are immutable');
      // Evidence is bound to bytes, rather than a mutable branch name or file path.
      if(digest!==release.digest) throw new Conflict('Evidence digest does not match candidate');
      if(release.evidence.some(e=>e.gate===gate)) throw new Conflict('Gate is already attested; create a new candidate to replace evidence');
      this.db.prepare('INSERT INTO evidence VALUES(?,?,?,?)').run(id,gate,actor,reference);
      this.event(id,`${gate}-attested`,actor);this.db.exec('COMMIT');return this.get(id);
    } catch(e) {this.db.exec('ROLLBACK');throw e;}
  }
  approve(id,{actor,digest,confirmation}) {
    actor=text(actor,'actor');
    if(confirmation!=='approve-production-release') throw new Validation('Explicit release confirmation required');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const release=this.get(id);
      if(release.status!=='candidate') throw new Conflict('Release already approved');
      if(digest!==release.digest || release.evidence.length!==2) throw new Conflict('Matching digest and both QA/security attestations are required');
      // This single-operator demo records a declaration, not authenticated human identity.
      this.db.prepare("UPDATE releases SET status='approved' WHERE id=?").run(id);
      this.event(id,'production-approved',actor);this.db.exec('COMMIT');return this.get(id);
    } catch(e) {this.db.exec('ROLLBACK');throw e;}
  }
  close(){this.db.close();}
}
