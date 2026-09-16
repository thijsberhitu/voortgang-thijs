/** Voeg dit als een NIEUW scriptbestand toe in het Apps Script-project van je Sheet.
 * Heeft je project al een onOpen? Roep voortgangMenu() daarin aan.
 * Anders kun je zelf toevoegen: function onOpen() { voortgangMenu(); }
 * Stel Script Properties DASHBOARD_URL en SYNC_TOKEN in (Projectinstellingen).
 */
function voortgangMenu() {
  SpreadsheetApp.getUi().createMenu('Voortgang dashboard')
    .addItem('Invoer eenmalig klaarzetten','voortgangInvoerMaken')
    .addItem('Update vastleggen en publiceren','voortgangPubliceren')
    .addToUi();
}

function voortgangInvoerMaken() {
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  if(ss.getSheetByName('Dashboard invoer'))throw new Error('Dashboard invoer bestaat al. Bestaande invoer is niet overschreven.');
  const source=ss.getSheetByName('Klantoverzicht');
  if(!source)throw new Error('Tabblad Klantoverzicht ontbreekt.');
  const rows=source.getDataRange().getValues(), names=new Map();
  let client=null;
  rows.slice(1).forEach(r=>{
    const week=Number(r[1]);
    if(!Number.isInteger(week)||week<1||week>53)return;
    if(String(r[0]||'').trim()) {
      client={name:String(r[0]).trim(),priority:r[5]||'',channel:String(r[3]||'').trim(),latest:null,week:0,previous:{}};
      names.set(client.name,client);
    }
    if(!client)return;
    function resolveValue(value,key) {const s=String(value??'').trim();return ['"','“','”'].includes(s)?(client.previous[key]||''):value;}
    const item={last:resolveValue(r[7],'last'),next:resolveValue(r[8],'next'),deadline:resolveValue(r[9],'deadline'),type:resolveValue(r[10],'type'),risk:resolveValue(r[11],'risk')};
    client.previous=item;
    if(week>=client.week){client.week=week;client.latest=[client.name,client.priority,client.channel,String(r[4]||'').trim()||'Op schema',item.last,item.next,item.deadline,item.type,item.risk,'',week];}
  });
  const records=[...names.values()].filter(c=>c.latest).sort((a,b)=>(Number(a.priority)||999)-(Number(b.priority)||999)).map(c=>c.latest);
  if(!records.length)throw new Error('Geen klantregels gevonden.');
  const sheet=ss.insertSheet('Dashboard invoer');
  const header=['Klant','Prioriteit','Kanaal','Status','Laatste actie','Openstaande actie','Deadline','Deadline intern of extern','Aandachtspunt','Toelichting prioriteitswijziging','Week laatste klantupdate'];
  sheet.getRange(1,1,1,header.length).setValues([header]).setFontWeight('bold').setBackground('#12584b').setFontColor('#ffffff');
  sheet.getRange(2,1,records.length,header.length).setValues(records).setWrap(true).setVerticalAlignment('top');
  sheet.setFrozenRows(1);sheet.setColumnWidths(1,4,160);sheet.setColumnWidths(5,2,300);sheet.setColumnWidth(10,300);sheet.setColumnWidths(7,3,180);sheet.setColumnWidth(11,170);sheet.setRowHeights(2,records.length,90);
  sheet.getRange(2,7,records.length,1).setNumberFormat('dd-mm-yyyy');
  sheet.getRange(2,2,1000,1).setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(1,999).setAllowInvalid(false).build());
  sheet.getRange(2,4,1000,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Op schema','Actie nodig','Wacht op reactie','Afgerond'],true).setAllowInvalid(false).build());
  sheet.getRange(1,1,records.length+1,header.length).createFilter();
  ss.setActiveSheet(sheet);
  SpreadsheetApp.getUi().alert('Invoer klaar. Werk voortaan dit tabblad bij. Publiceer daarna via Voortgang dashboard. De bestaande tabbladen zijn niet gewijzigd.');
}

function voortgangPubliceren() {
  const lock=LockService.getDocumentLock();
  if(!lock.tryLock(1000))throw new Error('Een andere update wordt al gepubliceerd.');
  try {
    const props=PropertiesService.getScriptProperties();
    const url=(props.getProperty('DASHBOARD_URL')||'').replace(/\/$/,'');
    const token=props.getProperty('SYNC_TOKEN')||'';
    if(!/^https:\/\/[a-zA-Z0-9.-]+$/.test(url)||token.length<32)throw new Error('Stel eerst DASHBOARD_URL en SYNC_TOKEN in bij Script Properties.');
    const ss=SpreadsheetApp.getActiveSpreadsheet(),sheet=ss.getSheetByName('Dashboard invoer');
    if(!sheet)throw new Error('Zet eerst de invoer klaar via het menu.');
    if(sheet.getLastRow()<2)throw new Error('Er zijn geen klanten ingevuld.');
    const clients=sheet.getRange(2,1,sheet.getLastRow()-1,11).getValues().filter(r=>String(r[0]||'').trim()).map(r=>{
      if(r[6]&&!(r[6] instanceof Date))throw new Error('Vul een geldige datum in bij '+r[0]);
      return {name:String(r[0]).trim(),priority:r[1]===''?null:Number(r[1]),channel:String(r[2]||'').trim(),status:String(r[3]||'').trim(),lastAction:String(r[4]||''),nextAction:String(r[5]||''),deadline:r[6]?Utilities.formatDate(r[6],ss.getSpreadsheetTimeZone(),'yyyy-MM-dd'):'',deadlineType:String(r[7]||''),risk:String(r[8]||''),changeReason:String(r[9]||''),sourceWeek:r[10]===''?null:Number(r[10])};
    });
    const digest=Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(clients)));
    // Retrying a failed request reuses its ID. A second deliberate publish is a new report moment.
    let pending;try{pending=JSON.parse(props.getProperty('VOORTGANG_PENDING')||'null');}catch(e){pending=null;}
    const requestId=pending&&pending.digest===digest?pending.requestId:Utilities.getUuid();
    props.setProperty('VOORTGANG_PENDING',JSON.stringify({requestId:requestId,digest:digest}));
    const response=UrlFetchApp.fetch(url+'/api/snapshots',{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+token},payload:JSON.stringify({requestId:requestId,clients:clients}),muteHttpExceptions:true,followRedirects:false});
    let result;try{result=JSON.parse(response.getContentText());}catch(e){throw new Error('Dashboard geeft geen geldig antwoord. Je invoer is behouden.');}
    if(response.getResponseCode()<200||response.getResponseCode()>=300)throw new Error(result.error||'Publiceren mislukt. Je invoer is behouden.');
    props.deleteProperty('VOORTGANG_PENDING');
    SpreadsheetApp.getUi().alert('Update opgeslagen: '+result.snapshot+'\nJe collega’s zien de update via de bestaande dashboardlink.');
  } finally {lock.releaseLock();}
}
