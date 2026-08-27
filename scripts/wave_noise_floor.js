// 2칸 이벤트에서 잡음이 "일관성 1.0 + 밀도 1.0"을 얼마나 자주 만드는가.
// 실기기 손: 2칸 / 일관성 1.0 / 밀도 1.0 → 문턱을 2칸으로 내려도 되는지 판단.
const N=16, DELTA=30, LAG=180, FPS=30;
function count(name, gen, frames=1800){ // 60초
  const hist=[]; let evt=0, pass=0;
  for(let f=0;f<frames;f++){
    const t=f*(1000/FPS), g=gen(f,t);
    hist.push([t,g]); while(hist.length&&t-hist[0][0]>700)hist.shift();
    const rf=[...hist].reverse().find(x=>t-x[0]>=LAG); if(!rf)continue;
    let ch=0,dk=0,mnx=99,mxx=-1,mny=99,mxy=-1;
    for(let i=0;i<g.length;i++){const d=g[i]-rf[1][i];
      if(Math.abs(d)>=DELTA){ch++; if(d<0)dk++; const gy=(i/N)|0,gx=i%N;
        if(gx<mnx)mnx=gx; if(gx>mxx)mxx=gx; if(gy<mny)mny=gy; if(gy>mxy)mxy=gy;}}
    if(ch<2||ch>128)continue;
    evt++;
    const con=Math.max(dk/ch,1-dk/ch), dens=ch/((mxx-mnx+1)*(mxy-mny+1));
    if(con>=0.8&&dens>=0.55) pass++;
  }
  const secs=frames/FPS;
  console.log(`${name.padEnd(26)} 2칸이상 이벤트=${String(evt).padStart(4)}  발화조건 통과=${String(pass).padStart(4)}  → 분당 ${(pass/(secs/60)).toFixed(1)}회 오발화`);
}
const noise=(b,a)=>new Array(N*N).fill(0).map(()=>Math.round(b+(Math.random()*2-1)*a));
count("정지(어두움 ±10)", ()=>noise(35,10));
count("정지(보통 ±12)",  ()=>noise(120,12));
count("정지(밝음 ±18)",  ()=>noise(215,18));
count("정지(심한 노이즈 ±25)", ()=>noise(120,25));
count("자동노출 흔들림(±20)", (f)=>noise(120+20*Math.sin(f/3),8));
count("주행 중 창밖 흐름", (f)=>{const g=noise(140,6);
  for(let i=0;i<N*N;i++){const gx=i%N; g[i]=Math.round(g[i]+25*Math.sin((gx+f*0.8)/2));}return g;});
