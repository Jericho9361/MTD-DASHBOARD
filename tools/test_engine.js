const E=require('../js/engine.js');const seed=require('./seed.json');const exp=require('./expected.json');
const s=JSON.parse(JSON.stringify(seed)); s.meta.runningDays=11;
const o=E.compute(s); const H=o.seas.head;
const got={};
for(const k of Object.keys(exp)){
  let v;
  if(k.startsWith('seas.')) v=H[k.slice(5)];
  else if(k.startsWith('ls41.')) v=o.ls.total[k.slice(5)];
  else if(k.startsWith('ls.AA')) v=o.ls.rows[+k.slice(5)].AA;
  else if(k.startsWith('seasN')) v=o.seas.rows[+k.slice(5)].N;
  else ({'dep.G40':()=>v=o.dep.G40,'sg.D37':()=>v=o.sg.total.D,'rd.I18':()=>v=o.ytdrd.total.I,'rd.J6':()=>v=o.ytdrd.months[0].J,'ytd.D18':()=>v=o.ytd.total.D,'ytd.AL3':()=>v=o.ytd.AL3,'ytd.S1':()=>v=o.ytd.S1,'wml.T12':()=>v=o.wml.total.T,'wml.K12':()=>v=o.wml.total.K})[k]();
  const e=exp[k]; const ok= typeof e==='number'? Math.abs(v-e)<1e-6*Math.max(1,Math.abs(e)) : String(v)===String(e);
  console.log(ok?'OK  ':'DIFF',k,e,v);
}
console.log('auto running days =',E.compute(seed).seas.head.J20);
