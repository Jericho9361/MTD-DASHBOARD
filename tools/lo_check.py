import zipfile,re,subprocess,sys,os,openpyxl,warnings
warnings.filterwarnings('ignore')
src=sys.argv[1]; d=os.path.dirname(os.path.abspath(src)); base=os.path.basename(src)
os.makedirs(d+'/strip',exist_ok=True); os.makedirs(d+'/lo',exist_ok=True)
zin=zipfile.ZipFile(src); zout=zipfile.ZipFile(d+'/strip/'+base,'w',zipfile.ZIP_DEFLATED)
for i in zin.infolist():
    x=zin.read(i.filename)
    if i.filename.startswith('xl/worksheets/sheet'):
        s=x.decode(); s=re.sub(r'(<f>[^<]*</f>)<v>[^<]*</v>',r'\1',s); s=re.sub(r'(<c [^>]*?) t="(str|e)"([^>]*><f>)',r'\1\3',s); x=s.encode()
    zout.writestr(i,x)
zout.close()
subprocess.run(['soffice','--headless','--calc','--convert-to','xlsx','--outdir',d+'/lo',d+'/strip/'+base],capture_output=True,timeout=180)
mine=openpyxl.load_workbook(src,data_only=True); lo=openpyxl.load_workbook(d+'/lo/'+base,data_only=True); f=openpyxl.load_workbook(src)
bad=n=0
for ws in f.worksheets:
    if ws.title=='Seasonality Template WML V': continue
    for row in ws.iter_rows():
        for c in row:
            if isinstance(c.value,str) and c.value.startswith('='):
                a=mine[ws.title][c.coordinate].value; b=lo[ws.title][c.coordinate].value; n+=1
                a2=0 if a in (None,'') else a; b2=0 if b in (None,'') else b
                if isinstance(a2,(int,float)) and isinstance(b2,(int,float)) and abs(a2-b2)<=1e-6*max(1,abs(b2)): continue
                if str(a2)==str(b2) or hasattr(b2,'year'): continue
                bad+=1
                if bad<=15: print(ws.title,c.coordinate,c.value[:50],'mine=',a,'LO=',b)
print('formula cells',n,'mismatches',bad)
st=mine['Seasonality Template']; print('MTD G16',st['G16'].value,'J20',st['J20'].value,'LS B18',f['LS_RPRO']['B18'].value)
