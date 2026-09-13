import * as THREE from 'three';

const clamp=THREE.MathUtils.clamp;
const cube=new THREE.BoxGeometry(1,1,1);
const colors={teal:'#368c83',darkTeal:'#28675f',charcoal:'#42434a',orange:'#e6a34d',cream:'#e8dcc3',skin:'#bf9275',dark:'#35373c'};
const materials=Object.fromEntries(Object.entries(colors).map(([key,color])=>[key,new THREE.MeshStandardMaterial({color,roughness:1,flatShading:true})]));
function group(parent,x=0,y=0,z=0){const g=new THREE.Group();g.position.set(x,y,z);parent.add(g);return g;}
function box(parent,x,y,z,w,h,d,color){const m=new THREE.Mesh(cube,materials[color]);m.position.set(x,y,z);m.scale.set(w,h,d);m.castShadow=true;parent.add(m);return m;}
function mesh(parent,geometry,color,x=0,y=0,z=0){const m=new THREE.Mesh(geometry,materials[color]);m.position.set(x,y,z);m.castShadow=true;parent.add(m);return m;}

function arm(parent,side){
  const shoulder=group(parent,side*.74,.85);
  box(shoulder,0,-.24,0,.37,.49,.4,'teal');
  box(shoulder,side*.19,-.18,0,.04,.14,.35,'cream');
  const elbow=group(shoulder,0,-.48);
  mesh(elbow,new THREE.SphereGeometry(.19,6,4),'darkTeal');
  box(elbow,0,-.24,0,.32,.47,.35,'teal');
  box(elbow,0,-.46,0,.34,.12,.37,'darkTeal');
  const wrist=group(elbow,0,-.57);
  box(wrist,0,0,-.035,.3,.27,.34,'charcoal');
  return {shoulder,elbow,wrist};
}
function leg(parent,side){
  const hip=group(parent,side*.29,-.47);
  box(hip,0,-.29,0,.4,.58,.43,'charcoal');
  box(hip,side*.21,-.23,.02,.12,.3,.35,'darkTeal');
  const knee=group(hip,0,-.57);
  mesh(knee,new THREE.SphereGeometry(.2,6,4),'charcoal');
  box(knee,0,-.28,0,.35,.55,.38,'charcoal');
  box(knee,0,-.13,-.21,.27,.25,.05,'cream');
  const ankle=group(knee,0,-.58);
  box(ankle,0,-.1,-.13,.43,.32,.66,'cream');
  box(ankle,0,-.27,-.13,.45,.07,.68,'dark');
  return {hip,knee,ankle};
}

export function createRunner(){
  const hero=new THREE.Group(),body=group(hero),chest=group(body,0,.05);
  mesh(chest,new THREE.CylinderGeometry(.67,.57,1.24,6),'teal',0,.34).scale.z=.86;
  box(body,0,-.39,0,1.02,.25,.72,'charcoal');
  box(chest,0,.29,-.5,.065,.96,.035,'cream');
  for(const side of [-1,1]){
    box(chest,side*.39,.7,-.4,.24,.12,.07,'cream');
    box(chest,side*.38,.04,-.43,.28,.26,.1,'darkTeal');
  }
  const neck=group(chest,0,1.13);
  mesh(neck,new THREE.IcosahedronGeometry(.47,1),'skin',0,.23).scale.set(.94,1.07,.91);
  mesh(neck,new THREE.SphereGeometry(.58,8,4,0,Math.PI*2,0,Math.PI*.6),'orange',0,.44).scale.z=.96;
  box(neck,0,.48,-.5,.88,.1,.38,'orange');box(neck,0,.86,0,.13,.04,.51,'cream');
  for(const side of [-1,1]){box(neck,side*.44,.18,-.015,.065,.47,.09,'charcoal');box(neck,side*.16,.26,-.4,.065,.06,.025,'dark');}
  box(neck,0,-.09,-.2,.46,.075,.09,'charcoal');
  const pack=group(chest,0,.35,.6);
  box(pack,0,0,0,.88,1.04,.46,'orange');box(pack,0,.49,.01,.92,.17,.5,'charcoal');box(pack,0,-.08,.25,.64,.14,.035,'cream');
  for(const side of [-1,1])box(pack,side*.28,0,.255,.075,.89,.035,'charcoal');
  const straps=[-1,1].map(side=>{const pivot=group(pack,side*.28,-.49,.2);box(pivot,0,-.17,0,.07,.34,.04,'charcoal');return pivot;});
  const coatTails=[-1,1].map(side=>{const pivot=group(body,side*.28,-.28,.34);box(pivot,0,-.2,0,.48,.4,.065,'darkTeal');return pivot;});
  const leftArm=arm(chest,-1),rightArm=arm(chest,1),leftLeg=leg(body,-1),rightLeg=leg(body,1);
  mesh(body,new THREE.CylinderGeometry(.29,.29,.24,10),'orange',.66,-.25).rotation.z=Math.PI/2;
  mesh(body,new THREE.CylinderGeometry(.14,.14,.035,10),'charcoal',.8,-.25).rotation.z=Math.PI/2;
  const cableOutlet=group(body,.84,-.19);
  mesh(body,new THREE.CylinderGeometry(.29,.29,.24,10),'orange',-.66,-.25).rotation.z=Math.PI/2;
  mesh(body,new THREE.CylinderGeometry(.14,.14,.035,10),'charcoal',-.8,-.25).rotation.z=Math.PI/2;
  const cableOutlets={left:group(body,-.84,-.19),right:cableOutlet};
  return {hero,body,chest,neck,pack,straps,coatTails,leftArm,rightArm,leftLeg,rightLeg,cableOutlet,cableOutlets,
    motion:{springs:new Map(),catchAge:9,releaseAge:9,recoverAge:9,airAge:0,wasHooked:false}};
}

