const MAX_CLIENTS = 250;
const txt = (v, max = 20000) => typeof v === 'string' ? v.trim().slice(0, max) : '';
export function clientId(name) {
  return String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
export function validateClients(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_CLIENTS) throw new Error('Geen geldige klantenlijst.');
  const ids = new Set();
  return rows.map(r => {
    const name = txt(r.name, 160), id = clientId(name);
    if (!id || ids.has(id)) throw new Error('Klantnamen ontbreken of komen dubbel voor.');
    ids.add(id);
    const priority = r.priority === null || r.priority === '' || r.priority === undefined ? null : Number(r.priority);
    if (priority !== null && (!Number.isInteger(priority) || priority < 1 || priority > 999)) throw new Error('Prioriteit moet een heel getal zijn.');
    const status = txt(r.status, 50);
    if (!['Op schema', 'Actie nodig', 'Wacht op reactie', 'Afgerond'].includes(status)) throw new Error('Ongeldige status bij ' + name);
    const deadline = txt(r.deadline, 10);
    if (deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || !Number.isFinite(Date.parse(deadline)) || new Date(deadline).toISOString().slice(0,10) !== deadline)) throw new Error('Ongeldige deadline bij ' + name);
    const sourceWeek = r.sourceWeek == null ? null : Number(r.sourceWeek);
    if (sourceWeek !== null && (!Number.isInteger(sourceWeek) || sourceWeek < 1 || sourceWeek > 53)) throw new Error('Ongeldige week.');
    return { id, name, priority, status, channel: txt(r.channel,100), lastAction:txt(r.lastAction), nextAction:txt(r.nextAction), deadline, deadlineType:txt(r.deadlineType,200), risk:txt(r.risk), sourceWeek, changeReason:txt(r.changeReason,2000) };
  });
}
export function comparison(current, previous) {
  if (!previous || current.priority == null || previous.priority == null) return { kind:'unknown', label:'Geen eerdere prioriteit' };
  const delta = previous.priority - current.priority;
  return {kind:delta > 0 ? 'up' : delta < 0 ? 'down' : 'same', delta, from:previous.priority, to:current.priority, label:delta > 0 ? `Van ${previous.priority} naar ${current.priority} · hogere prioriteit` : delta < 0 ? `Van ${previous.priority} naar ${current.priority} · lagere prioriteit` : 'Prioriteit gelijk'};
}
export function makeView(snapshots, selectedId, compareId) {
  const selected = snapshots.find(s => s.id === selectedId) || snapshots.at(-1);
  if (!selected) return {snapshots:[],clients:[],selected:null,comparison:null};
  const at = snapshots.indexOf(selected);
  const earlier = snapshots.slice(0,at);
  const previous = earlier.find(s => s.id === compareId) || earlier.at(-1);
  const clients = selected.clients.map(c => {
    const history = earlier.slice().reverse().flatMap(s => {
      const old = s.clients.find(x=>x.id === c.id);
      return old ? [{...old, snapshotId:s.id, label:s.label, capturedAt:s.capturedAt, kind:s.kind, reportWeek:s.reportWeek}] : [];
    }).filter((row,i,all) => row.kind !== 'legacy' || !all.slice(0,i).some(other => other.kind === 'legacy' && other.sourceWeek === row.sourceWeek));
    return {...c, change:comparison(c,previous?.clients.find(x=>x.id===c.id)), history};
  }).sort((a,b)=>(a.priority??9999)-(b.priority??9999)||a.name.localeCompare(b.name,'nl'));
  const brief=s=>s?({id:s.id,label:s.label,capturedAt:s.capturedAt,kind:s.kind,reportWeek:s.reportWeek}):null;
  const timeline=snapshots.slice(0,at+1).filter(s=>s.clients.some(c=>c.priority!==null)).slice(-6);
  const priorityHistory={
    periods:timeline.map(brief),
    rows:clients.map(c=>{
      const positions=timeline.map(s=>s.clients.find(x=>x.id===c.id)?.priority??null);
      const known=positions.filter(v=>v!==null);
      const movement=known.length>1?known.at(-2)-known.at(-1):null;
      return {id:c.id,name:c.name,positions,movement};
    })
  };
  return {snapshots:snapshots.map(brief).reverse(), selected:brief(selected), comparison:brief(previous), priorityHistory, clients};
}
