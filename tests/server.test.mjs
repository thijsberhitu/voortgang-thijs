import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {randomBytes,scryptSync} from 'node:crypto';
const salt=randomBytes(16).toString('hex'), password='test-only-password',adminSalt=randomBytes(16).toString('hex'),adminPassword='test-only-admin-password';
const vars={...process.env,DEMO_MODE:'false',NODE_ENV:'test',PORT:'8098',DATA_DIR:mkdtempSync(join(tmpdir(),'vt-api-test-')),TEAM_PASSWORD_HASH:salt+':'+scryptSync(password,salt,64).toString('hex'),ADMIN_PASSWORD_HASH:adminSalt+':'+scryptSync(adminPassword,adminSalt,64).toString('hex'),SESSION_SECRET:randomBytes(40).toString('hex'),SYNC_TOKEN:randomBytes(40).toString('hex')};
test('Authenticatie, volledige snapshots, retries en opslag na herstart',async()=>{
  let server;
  async function start(){server=spawn(process.execPath,['server.mjs'],{env:vars,stdio:['ignore','pipe','pipe']});await Promise.race([once(server.stdout,'data'),once(server,'exit').then(()=>{throw Error('Server niet gestart');})]);}
  const request=(path,body,headers={})=>fetch('http://127.0.0.1:8098'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
  try{
    await start();
    assert.equal((await request('/api/dashboard')).status,401);
    assert.equal((await request('/api/login',{password:'fout'})).status,401);
    const login=await request('/api/login',{password});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const c={name:'Testklant',priority:4,status:'Actie nodig',lastAction:'Plan gemaakt',nextAction:'Plan bespreken'};
    const auth={Authorization:'Bearer '+vars.SYNC_TOKEN};
    assert.equal((await request('/api/snapshots',{requestId:'test-first',clients:[c]})).status,401);
    assert.equal((await request('/api/snapshots',{requestId:'test-first',clients:[c]},auth)).status,201);
    assert.equal((await request('/api/snapshots',{requestId:'test-first',clients:[c]},auth)).status,200);
    assert.equal((await request('/api/snapshots',{requestId:'test-second',clients:[{...c,priority:1}]},auth)).status,201);
    assert.equal((await request('/api/snapshots',{requestId:'test-missing',clients:[{...c,name:'Andere klant'}]},auth)).status,409);
    const view=await (await request('/api/dashboard',null,{Cookie:cookie})).json();
    assert.equal(view.snapshots.length,2);assert.equal(view.clients[0].change.kind,'up');assert.equal(view.clients[0].history[0].priority,4);assert.deepEqual(view.priorityHistory.rows[0].positions,[4,1]);
    assert.equal((await request('/api/admin/draft')).status,401);
    const adminLogin=await request('/api/admin/login',{password:adminPassword});assert.equal(adminLogin.status,200);
    const adminCookie=adminLogin.headers.get('set-cookie').split(';')[0],adminSession=await adminLogin.json();
    const draft=await (await request('/api/admin/draft',null,{Cookie:adminCookie})).json();assert.equal(draft.clients.length,1);
    const published=await request('/api/admin/publish',{baseSnapshotId:draft.baseSnapshotId,clients:[{...draft.clients[0],priority:3,nextAction:'Nieuwe actie'}]},{Cookie:adminCookie,'X-CSRF-Token':adminSession.csrf});
    assert.equal(published.status,201);
    assert.equal((await request('/api/admin/publish',{baseSnapshotId:draft.baseSnapshotId,clients:draft.clients},{Cookie:adminCookie,'X-CSRF-Token':adminSession.csrf})).status,409);
    const latestDraft=await (await request('/api/admin/draft',null,{Cookie:adminCookie})).json();assert.equal(latestDraft.editableSnapshots.length,3);
    const correction=await (await request('/api/admin/draft?'+new URLSearchParams({snapshot:latestDraft.baseSnapshotId}),null,{Cookie:adminCookie})).json();assert.equal(correction.mode,'edit');
    const corrected=await request('/api/admin/publish',{editSnapshotId:correction.editSnapshotId,revision:correction.revision,clients:[{...correction.clients[0],priority:2,nextAction:'Gecorrigeerde actie'}]},{Cookie:adminCookie,'X-CSRF-Token':adminSession.csrf});assert.equal(corrected.status,200);
    assert.equal((await request('/api/admin/publish',{editSnapshotId:correction.editSnapshotId,revision:correction.revision,clients:correction.clients},{Cookie:adminCookie,'X-CSRF-Token':adminSession.csrf})).status,409);
    server.kill('SIGTERM');await once(server,'exit');await start();
    const persisted=await (await request('/api/dashboard',null,{Cookie:cookie})).json();assert.equal(persisted.snapshots.length,3);
    assert.equal(persisted.clients[0].priority,2);assert.equal(persisted.clients[0].nextAction,'Gecorrigeerde actie');assert.match(persisted.selected.id,/^beheer-/);assert.ok(persisted.selected.reportWeek>=1);
  }finally{if(server&&server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}}
});
