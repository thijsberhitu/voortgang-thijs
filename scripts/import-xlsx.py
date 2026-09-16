"""Read-only extraction of the supplied XLSX; writes a separate private JSON import.
Uses the cached displayed cell values. Never edits the original workbook.
"""
import sys, json, re, zipfile, pathlib, copy
from xml.etree import ElementTree as ET
from datetime import datetime, timedelta

source=pathlib.Path(sys.argv[1]); target=pathlib.Path(sys.argv[2])
ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(source) as z:
    strings=[]
    if 'xl/sharedStrings.xml' in z.namelist():
        strings=[''.join(x.itertext()) for x in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',ns)]
    rows=[]
    for row in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('m:sheetData/m:row',ns):
        vals={}
        for c in row.findall('m:c',ns):
            col=re.sub(r'\d','',c.attrib['r']); t=c.attrib.get('t'); v=c.find('m:v',ns)
            value=v.text if v is not None and v.text else ''
            if t=='s': value=strings[int(value)] if value else ''
            elif t=='inlineStr': value=''.join(c.find('m:is',ns).itertext())
            vals[col]=value.strip()
        rows.append(vals)
clients={}; current=None
fields={'H':'lastAction','I':'nextAction','J':'deadline','K':'deadlineType','L':'risk'}
for row in rows[1:]:
    try: week=int(float(row.get('B','')))
    except ValueError: continue
    if not 1<=week<=53: continue
    if row.get('A'):
        current=row['A']
        clients.setdefault(current,{'name':current,'channel':row.get('D',''),'priority':int(float(row['F'])) if row.get('F') else None,'rows':[]})
    if not current: continue
    client=clients[current]; prev=client['rows'][-1] if client['rows'] else {}
    record={'name':current,'channel':client['channel'],'priority':None,'status':row.get('E','').strip() or 'Op schema','sourceWeek':week,'changeReason':''}
    for col,key in fields.items():
        value=row.get(col,'').strip()
        if value in ['"','“','”']: value=prev.get(key,'')
        if key=='deadline' and value:
            try: value=(datetime(1899,12,30)+timedelta(days=float(value))).date().isoformat()
            except ValueError:
                if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',value): value=''
        record[key]=value
    client['rows'].append(record)
weeks=sorted({r['sourceWeek'] for c in clients.values() for r in c['rows']})
snapshots=[]
for week in weeks:
    records=[]
    for c in clients.values():
        available=[r for r in c['rows'] if r['sourceWeek']<=week]
        if available: records.append(copy.deepcopy(max(available,key=lambda r:r['sourceWeek'])))
    snapshots.append({'id':f'legacy-week-{week}','label':f'Week {week} · bestandsarchief','kind':'legacy','capturedAt':None,'reportWeek':week,'clients':records})
baseline=[]
for c in clients.values():
    r=copy.deepcopy(max(c['rows'],key=lambda r:r['sourceWeek']));r['priority']=c['priority'];baseline.append(r)
snapshots.append({'id':'imported-start','label':f'Startstand · week {max(weeks)}','kind':'baseline','capturedAt':None,'reportWeek':max(weeks),'clients':baseline})
target.parent.mkdir(parents=True,exist_ok=True)
target.write_text(json.dumps({'source':'Aangeleverd Excelbestand, geen live koppeling','snapshots':snapshots},ensure_ascii=False,indent=2))
print(json.dumps({'clients':len(clients),'weeks':weeks,'historical_rows':sum(len(c['rows']) for c in clients.values()),'snapshots':len(snapshots),'output':str(target)}))
