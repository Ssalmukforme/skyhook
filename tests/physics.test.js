import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer, step, GATES, formatTime, cleanRecords, COURSES, frameAt, locate } from '../src/physics.js';
import { MAPS } from '../src/maps.js';
// A steering driver: predict the track offset a moment ahead and hold only the hook that pulls away from the near wall.
function steeringRun(c,horizon=1.4,threshold=.35){
  const p=createPlayer(c);let airborne=0,walls=0;
  for(let i=0;i<120*180&&!p.done;i++){
    if(p.releaseReady&&airborne<=0)airborne=.5;
    const held=airborne<=0;airborne-=1/120;
    const ahead=locate(c,p.x+p.vx*horizon,p.z+p.vz*horizon,p.trackIndex).lateral,limit=c.halfWidth*threshold;
    if(step(p,{leftHook:held&&ahead>-limit,rightHook:held&&ahead<limit,forward:true},1/120)==='recover'&&p.recoverReason==='wall')walls++;
  }
  return {p,walls};
}
test('every map can be finished by steering with the hooks alone, and new maps are not straight lines',()=>{
  const recordKeys=new Set();
  for(const map of MAPS){
    const c=COURSES[map.id];recordKeys.add(map.recordKey);
    const {p,walls}=steeringRun(c);
    assert.equal(p.done,true,`${map.id}: not finished (gate ${p.gate}, wall crashes ${walls})`);assert.equal(p.gate,c.gates.length,map.id);
    let turn=0;for(let s=0;s<c.length;s+=20){const a=frameAt(c,s),b=frameAt(c,s+20);turn+=Math.abs(Math.atan2(Math.sin(a.heading-b.heading),Math.cos(a.heading-b.heading)));}
    if(map.id!=='sunset')assert.ok(turn>Math.PI/2,`${map.id} should bend (total turn ${turn.toFixed(2)} rad)`);
  }
  assert.equal(recordKeys.size,MAPS.length,'each map keeps its own leaderboard');
});
test('track projection round-trips along a curved course',()=>{
  const c=COURSES.aurora;
  for(const s of [0,300,640,1000]){const f=frameAt(c,s),loc=locate(c,f.x+f.rx*10,f.z+f.rz*10,Math.round((s+c.pre)/2));assert.ok(Math.abs(loc.s-s)<.5);assert.ok(Math.abs(loc.lateral-10)<.5);}
});
test('touching a wall is a crash: no sliding, back to the last checkpoint with the same penalty as a missed gate',()=>{
  for(const map of MAPS){
    const c=COURSES[map.id],p=createPlayer(c),gate=c.gates[1],f=frameAt(c,gate.s+30);
    Object.assign(p,{gate:2,time:10,x:f.x+f.rx*(c.halfWidth+.5),z:f.z+f.rz*(c.halfWidth+.5),y:f.y+50,vx:f.tx*40,vy:0,vz:f.tz*40,trackIndex:Math.round((gate.s+30+c.pre)/2)});
    assert.equal(step(p,{},1/120),'recover',map.id);
    assert.equal(p.recoverReason,'wall');assert.equal(p.gate,2);assert.equal(p.falls,1);assert.ok(p.time>=13);
    assert.ok(Math.abs(p.s-(gate.s+8))<.5&&Math.abs(p.lateral-gate.lateral)<.5,`${map.id} respawns just past checkpoint 02`);
  }
  // A missed gate recovers the same way, only the reason differs.
  const p=createPlayer();Object.assign(p,{gate:0,z:-210,y:50});assert.equal(step(p,{},1/120),'recover');assert.equal(p.recoverReason,'missed');
});
test('nothing steers the runner along the course: no hooks and W keep a straight line into a bend',()=>{
  const c=COURSES.canyon,p=createPlayer(c),start=Math.atan2(p.vx,p.vz);
  let result=null;
  for(let i=0;i<120*12&&!result;i++){
    const before=Math.atan2(p.vx,p.vz);result=step(p,{forward:true},1/120);
    if(!result)assert.ok(Math.abs(Math.atan2(Math.sin(before-start),Math.cos(before-start)))<1e-9,'heading never bends toward the track');
  }
  assert.equal(result,'recover','an unhooked straight line leaves the course');
  // W pushes along the runner's own direction, even when that points away from the course line.
  const q=createPlayer(c);Object.assign(q,{vx:12,vz:-12,vy:0});const dir=Math.atan2(q.vx,q.vz);step(q,{forward:true},1/120);
  assert.ok(Math.abs(Math.atan2(q.vx,q.vz)-dir)<1e-9);
});
test('hooks aim from the runner\'s own direction, not from the course line',()=>{
  // Flying backwards down Sunset Avenue (+z): "ahead" is +z and the right hand points at the -x buildings.
  const p=createPlayer();Object.assign(p,{gate:3,z:-500,vx:0,vz:30,vy:0,trackIndex:Math.round((500+80)/2)});
  step(p,{rightHook:true},1/120);
  assert.ok(p.hooks.right,'a hook connects');assert.ok(p.hooks.right.anchor.z>p.z,'anchor is ahead of the runner');assert.ok(p.hooks.right.anchor.x<0,'right hand of a +z runner is the -x side');
});
test('dual hooks and timed releases complete all seven gates with big vertical swings',()=>{
  const p=createPlayer();let airborne=0,releases=0,minY=p.y,maxY=p.y;
  for(let i=0;i<120*90&&!p.done;i++){
    if(p.releaseReady&&airborne<=0){airborne=.5;releases++;}
    const held=airborne<=0;airborne-=1/120;
    step(p,{leftHook:held,rightHook:held,forward:true},1/120);
    minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);
  }
  assert.equal(p.done,true,JSON.stringify(p));assert.equal(p.gate,7);
  assert.ok(releases>=5);assert.ok(maxY-minY>30,'swings must have a substantial vertical arc');
});
test('holding keeps a fixed pivot and produces a descending then rising arc',()=>{
  const p=createPlayer();step(p,{leftHook:true,rightHook:true},1/120);const pivot=p.hooks.right.anchor;let lowest=p.y,descended=false,rose=false;
  for(let i=0;i<420;i++){
    step(p,{leftHook:true,rightHook:true},1/120);assert.equal(p.hooks.right.anchor,pivot);assert.equal(p.falls,0);
    lowest=Math.min(lowest,p.y);if(p.vy< -10)descended=true;if(descended&&p.vy>10&&p.y-lowest>10)rose=true;
  }
  assert.ok(descended&&rose);assert.ok(lowest<30);
});test('release preserves momentum instead of adding a scripted launch',()=>{
  const p=createPlayer();for(let i=0;i<600&&!p.releaseReady;i++)step(p,{leftHook:true,rightHook:true,forward:true},1/120);
  assert.ok(p.releaseReady);const v=[p.vx,p.vy,p.vz];
  step(p,{},1/120);assert.equal(p.anchor,null);assert.equal(p.released,true);
  assert.ok(Math.hypot(p.vx-v[0],p.vy-v[1],p.vz-v[2])<1);
  assert.ok(p.vy>0&&p.vz<0);
});
test('a fall recovers to the most recent checkpoint and adds a penalty',()=>{const p=createPlayer();Object.assign(p,{gate:2,y:2,z:-310,time:10});assert.equal(step(p,{},1/120),'recover');assert.equal(p.gate,2);assert.equal(p.z,GATES[1].z-8);assert.ok(p.time>=13);assert.equal(p.falls,1);});
test('gates cannot be skipped or passed outside the ring',()=>{const p=createPlayer();Object.assign(p,{z:-149,y:100,vz:-50});step(p,{},.05);assert.equal(p.gate,0);p.z=-210;assert.equal(step(p,{},1/120),'recover');assert.equal(p.gate,0);});
test('finish stops the clock',()=>{const p=createPlayer();Object.assign(p,{gate:6,z:-1049,y:39,vz:-40});assert.equal(step(p,{rightHook:false},.05),'finish');const time=p.time;step(p,{},1);assert.equal(p.time,time);});
test('formatting and corrupt record validation',()=>{assert.equal(formatTime(65.123),'01:05.123');assert.equal(formatTime(0),'00:00.000');assert.deepEqual(cleanRecords([null,{name:'bad',time:-1},{name:'slow',time:100},{name:'fast',time:50},{name:'nan',time:NaN}]).map(r=>r.name),['fast','slow']);});
test('left and right inputs select their own side and pull toward that side',()=>{
  for(const side of ['left','right']){
    const p=createPlayer();for(let i=0;i<120;i++)step(p,{[side+'Hook']:true},1/120);
    const direction=side==='left'?-1:1;
    assert.equal(Math.sign(p.hooks[side].anchor.x),direction);assert.equal(p.hookCount,1);
    assert.ok(p.x*direction>1);assert.equal(p.hooks[side==='left'?'right':'left'],null);
  }
});
test('two hooks coexist and releasing A keeps D attached to the same building',()=>{
  const p=createPlayer();for(let i=0;i<60;i++)step(p,{leftHook:true,rightHook:true},1/120);
  assert.equal(p.hookCount,2);const right=p.hooks.right.anchor;
  for(const h of Object.values(p.hooks))assert.ok(Math.hypot(p.x-h.anchor.x,p.y-h.anchor.y,p.z-h.anchor.z)<=h.rope+.02);
  step(p,{rightHook:true},1/120);assert.equal(p.hooks.left,null);assert.equal(p.hooks.right.anchor,right);assert.equal(p.hookCount,1);
  step(p,{},1/120);assert.equal(p.hookCount,0);assert.equal(p.anchor,null);
});
test('W and S apply opposite longitudinal forces without firing a hook',()=>{
  for(const [key,direction] of [['forward',-1],['back',1]]){
    const p=createPlayer();p.vz=0;step(p,{[key]:true},1/120);
    assert.equal(Math.sign(p.vz),direction);assert.equal(p.hookCount,0);assert.equal(p.vx,0);
  }
});
