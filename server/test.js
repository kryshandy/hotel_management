import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

async function freePort() {
 const server=net.createServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 await new Promise(resolve=>server.close(resolve));
 return port;
}

test('empty setup, availability, booking and room service use real persisted data',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'hotel-api-'));
 const port=await freePort();
 const server=spawn(process.execPath,['server/index.js'],{
  cwd:new URL('..',import.meta.url),
  env:{...process.env,PORT:String(port),DB_PATH:join(dir,'test.sqlite')},
  stdio:'ignore'
 });
 t.after(async()=>{server.kill();await new Promise(resolve=>server.once('exit',resolve));await rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${port}`;
 for(let i=0;i<50;i++){
  try{await fetch(`${base}/api/public/site`);break;}
  catch{await new Promise(resolve=>setTimeout(resolve,100));}
 }
 let auth;
 async function call(method,path,data){
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${auth}`}:{})},body:data?JSON.stringify(data):undefined});
  return {status:response.status,data:await response.json()};
 }
 const initial=await call('GET','/api/public/site');
 assert.equal(initial.status,200);assert.equal(initial.data.setupRequired,true);assert.deepEqual(initial.data.types,[]);
 assert.equal((await call('GET','/api/admin/state')).status,401);
 const setup=await call('POST','/api/admin/setup',{email:'owner@example.test',password:'secure-password-123'});
 assert.equal(setup.status,201);auth=setup.data.token;
 const edited=await call('PUT','/api/admin/settings',{stays_heading:'Find a stay',show_about:'0',show_contact:true});
 assert.equal(edited.status,200);assert.equal(edited.data.stays_heading,'Find a stay');assert.equal(edited.data.show_about,false);assert.equal(edited.data.show_contact,true);
 assert.equal((await call('POST','/api/admin/setup',{email:'second@example.test',password:'secure-password-123'})).status,409);
 const type=(await call('POST','/api/admin/types',{slug:'suite',name:'Suite',max_adults:2,max_children:1,max_guests:3})).data;
 assert.ok(type.id);
 const room1=(await call('POST','/api/admin/rooms',{type_id:type.id,number:'101'})).data;
 await call('POST','/api/admin/rooms',{type_id:type.id,number:'102'});
 assert.equal((await call('POST','/api/admin/rates',{type_id:type.id,start_date:'2027-01-01',end_date:'2028-01-01',nightly_price:150})).status,201);
 assert.equal((await call('POST','/api/admin/rates',{type_id:type.id,start_date:'2027-06-01',end_date:'2027-07-01',nightly_price:180})).status,409);
 const search=await call('GET','/api/public/availability?checkIn=2027-02-01&checkOut=2027-02-03&adults=2&children=0');
 assert.equal(search.data.types[0].available_count,2);assert.equal(search.data.types[0].quoted_total,300);
 const booking={type_id:type.id,check_in:'2027-02-01',check_out:'2027-02-03',adults:2,children:0,guest:{name:'Guest',email:'guest@example.test'}};
 const first=await call('POST','/api/public/reservations',booking);
 const second=await call('POST','/api/public/reservations',booking);
 const third=await call('POST','/api/public/reservations',booking);
 assert.equal(first.status,201);assert.equal(second.status,201);assert.equal(third.status,409);
 const otherType=(await call('POST','/api/admin/types',{slug:'double',name:'Double',max_adults:2,max_guests:2})).data;
 assert.equal((await call('PUT',`/api/admin/rooms/${room1.id}`,{type_id:otherType.id})).status,409);
 assert.equal((await call('POST','/api/admin/blocks',{room_id:room1.id,start_date:'2027-02-01',end_date:'2027-02-02'})).status,409);
 assert.equal((await call('POST','/api/public/reservations',{...booking,check_in:'2020-01-01',check_out:'2020-01-02'})).status,400);
 const adjacent=await call('POST','/api/public/reservations',{...booking,check_in:'2027-02-03',check_out:'2027-02-04'});
 assert.equal(adjacent.status,201);
 const req=await call('POST',`/api/public/reservations/${first.data.token}/requests`,{title:'Towels',message:'Two extra towels'});
 assert.equal(req.status,201);
 const view=await call('GET',`/api/public/reservations/${first.data.token}`);
 assert.equal(view.data.requests.length,1);
 assert.equal(view.data.reservation.quoted_total,300);
 const guestId=view.data.reservation.guest_id;
 const guestEdit=await call('PUT',`/api/admin/guests/${guestId}`,{name:'Updated Guest',email:'updated@example.test',phone:'12345'});
 assert.equal(guestEdit.status,200);assert.equal(guestEdit.data.name,'Updated Guest');
 assert.equal((await call('GET',`/api/public/reservations/${first.data.token}`)).data.reservation.guest_name,'Updated Guest');
 assert.equal((await call('GET','/api/admin/state')).data.overview.open_requests,1);
 assert.ok((await call('GET','/api/admin/audit')).data.audit.some(x=>x.entity==='guest'&&x.entity_id===guestId));
 let throttled;
 for(let i=0;i<11;i++)throttled=await call('POST','/api/admin/login',{email:'missing@example.test',password:'wrong-password'});
 assert.equal(throttled.status,429);
});

test('first administrator setup requires configured secret',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'hotel-setup-'));
 const port=await freePort();
 const server=spawn(process.execPath,['server/index.js'],{
  cwd:new URL('..',import.meta.url),
  env:{...process.env,PORT:String(port),DB_PATH:join(dir,'test.sqlite'),ADMIN_SETUP_KEY:'one-time-private-setup-secret'},
  stdio:'ignore'
 });
 t.after(async()=>{server.kill();await new Promise(resolve=>server.once('exit',resolve));await rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${port}`;
 let site;
 for(let i=0;i<50;i++){
  try{site=await fetch(`${base}/api/public/site`);break;}
  catch{await new Promise(resolve=>setTimeout(resolve,100));}
 }
 assert.equal((await site.json()).setupKeyRequired,true);
 const body={email:'owner@example.test',password:'secure-password-123'};
 const post=async value=>fetch(`${base}/api/admin/setup`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
 assert.equal((await post(body)).status,403);
 assert.equal((await post({...body,setup_key:'wrong'})).status,403);
 const setup=await post({...body,setup_key:'one-time-private-setup-secret'});
 assert.equal(setup.status,201);
 const {token}=await setup.json();
 const upload=async data=>fetch(`${base}/api/admin/media`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(data)});
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1dAAAAABJRU5ErkJggg==';
 const invalid=await upload({filename:'image.svg',mime_type:'image/svg+xml',data_base64:png});
 assert.equal(invalid.status,400);
 const uploaded=await upload({filename:'image.png',mime_type:'image/png',data_base64:png});
 assert.equal(uploaded.status,201);
 const {url}=await uploaded.json();
 t.after(async()=>{await rm(new URL(`../public${url}`,import.meta.url),{force:true});});
 const image=await fetch(base+url);
 assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
 assert.equal(image.headers.get('x-content-type-options'),'nosniff');
});
