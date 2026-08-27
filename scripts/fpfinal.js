const N=16,DELTA=30,LAG=180,FPS=30, FRAC=0.012, FRAC_MAX=0.5, CON=0.8, DENS=0.4;
function scan(name,gen,frames=120){
  const hist=[]; let fires=0, worst=null;
  for(let f=0;f<frames;f++){
    const t=f*(1000/FPS), g=gen(f,t);
    hist.push([t,g]); while(hist.length&&t-hist[0][0]>700)hist.shift();
    const rf=[...hist].reverse().find(x=>t-x[0]>=LAG); if(!rf)continue;
    let ch=0,dk=0,mnx=99,mxx=-1,mny=99,mxy=-1;
    for(let i=0;i<g.length;i++){const d=g[i]-rf[1][i];
      if(Math.abs(d)>=DELTA){ch++; if(d<0)dk++; const gy=(i/N)|0,gx=i%N;
        if(gx<mnx)mnx=gx; if(gx>mxx)mxx=gx; if(gy<mny)mny=gy; if(gy>mxy)mxy=gy;}}
    if(ch===0)continue;
    const frac=ch/g.length, con=Math.max(dk/ch,1-dk/ch), dens=ch/((mxx-mnx+1)*(mxy-mny+1));
    if(frac>=FRAC&&frac<=FRAC_MAX&&con>=CON&&dens>=DENS){fires++; if(!worst)worst={ch,frac,con,dens};}
  }
  console.log(`${(fires?"발화 "+fires+"회":"무발화").padEnd(10)} ${name}${worst?`  (칸=${worst.ch} 비율=${worst.frac.toFixed(3)} 일관성=${worst.con.toFixed(2)} 밀도=${worst.dens.toFixed(2)})`:""}`);
}
const noise=(b,a=2)=>new Array(N*N).fill(0).map(()=>Math.round(b+(Math.random()*2-1)*a));
scan("정지(어두움, 노이즈 ±10)", ()=>noise(35,10));
scan("정지(밝음, 노이즈 ±15)", ()=>noise(215,15));
scan("서서히 어두워짐(4초)", (f)=>noise(120-(f/120)*70));
scan("조명 스위치 급변", (f)=>noise(f<60?180:60));
scan("화면 깜빡임(0.2초)", (f)=>noise(Math.floor(f/6)%2?180:120));
scan("자동노출 흔들림(±20)", (f)=>noise(120+20*Math.sin(f/3)));
scan("자동노출 흔들림(±35, 심함)", (f)=>noise(130+35*Math.sin(f/4)));
scan("멀리서 사람 지나감", (f)=>{const g=noise(120);const p=(f/120)*(N-1);
  for(let i=0;i<N*N;i++){const gy=(i/N)|0,gx=i%N; if(Math.abs(gx-p)<1&&gy>N-2)g[i]=Math.round(g[i]*0.75);}return g;});
scan("커튼 그림자(넓고 느리게)", (f)=>{const g=noise(120);const p=(f/120)*(N*2);
  for(let i=0;i<N*N;i++){if((i%N)<p-N)g[i]=Math.round(g[i]*0.8);}return g;});
scan("차창 밖 풍경 흐름(주행)", (f)=>{const g=noise(140,6);
  for(let i=0;i<N*N;i++){const gx=i%N; g[i]=Math.round(g[i]+25*Math.sin((gx+f*0.8)/2));}return g;});