export function cueRunner(rig,event){
  if(event==='catch')rig.motion.catchAge=0;
  if(event==='release')rig.motion.releaseAge=0;
  if(event==='recover'){rig.motion.recoverAge=0;rig.motion.catchAge=9;rig.motion.releaseAge=9;rig.motion.springs.clear();}
}
export function resetRunner(rig){rig.motion.springs.clear();rig.motion.catchAge=9;rig.motion.releaseAge=9;rig.motion.recoverAge=9;rig.motion.airAge=0;rig.motion.wasHooked=false;}

// Damped joints give the shoulders, hips and loose equipment different response times.
function spring(rig,key,target,dt,frequency=12,damping=1){
  let state=rig.motion.springs.get(key);
  if(!state){state={value:target,velocity:0};rig.motion.springs.set(key,state);}
  let remaining=Math.min(dt,.1);
  while(remaining>0){const h=Math.min(remaining,1/120);state.velocity+=(frequency*frequency*(target-state.value)-2*damping*frequency*state.velocity)*h;state.value+=state.velocity*h;remaining-=h;}
  return state.value;
}

export function animateRunner(rig,p,dt,time,{menu=false,ready=false}={}){
  const {hero,body,chest,neck,pack,leftArm:la,rightArm:ra,leftLeg:ll,rightLeg:rl,motion:m}=rig;
  const hooked=!!p.anchor;
  if(hooked&&!m.wasHooked&&m.catchAge>.2)cueRunner(rig,'catch');
  if(!hooked&&m.wasHooked&&m.releaseAge>.2)cueRunner(rig,'release');
  m.wasHooked=hooked;
  m.catchAge+=dt;m.releaseAge+=dt;m.recoverAge+=dt;m.airAge=hooked?0:m.airAge+dt;
  const speed=Math.hypot(p.vx,p.vy,p.vz),fast=clamp((speed-18)/55,0,1);
  const rise=clamp(p.vy/32,-1,1),turn=clamp(p.vx/18,-1,1),flight=Math.atan2(p.vy,Math.max(16,-p.vz));
  const side=hooked?Math.sign(p.anchor.x-p.x):0;
  const leftHeld=p.hooks?!!p.hooks.left:hooked&&side<0,rightHeld=p.hooks?!!p.hooks.right:hooked&&side>=0;
  const both=leftHeld&&rightHeld;
  const catchPull=Math.sin(Math.min(1,m.catchAge/.38)*Math.PI)*Math.exp(-m.catchAge*2.5);
  const releaseKick=Math.sin(Math.min(1,m.releaseAge/.5)*Math.PI);
  const tuck=hooked?clamp(rise,0,1):releaseKick*.75;
  const fall=hooked?0:clamp(-p.vy/35,0,1);
  const flutter=Math.sin(time*11)*fast*.035;
  const pose=(key,value,frequency=12,damping=1)=>spring(rig,key,value,dt,frequency,damping);

  // Hips take the cable load first; the upper body and boots follow with a delay.
  hero.rotation.set(0,pose('heading',-turn*.37,9),pose('bank',-turn*.48+(hooked?side*.13:0),9));
  body.rotation.x=pose('bodyPitch',ready?.12:hooked?-.16-flight*.7-catchPull*.22:.95-flight*.9-releaseKick*.3,10,.83);
  body.position.y=pose('compression',ready?-.14:-catchPull*.17+tuck*.06,14,.8);
  chest.rotation.x=pose('chestPitch',hooked?.14+catchPull*.25-tuck*.23:-.12-fall*.16,8);
  chest.rotation.y=pose('chestTwist',both?turn*.06:hooked?side*.18+turn*.12:turn*.28,8);
  chest.rotation.z=pose('chestBank',-turn*.1,7);
  // Keep the helmet looking along the route while the torso rotates beneath it.
  neck.rotation.x=pose('lookPitch',clamp(-body.rotation.x*.48-.12,-.6,.55),11);
  neck.rotation.y=pose('lookYaw',-chest.rotation.y*.6-turn*.12,10);

  la.shoulder.rotation.set(pose('leftShoulderX',leftHeld?.18:hooked?-.3-catchPull*.5:.1-fall*.35,10),0,pose('leftShoulderZ',ready?-.2:leftHeld?-.38:hooked?-.8:-1.05-fall*.3+releaseKick*.35,12));
  ra.shoulder.rotation.set(pose('rightShoulderX',rightHeld?.18:hooked?-.3-catchPull*.5:-.2-fall*.35,12),0,pose('rightShoulderZ',ready?.2:rightHeld?.38:hooked?.8:1.05+fall*.3-releaseKick*.45,13));
  la.elbow.rotation.x=pose('leftElbow',ready?.6:leftHeld?1.25+catchPull*.5:hooked?.75+tuck*.55:.3+releaseKick*.8,11);
  ra.elbow.rotation.x=pose('rightElbow',ready?.6:rightHeld?1.25+catchPull*.5:hooked?.75+tuck*.55:.4+releaseKick,14);
  la.wrist.rotation.z=pose('leftWrist',-turn*.18,9);ra.wrist.rotation.x=pose('rightWrist',hooked?-.3:0,10);

  ll.hip.rotation.set(pose('leftHipX',ready?.35:hooked?-.5+tuck*1.25:.1+releaseKick*.6,8,.82),0,pose('leftHipZ',-.12-turn*.15,10));
  rl.hip.rotation.set(pose('rightHipX',ready?.25:hooked?-.25+tuck*.6:-.15+releaseKick*.15,7,.82),0,pose('rightHipZ',.14-turn*.15,10));
  ll.knee.rotation.x=pose('leftKnee',ready?-.65:hooked?-.55-tuck*.85:-.25-releaseKick*.8-fall*.2,9);
  rl.knee.rotation.x=pose('rightKnee',ready?-.5:hooked?-.85-tuck*.35:-.55-releaseKick*.4-fall*.3,8);
  ll.ankle.rotation.x=pose('leftAnkle',hooked?.16:-.15,7);rl.ankle.rotation.x=pose('rightAnkle',hooked?.12:-.2,7);

  pack.rotation.x=pose('packLag',-chest.rotation.x*.3+catchPull*.17,7,.7);
  pack.position.y=.35+pose('packBounce',catchPull*.09-releaseKick*.045,8,.65);
  rig.straps.forEach((strap,i)=>{strap.rotation.x=pose('strap'+i,fast*.75+catchPull*.4,6,.65)+flutter*(i?1:-1);});
  rig.coatTails.forEach((tail,i)=>{tail.rotation.x=pose('coat'+i,-.12-fast*.6-catchPull*.2,7,.7)+flutter*(i?1:-1);});
  if(menu){neck.rotation.y+=Math.sin(time*.55)*.08;}
}
