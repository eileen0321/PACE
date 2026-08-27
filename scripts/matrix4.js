// PaceHandWaveDetector의 세 밝기 축을 상수까지 미러링. 손을 **부분 덮힘 + 화각 침투 깊이**로 모델링해
// 실측(격자 4~28/256칸, 밴드 3% 변화)과 같은 규모가 나오게 한다.
const C={GRID:16,DELTA:30,FRAC:0.012,FRAC_MAX:0.5,DENS:0.4,CONSIST:0.8,LAG:180,GM_WIN:700,
  LP_WIN:1200,LP_DIP:0.97,LP_MINREF:40,LP_MINS:6,LP_MINSPAN:80,LP_MAXSPAN:900,LP_BASE:0.97,
  LUMA_WIN:400,LUMA_DROP:0.85,LUMA_RECOVER:0.9,REFRACT:1200,FPS:30};
function Det(){return{grid:[],dip:[[],[]],ref:[[0,0,0],[0,0,0]],luma:[],last:-1e5,fires:[],stat:{}};}
function bands(g,axis){const s=[0,0,0],n=[0,0,0];
  for(let i=0;i<g.length;i++){const gy=(i/C.GRID)|0,gx=i%C.GRID;
    let b=(((axis===0?gy:gx)*3)/C.GRID)|0; if(b>2)b=2; s[b]+=g[i]; n[b]++;}
  return s.map((v,i)=>n[i]?v/n[i]:0);}
function feed(d,t,grid){
  d.grid.push([t,grid]); while(d.grid.length&&t-d.grid[0][0]>C.GM_WIN)d.grid.shift();
  let fired=null;
  const rf=[...d.grid].reverse().find(x=>t-x[0]>=C.LAG);
  if(rf){let ch=0,dk=0,mnx=99,mxx=-1,mny=99,mxy=-1;
    for(let i=0;i<grid.length;i++){const dv=grid[i]-rf[1][i]; if(Math.abs(dv)>=C.DELTA){ch++; if(dv<0)dk++; const gy=(i/C.GRID)|0,gx=i%C.GRID; if(gx<mnx)mnx=gx; if(gx>mxx)mxx=gx; if(gy<mny)mny=gy; if(gy>mxy)mxy=gy;}}
    if(ch>0){const frac=ch/grid.length,dr=dk/ch,con=Math.max(dr,1-dr); const dens=ch/((mxx-mnx+1)*(mxy-mny+1));
      d.stat.gm={ch,frac,con};
      if(frac>=C.FRAC&&frac<=C.FRAC_MAX&&con>=C.CONSIST&&dens>=C.DENS&&t-d.last>C.REFRACT)fired="격자";}}
  for(let ax=0;ax<2&&!fired;ax++){
    const b=bands(grid,ax),h=d.dip[ax],r=d.ref[ax];
    h.push([t,b[0],b[1],b[2]]); while(h.length&&t-h[0][0]>C.LP_WIN)h.shift();
    for(let i=0;i<3;i++)r[i]=r[i]<=0?b[i]:r[i]*C.LP_BASE+b[i]*(1-C.LP_BASE);
    if(h.length<C.LP_MINS)continue; if(t-d.last<=C.REFRACT)continue;
    const on=(idx)=>{const base=r[idx-1]; if(base<=C.LP_MINREF)return null;
      const need=base*(1-C.LP_DIP); const hit=h.find(x=>Math.abs(x[idx]-base)>=need);
      return hit?[hit[0],hit[idx]<base?-1:1]:null;};
    const a=on(1),m=on(2),c=on(3); if(!a||!m||!c)continue;
    if(a[1]!==m[1]||m[1]!==c[1])continue;
    const f=c[0]<m[0]&&m[0]<a[0], w=a[0]<m[0]&&m[0]<c[0]; if(!f&&!w)continue;
    const sp=f?a[0]-c[0]:c[0]-a[0]; if(sp<C.LP_MINSPAN||sp>C.LP_MAXSPAN)continue;
    fired="lumapass"+(ax===0?"(행)":"(열)");}
  if(!fired){const avg=grid.reduce((x,y)=>x+y,0)/grid.length;
    d.luma.push([t,avg]); while(d.luma.length&&t-d.luma[0][0]>C.LUMA_WIN)d.luma.shift();
    const br=Math.max(...d.luma.map(x=>x[1]));
    if(br>0&&t-d.last>C.REFRACT){
      const ex=d.luma.reduce((p,q)=>Math.abs(q[1]-br)>Math.abs(p[1]-br)?q:p)[1];
      const dev=Math.abs(ex-br)/br, rec=Math.abs(avg-br)<=br*(1-C.LUMA_RECOVER);
      if(dev>=(1-C.LUMA_DROP)&&rec)fired="렌즈가림";}}
  if(fired){d.last=t;d.fires.push([t,fired]);d.grid.length=0;d.dip[0].length=0;d.dip[1].length=0;d.luma.length=0;}
  return fired;}
