import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {createHash,createHmac,randomBytes,timingSafeEqual,scryptSync} from 'node:crypto';
import {mkdirSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {validateClients,makeView} from './model.mjs';

const ROOT=fileURLToPath(new URL('.',import.meta.url));
const production=process.env.NODE_ENV==='production';
const demo=process.env.DEMO_MODE==='true';
if (demo && production) throw new Error('DEMO_MODE is niet toegestaan in productie.');
const dataDir=resolve(process.env.DATA_DIR||join(ROOT,'.data'));
if (production && (process.env.RAILWAY_VOLUME_MOUNT_PATH!=='/data' || dataDir!=='/data')) throw new Error('Koppel eerst een persistent volume op /data.');
const passwordHash=process.env.TEAM_PASSWORD_HASH||'';
const adminPasswordHash=process.env.ADMIN_PASSWORD_HASH||'';
const sessionSecret=process.env.SESSION_SECRET||'';
const syncToken=process.env.SYNC_TOKEN||'';
if (!demo && (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash) || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(adminPasswordHash) || sessionSecret.length<32 || syncToken.length<32)) throw new Error('Stel TEAM_PASSWORD_HASH, ADMIN_PASSWORD_HASH, SESSION_SECRET en SYNC_TOKEN veilig in.');
mkdirSync(dataDir,{recursive:true});
const db=new DatabaseSync(join(dataDir,'voortgang.sqlite'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY, captured_at TEXT, body TEXT NOT NULL);');
function importInitial(input) {
  if (!Array.isArray(input.snapshots) || !input.snapshots.length || input.snapshots.length>100) throw new Error('Ongeldige eerste import.');
  db.exec('BEGIN');
  try {
    for(const s of input.snapshots) {
      if(!/^[a-z0-9-]{1,80}$/.test(s.id)||!['legacy','baseline'].includes(s.kind)||typeof s.label!=='string')throw new Error('Ongeldige import.');
      const clients=validateClients(s.clients);
      if(s.kind==='legacy'&&clients.some(c=>c.priority!==null))throw new Error('Historische prioriteit is onbekend.');
      const snapshot={id:s.id,kind:s.kind,label:s.label,capturedAt:null,reportWeek:Number(s.reportWeek)||null,clients};
      db.prepare('INSERT INTO snapshots VALUES(?,?,?)').run(snapshot.id,null,JSON.stringify(snapshot));
    }
    db.exec('COMMIT');
  } catch(e) {db.exec('ROLLBACK');throw e;}
}
if(process.env.INITIAL_DATA_GZIP_BASE64 && db.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n===0) {
  importInitial(JSON.parse(gunzipSync(Buffer.from(process.env.INITIAL_DATA_GZIP_BASE64,'base64')).toString('utf8')));
}
// Only local previews import this private file. It is excluded from Git and Docker.
if (demo && db.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n===0 && existsSync(join(ROOT,'data-private','initial-data.json'))) {
  importInitial(JSON.parse(readFileSync(join(ROOT,'data-private','initial-data.json'),'utf8')));
}
const all=()=>db.prepare('SELECT body FROM snapshots ORDER BY rowid').all().map(x=>JSON.parse(x.body));
const equal=(a,b)=>timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
const sign=s=>createHmac('sha256',sessionSecret).update(s).digest('base64url');
function session(req, role='viewer') {
  if (demo) return {role,csrf:'demo-csrf',exp:Date.now()+3600000};
  const cookieName=role==='admin'?'vt_admin_session=':'vt_session=';
  const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName))?.slice(cookieName.length)||'';
  const [payload,sig]=cookie.split('.');
  if (!payload || !sig || !equal(sign(payload),sig)) return null;
  try {const value=JSON.parse(Buffer.from(payload,'base64url').toString());return value.exp>Date.now()&&value.role===role?value:null;} catch{return null;}
}
const authorized=req=>Boolean(session(req,'viewer')||session(req,'admin'));
function headers(res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
}
function json(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj));}
async function body(req){let s='';for await(const c of req){s+=c;if(Buffer.byteLength(s)>2_000_000)throw new Error('Te veel gegevens.');}return JSON.parse(s||'{}');}
const attempts=new Map();
setInterval(()=>{for(const[k,v]of attempts)if(v.until<Date.now())attempts.delete(k);},60000).unref();
const limited=key=>{const now=Date.now();let slot=attempts.get(key);if(!slot||slot.until<now){slot={count:0,until:now+15*60*1000};attempts.set(key,slot);}return ++slot.count>15;};
const files={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/styles.css':['styles.css','text/css; charset=utf-8'],'/favicon.svg':['favicon.svg','image/svg+xml'],'/beheer':['beheer.html','text/html; charset=utf-8'],'/beheer.js':['beheer.js','text/javascript; charset=utf-8']};
const server=http.createServer(async(req,res)=>{
  headers(res);
  try {
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET' && url.pathname==='/health')return json(res,200,{ok:true});
    if(req.method==='GET' && files[url.pathname]){const[f,type]=files[url.pathname];res.writeHead(200,{'Content-Type':type});return res.end(readFileSync(join(ROOT,'public',f)));}
    if(req.method==='GET' && url.pathname==='/api/session')return json(res,200,{authenticated:authorized(req),demo});
    if(req.method==='GET' && url.pathname==='/api/admin/session'){const s=session(req,'admin');return json(res,200,{authenticated:Boolean(s),csrf:s?.csrf||'',demo});}
    if(req.method==='POST' && ['/api/login','/api/admin/login'].includes(url.pathname)){
      const admin=url.pathname==='/api/admin/login';
      const ip=production?String(req.headers['x-railway-client-ip']||req.socket.remoteAddress):req.socket.remoteAddress;
      if(limited((admin?'admin:':'viewer:')+ip))return json(res,429,{error:'Te veel pogingen. Probeer het over 15 minuten opnieuw.'});
      const {password}=await body(req);
      const [salt,expected]=(admin?adminPasswordHash:passwordHash).split(':');
      if(!salt || typeof password!=='string' || password.length>300 || !equal(scryptSync(password,salt,64).toString('hex'),expected))return json(res,401,{error:'Het wachtwoord klopt niet.'});
      attempts.delete((admin?'admin:':'viewer:')+ip);
      const value={exp:Date.now()+12*3600*1000,role:admin?'admin':'viewer',nonce:randomBytes(16).toString('hex')};
      if(admin)value.csrf=randomBytes(24).toString('base64url');
      const payload=Buffer.from(JSON.stringify(value)).toString('base64url');
      res.setHeader('Set-Cookie',`${admin?'vt_admin_session':'vt_session'}=${payload}.${sign(payload)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${production?'; Secure':''}`);
      return json(res,200,{ok:true,csrf:value.csrf||''});
    }
    if(req.method==='POST' && url.pathname==='/api/logout'){res.setHeader('Set-Cookie',`vt_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${production?'; Secure':''}`);return json(res,200,{ok:true});}
    if(req.method==='POST' && url.pathname==='/api/admin/logout'){res.setHeader('Set-Cookie',`vt_admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${production?'; Secure':''}`);return json(res,200,{ok:true});}
    if(req.method==='GET' && url.pathname==='/api/admin/draft'){
      const s=session(req,'admin');if(!s)return json(res,401,{error:'Log in als beheerder.'});
      const latest=all().at(-1);return json(res,200,{csrf:s.csrf,baseSnapshotId:latest?.id||null,baseLabel:latest?.label||'Nog geen update',clients:latest?.clients||[]});
    }
    if(req.method==='POST' && url.pathname==='/api/admin/publish'){
      const s=session(req,'admin');if(!s)return json(res,401,{error:'Log in als beheerder.'});
      if(!req.headers['x-csrf-token']||!equal(String(req.headers['x-csrf-token']),s.csrf))return json(res,403,{error:'De beveiligingscontrole is verlopen. Log opnieuw in.'});
      const input=await body(req), current=all().at(-1);
      if(input.baseSnapshotId!==(current?.id||null))return json(res,409,{error:'Er is inmiddels een nieuwere update. Vernieuw de beheerpagina voordat je publiceert.'});
      const now=new Date(), amsterdamDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
      const d=new Date(amsterdamDate+'T12:00:00Z'),day=d.getUTCDay()||7;d.setUTCDate(d.getUTCDate()+4-day);const yearStart=new Date(Date.UTC(d.getUTCFullYear(),0,1));const week=Math.ceil((((d-yearStart)/86400000)+1)/7);
      const clients=validateClients(input.clients).map(c=>({...c,sourceWeek:week}));
      if(current?.clients.some(c=>!clients.some(n=>n.id===c.id)))return json(res,409,{error:'Er ontbreken klanten. De update is niet opgeslagen.'});
      const capturedAt=now.toISOString(),label=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(now);
      const snapshot={id:'beheer-'+now.getTime()+'-'+randomBytes(4).toString('hex'),kind:'published',capturedAt,label,reportWeek:week,clients};
      db.prepare('INSERT INTO snapshots VALUES(?,?,?)').run(snapshot.id,capturedAt,JSON.stringify(snapshot));
      return json(res,201,{ok:true,snapshot:label,count:clients.length});
    }
    if(req.method==='POST' && ['/api/snapshots','/api/import'].includes(url.pathname)){
      if(!syncToken || !equal(req.headers.authorization||'',`Bearer ${syncToken}`))return json(res,401,{error:'Geen toegang.'});
      const input=await body(req);
      if(url.pathname==='/api/import'){
        if(all().length)return json(res,409,{error:'Import kan alleen bij een lege database.'});
        if(!Array.isArray(input.snapshots)||input.snapshots.length>100)throw new Error('Ongeldige import.');
        const imported=input.snapshots.map(s=>{
          if(!/^[a-z0-9-]{1,80}$/.test(s.id)||!['legacy','baseline'].includes(s.kind)||typeof s.label!=='string'||s.label.length>160)throw new Error('Ongeldige import.');
          const clients=validateClients(s.clients);
          if(s.kind==='legacy'&&clients.some(c=>c.priority!==null))throw new Error('Historische prioriteit is onbekend.');
          return {id:s.id,label:s.label,kind:s.kind,capturedAt:null,reportWeek:Number(s.reportWeek)||null,clients};
        });
        db.exec('BEGIN');try{for(const s of imported)db.prepare('INSERT INTO snapshots VALUES(?,?,?)').run(s.id,null,JSON.stringify(s));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
        return json(res,201,{ok:true,count:imported.length});
      }
      if(typeof input.requestId!=='string'||!/^[a-zA-Z0-9-]{8,100}$/.test(input.requestId))throw new Error('Request-ID ontbreekt.');
      const existing=db.prepare('SELECT body FROM snapshots WHERE id=?').get(input.requestId);
      if(existing)return json(res,200,{ok:true,duplicate:true,snapshot:JSON.parse(existing.body).label});
      const clients=validateClients(input.clients);
      // A missing customer is usually a damaged sheet range; require an explicit full import for that change.
      const last=all().at(-1);
      if(last?.clients.some(c=>!clients.some(n=>n.id===c.id)))return json(res,409,{error:'Er ontbreken klanten uit de vorige update. Controleer namen en invoerbereik; updates zijn niet opgeslagen.'});
      const capturedAt=new Date().toISOString();
      const label=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(capturedAt));
      const snapshot={id:input.requestId,kind:'published',capturedAt,label,reportWeek:null,clients};
      db.prepare('INSERT INTO snapshots VALUES(?,?,?)').run(snapshot.id,capturedAt,JSON.stringify(snapshot));
      return json(res,201,{ok:true,snapshot:label,count:clients.length});
    }
    if(req.method==='GET' && url.pathname==='/api/dashboard'){
      if(!authorized(req))return json(res,401,{error:'Log in om de voortgang te bekijken.'});
      return json(res,200,makeView(all(),url.searchParams.get('snapshot'),url.searchParams.get('compare')));
    }
    return json(res,404,{error:'Niet gevonden.'});
  }catch(e){return json(res,400,{error:e instanceof SyntaxError?'Ongeldige gegevens.':e.message||'Er ging iets mis.'});}
});
server.listen(Number(process.env.PORT)||8080,demo?'127.0.0.1':'0.0.0.0',()=>console.log(`Voortgang Thijs luistert op poort ${Number(process.env.PORT)||8080}${demo?' (lokaal voorbeeld)':''}`));
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0);}));
