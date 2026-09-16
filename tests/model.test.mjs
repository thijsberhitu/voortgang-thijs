import test from 'node:test';
import assert from 'node:assert/strict';
import {comparison,makeView,validateClients} from '../model.mjs';
const c=(priority,status='Actie nodig')=>({id:'voorbeeld',name:'Voorbeeld',priority,status,sourceWeek:38});
test('Een lager rangnummer is hogere prioriteit; onbekend is nooit gelijk',()=>{
  assert.equal(comparison(c(1),c(4)).kind,'up');
  assert.equal(comparison(c(5),c(2)).kind,'down');
  assert.equal(comparison(c(1),c(null)).kind,'unknown');
  assert.equal(comparison(c(2),c(2)).kind,'same');
});
test('Momenten blijven onveranderd; historische vergelijking bevat geen toekomstige update',()=>{
  const snapshots=[{id:'old',clients:[c(null)],kind:'legacy'},{id:'tue',clients:[c(4)],kind:'published'},{id:'thu',clients:[c(1)],kind:'published'}];
  const prior=JSON.stringify(snapshots);
  assert.equal(makeView(snapshots,'thu','tue').clients[0].change.delta,3);
  assert.equal(makeView(snapshots,'tue','thu').comparison.id,'old');
  assert.equal(makeView(snapshots,'thu').clients[0].history[0].snapshotId,'tue');
  assert.equal(JSON.stringify(snapshots),prior);
});
test('Ongeldige deadlines, dubbele klanten en ongeldige prioriteiten worden geweigerd',()=>{
  assert.throws(()=>validateClients([c(1.5)]));
  assert.throws(()=>validateClients([c(1),c(2)]));
  assert.throws(()=>validateClients([{...c(1),deadline:'2026-02-30'}]));
  assert.equal(validateClients([c(null)])[0].priority,null);
});