// 손: 이동축 두께 cover, 침투축 깊이 reach(가장자리부터), 셀은 덮인 면적 비율로 혼합
function pass(d,t0,o){
  const N=C.GRID,fr=Math.max(3,Math.round(o.durMs/(1000/C.FPS)));let t=t0;
  for(let f=0;f<fr;f++){const g=new Array(N*N);const pos=(f/(fr-1))*(N-1);
    for(let i=0;i<N*N;i++){const gy=(i/N)|0,gx=i%N;
      const al=(o.axis===0?gy:gx), pe=(o.axis===0?gx:gy);
      const ca=Math.max(0,Math.min(1,(o.cover/2+0.5)-Math.abs(al-pos)));
      const cp=Math.max(0,Math.min(1,o.reach-pe));
      const cov=ca*cp;
      g[i]=Math.round(o.bg*(1-cov)+o.hand*cov+(Math.random()*2-1)*(o.noise||2));}
    feed(d,t,g);t+=1000/C.FPS;}
  for(let f=0;f<10;f++){const g=new Array(N*N).fill(0).map(()=>Math.round(o.bg+(Math.random()*2-1)*(o.noise||2)));feed(d,t,g);t+=1000/C.FPS;}
  return t;}
function warm(d,t0,bg,n=25){let t=t0;
  for(let f=0;f<n;f++){const g=new Array(C.GRID*C.GRID).fill(0).map(()=>Math.round(bg+(Math.random()*2-1)*2));feed(d,t,g);t+=1000/C.FPS;}return t;}
const LIGHT=[["어두움",35,110],["보통",120,190],["밝음",215,95]];
const REACH=[["깊이",12],["절반",6],["가장자리",2.5]];
const COVER=[["두꺼움",6],["보통",3],["얇음",1.5]];
const AXIS=[["수직",0],["수평",1]];
const SPEED=[["빠름",150],["보통",300]];
console.log("조명   손높이    두께     거치 속도  성공/10  발화축");
const fails=[];
for(const [ln,bg,hand] of LIGHT) for(const [rn,reach] of REACH) for(const [cn,cover] of COVER)
for(const [an,axis] of AXIS) for(const [sn,dur] of SPEED){
  let ok=0;const by={};let lastStat=null;
  for(let k=0;k<10;k++){const d=Det();let t=warm(d,0,bg);const b0=d.fires.length;
    t=pass(d,t,{bg,hand,cover,reach,axis,durMs:dur});
    lastStat=d.stat.gm;
    const got=d.fires.slice(b0); if(got.length){ok++;by[got[0][1]]=(by[got[0][1]]||0)+1;}}
  const tag=Object.keys(by).length?Object.entries(by).map(([k,v])=>k+"×"+v).join(","):"—";
  console.log(`${ln.padEnd(5)} ${rn.padEnd(8)} ${cn.padEnd(7)} ${an.padEnd(4)} ${sn.padEnd(4)} ${String(ok).padStart(2)}/10  ${tag}`);
  if(ok<8)fails.push({ln,rn,cn,an,sn,ok,stat:lastStat});}
console.log("\n=== 8/10 미만 조건 ===");
if(!fails.length)console.log("없음");
else fails.forEach(f=>console.log(`  ${f.ln} / 손높이 ${f.rn} / 두께 ${f.cn} / ${f.an} / ${f.sn} → ${f.ok}/10  (마지막 격자: ${f.stat?("칸="+f.stat.ch+" 비율="+f.stat.frac.toFixed(3)+" 일관성="+f.stat.con.toFixed(2)):"없음"})`));
