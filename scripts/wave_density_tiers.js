// 2단 규칙: 작은 이벤트(2~3칸)는 딱 붙어 있어야, 큰 이벤트(4칸+)는 느슨하게.
// 실측 근거 — 손 2칸=밀도 1.0 / 잡음 2칸=밀도 0.33 / 손 5~8칸=밀도 0.33~0.42
const N=16,DELTA=30,LAG=180,FPS=30, FMAX=0.30, D_SMALL=0.9, D_BIG=0.30, SMALL_MAX=3;
function ok(ch,frac,con,dens){
  if(frac<0.0078||frac>FMAX||con<0.8) return false;
  return ch<=SMALL_MAX ? dens>=D_SMALL : dens>=D_BIG;
}
function scan(name,gen,frames=1800){
  const hist=[]; let pass=0,worst=null;
  for(let f=0;f<frames;f++){
    const t=f*(1000/FPS), g=gen(f,t);
    hist.push([t,g]); while(hist.length&&t-hist[0][0]>700)hist.shift();
    const rf=[...hist].reverse().find(x=>t-x[0]>=LAG); if(!rf)continue;
    let ch=0,dk=0,mnx=99,mxx=-1,mny=99,mxy=-1;
    for(let i=0;i<g.length;i++){const d=g[i]-rf[1][i];
      if(Math.abs(d)>=DELTA){ch++; if(d<0)dk++; const gy=(i/N)|0,gx=i%N;
        if(gx<mnx)mnx=gx; if(gx>mxx)mxx=gx; if(gy<mny)mny=gy; if(gy>mxy)mxy=gy;}}
    if(ch<2)continue;
    const frac=ch/g.length,con=Math.max(dk/ch,1-dk/ch),dens=ch/((mxx-mnx+1)*(mxy-mny+1));
    if(ok(ch,frac,con,dens)){pass++; if(!worst)worst={ch,frac,con,dens};}
  }
  console.log(`  ${name.padEnd(22)} 오발화 ${String(pass).padStart(3)}회${worst?`  (칸=${worst.ch} 밀도=${worst.dens.toFixed(2)})`:""}`);
  return pass;
}
const noise=(b,a)=>new Array(N*N).fill(0).map(()=>Math.round(b+(Math.random()*2-1)*a));
console.log("=== 오탐 (각 60초) ===");
let t=0;
t+=scan("정지(밝음 ±18)",()=>noise(215,18));
t+=scan("심한 노이즈(±25)",()=>noise(120,25));
t+=scan("자동노출(±20)",(f)=>noise(120+20*Math.sin(f/3),8));
t+=scan("자동노출 심함(±35)",(f)=>noise(130+35*Math.sin(f/4),8));
t+=scan("조명 스위치",(f)=>noise(f%600<300?180:60,6));
t+=scan("주행 중 창밖",(f)=>{const g=noise(140,6);
  for(let i=0;i<N*N;i++){const gx=i%N;g[i]=Math.round(g[i]+25*Math.sin((gx+f*0.8)/2));}return g;});
console.log(`  → 합계 ${t}회 (6분)\n`);
console.log("=== 실기기 실측값 판정 ===");
const real=[
  ["손 2칸(성공해야)",2,2/256,1.0,1.0],
  ["손 5칸 밀도0.63(성공)",5,5/256,1.0,0.625],
  ["손 5칸 밀도0.83(성공)",5,5/256,1.0,0.833],
  ["손 5칸 밀도0.56(성공)",5,5/256,0.8,0.556],
  ["손 10칸 밀도0.63(성공)",10,10/256,1.0,0.625],
  ["손 5칸 밀도0.33(실패했던)",5,5/256,1.0,0.333],
  ["손 6칸 밀도0.40(실패했던)",6,6/256,1.0,0.40],
  ["손 7칸 밀도0.35(실패했던)",7,7/256,0.857,0.35],
  ["손 8칸 밀도0.33(실패했던)",8,8/256,0.875,0.333],
  ["잡음 2칸 밀도0.33(막아야)",2,2/256,1.0,0.333],
  ["잡음 2칸 밀도0.5(막아야)",2,2/256,1.0,0.5],
];
for(const [n,ch,fr,co,de] of real) console.log(`  ${ok(ch,fr,co,de)?"발화 ":"차단 "} ${n}`);
