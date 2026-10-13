global.MTDEngine=require('../js/engine.js');
const X=require('../js/exporter.js'); const JSZip=require('jszip'); const {DOMParser,XMLSerializer}=require('@xmldom/xmldom');
const fs=require('fs'); const seed=JSON.parse(fs.readFileSync('./seed.json'));
const st=JSON.parse(JSON.stringify(seed)); if(process.argv[3]==='11') st.meta.runningDays=11;
const out=MTDEngine.compute(st);
X.build(fs.readFileSync('./MEG_MTD_source.xlsx'),st,out,{JSZip,DOMParser,XMLSerializer,outType:'nodebuffer'}).then(b=>{fs.writeFileSync(process.argv[2],b);console.log('written',b.length)});
