import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

async function freePort() {
 const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
 const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));return port;
}

test('settings, public DTOs, sessions and role boundaries are enforced',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'hotel-security-')),port=await freePort();
 const child=spawn(process.execPath,['server/index.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),DB_PATH:join(dir,'test.sqlite')},stdio:'ignore'});
 t.after(async()=>{child.kill();await new Promise(resolve=>child.once('exit',resolve));await rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${port}`;
 for(let i=0;i<50;i++){try{await fetch(`${base}/api/public/site`);break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
 const call=async(method,path,data,token)=>{const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:data===undefined?undefined:JSON.stringify(data)});return {status:response.status,data:await response.json()};};

 const setup=await call('POST','/api/admin/setup',{email:'owner@example.test',password:'owner-password-123'}),ownerToken=setup.data.token,ownerId=setup.data.user.id;
 assert.equal(setup.status,201);
 const settings=await call('PUT','/api/admin/settings',{hotel_name:'Audited Hotel',hero_image_url:'/uploads/hero.webp',logo_url:'https://cdn.example.test/logo.png'},ownerToken);
 assert.equal(settings.status,200);assert.equal(settings.data.hero_image_url,'/uploads/hero.webp');
 assert.equal((await call('PUT','/api/admin/settings',{hero_image_url:'javascript:alert(1)'},ownerToken)).status,400);
 assert.equal((await call('PUT','/api/admin/settings',{contact_email:'not-an-email'},ownerToken)).status,400);

 const type=(await call('POST','/api/admin/types',{slug:'audit-suite',name:'Audit Suite',bed_summary:'King',image_url:'/demo-media/classic-king.webp',max_adults:2,max_guests:2},ownerToken)).data;
 assert.equal((await call('POST','/api/admin/types',{slug:'bad-bool',name:'Bad boolean',bed_summary:'King',active:'false'},ownerToken)).status,400);
 const room=(await call('POST','/api/admin/rooms',{type_id:type.id,number:'A-101'},ownerToken)).data;
 assert.equal((await call('POST','/api/admin/rates',{type_id:type.id,start_date:'2027-01-01',end_date:'2028-01-01',nightly_price:125.5},ownerToken)).status,201);
 const booking=await call('POST','/api/public/reservations',{type_id:type.id,check_in:'2027-05-10',check_out:'2027-05-12',adults:1,children:0,guest:{name:'Private Guest',email:'private@example.test',phone:'+237 600 000 000'}},null);
 assert.equal(booking.status,201);
 const publicView=await call('GET',`/api/public/reservations/${booking.data.token}`);
 const guestId=publicView.data.reservation.guest_id;
 const privatePreference=(await call('POST','/api/admin/preferences',{guest_id:guestId,category:'Privacy',preference:'Do not expose',sensitivity:'private'},ownerToken)).data;
 const request=await call('POST',`/api/public/reservations/${booking.data.token}/requests`,{title:'Extra water',message:'Two bottles'});
 const completedUpdate=await call('PUT',`/api/admin/requests/${request.data.request.id}`,{internal_notes:'VIP recovery detail',assigned_to:'Private staff note',requested_for:'2027-05-10T18:30',status:'completed'},ownerToken);
 assert.equal(completedUpdate.status,200);assert.equal(completedUpdate.data.request.requested_for,'2027-05-10T18:30');
 assert.equal((await call('PUT',`/api/admin/requests/${request.data.request.id}`,{requested_for:'not-a-date'},ownerToken)).status,400);
 let requestState=await call('GET',`/api/public/reservations/${booking.data.token}`);
 assert.deepEqual(Object.keys(requestState.data.requests[0]).sort(),['created_at','id','message','service_id','service_name','status','title','updated_at'].sort());
 const completed=(await call('GET','/api/admin/state',undefined,ownerToken)).data.requests[0];assert.ok(completed.completed_at);
 await call('PUT',`/api/admin/requests/${request.data.request.id}`,{status:'open'},ownerToken);
 assert.equal((await call('GET','/api/admin/state',undefined,ownerToken)).data.requests[0].completed_at,null);

 const manager=(await call('POST','/api/admin/staff',{display_name:'Manager',email:'manager@example.test',password:'manager-password-123',role:'manager'},ownerToken)).data;
 const managerLogin=await call('POST','/api/admin/login',{email:'manager@example.test',password:'manager-password-123'}),oldManagerToken=managerLogin.data.token;
 await call('PUT',`/api/admin/staff/${manager.id}`,{password:'manager-password-456'},ownerToken);
 assert.equal((await call('GET','/api/admin/state',undefined,oldManagerToken)).status,401);
 const newManagerToken=(await call('POST','/api/admin/login',{email:'manager@example.test',password:'manager-password-456'})).data.token;
 assert.equal((await call('POST','/api/admin/staff',{display_name:'Escalated',email:'escalated@example.test',password:'escalated-pass-123',role:'owner'},newManagerToken)).status,403);
 assert.equal((await call('PUT',`/api/admin/staff/${ownerId}`,{display_name:'Taken over'},newManagerToken)).status,403);

 const viewer=(await call('POST','/api/admin/staff',{display_name:'Viewer',email:'viewer@example.test',password:'viewer-password-123',role:'viewer'},ownerToken)).data;
 const viewerToken=(await call('POST','/api/admin/login',{email:'viewer@example.test',password:'viewer-password-123'})).data.token;
 const viewerState=await call('GET','/api/admin/state',undefined,viewerToken);
 assert.equal(viewerState.status,200);assert.deepEqual(viewerState.data.staff,[]);assert.deepEqual(viewerState.data.guests,[]);assert.deepEqual(viewerState.data.preferences,[]);
 assert.equal(viewerState.data.reservations.length,1);assert.equal(viewerState.data.reservations[0].guest_email,undefined);assert.equal(viewerState.data.rooms[0].notes,'');
 assert.equal((await call('GET','/api/admin/preferences',undefined,viewerToken)).status,403);

 const desk=(await call('POST','/api/admin/staff',{display_name:'Desk',email:'desk@example.test',password:'desk-password-123',role:'front_office'},ownerToken)).data;
 const deskToken=(await call('POST','/api/admin/login',{email:'desk@example.test',password:'desk-password-123'})).data.token;
 assert.equal((await call('POST','/api/admin/preferences',{guest_id:guestId,category:'Privacy',preference:'Hidden',sensitivity:'private'},deskToken)).status,403);
 assert.equal((await call('PUT',`/api/admin/preferences/${privatePreference.id}`,{preference:'Read private'},deskToken)).status,403);
 await call('PUT',`/api/admin/staff/${desk.id}`,{active:false},ownerToken);
 assert.equal((await call('GET','/api/admin/state',undefined,deskToken)).status,401);
 assert.equal((await call('POST','/api/admin/login',{email:'desk@example.test',password:'desk-password-123'})).status,401);
 assert.equal((await fetch(`${base}/uploads/does-not-exist.webp`)).status,404);
 assert.equal(room.number,'A-101');
});
