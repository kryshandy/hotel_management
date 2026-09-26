import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFile, stat, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrations } from './migrations.js';
import { initializeCoreSchema } from './schema.js';
import { localDateTimeToEpoch } from './time.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const dbPath = path.resolve(process.env.DB_PATH || path.join(root, 'hotel.sqlite'));
const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(publicDir, 'uploads'));
await mkdir(path.dirname(dbPath),{recursive:true});
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
initializeCoreSchema(db);
applyMigrations(db);

class ApiError extends Error { constructor(status, message, details) { super(message); this.status = status; this.details = details; } }
const fail = (status, message, details) => { throw new ApiError(status, message, details); };
const attempts=new Map();
function limit(req,res,scope,max,windowMs=15*60*1000) {
 const now=Date.now(), key=`${scope}:${req.socket.remoteAddress||'unknown'}`;
 if(attempts.size>10000) for(const [k,v] of attempts) if(v.reset<=now) attempts.delete(k);
 let entry=attempts.get(key);
 if(!entry||entry.reset<=now)entry={count:0,reset:now+windowMs};
 entry.count++;attempts.set(key,entry);
 if(entry.count>max){res.setHeader('Retry-After',String(Math.ceil((entry.reset-now)/1000)));fail(429,'Too many requests. Please try again later.');}
}
const hash = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const one = (sql, ...params) => db.prepare(sql).get(...params);
const all = (sql, ...params) => db.prepare(sql).all(...params);
const run = (sql, ...params) => db.prepare(sql).run(...params);
const row = (table, id) => one(`SELECT * FROM ${table} WHERE id=?`, id);
const audit = (admin,action,entity,entityId,before,after) => run(
 'INSERT INTO audit_log(admin_id,action,entity,entity_id,before_json,after_json) VALUES(?,?,?,?,?,?)',
 admin.id,action,entity,entityId,before?JSON.stringify(before):null,after?JSON.stringify(after):null
);
function atomic(fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}}
const settings = () => {const x=one('SELECT * FROM settings WHERE id=1');return {...x,show_about:bool(x.show_about),show_contact:bool(x.show_contact),booking_enabled:bool(x.booking_enabled),demo_mode:bool(x.demo_mode)};};
const bool = v => v === true || v === 1;
const featureCatalog = () => all('SELECT * FROM feature_flags ORDER BY category,sort_order,key').map(x=>({...x,enabled:bool(x.enabled)}));
const features = () => Object.fromEntries(featureCatalog().map(x=>[x.key,x.enabled]));
const featureOn = key => bool(one('SELECT enabled FROM feature_flags WHERE key=?',key)?.enabled);
const bookingRules = () => {const x=one('SELECT * FROM booking_rules WHERE id=1');return {...x,require_phone:bool(x.require_phone),allow_children:bool(x.allow_children),allow_special_requests:bool(x.allow_special_requests),auto_confirm:bool(x.auto_confirm)};};
const boolean = (v,field) => {if(![true,false,1,0,'1','0'].includes(v))fail(400,`Invalid ${field}`);return v===true||v===1||v==='1'?1:0;};
const text = (v, field, max=1000, required=false) => {
 if (typeof v !== 'string' || (required && !v.trim()) || v.length > max) fail(400, `Invalid ${field}`);
 return v.trim();
};
const integer = (v, field, min=0, max=1000000000) => {
 if (!Number.isInteger(v) || v<min || v>max) fail(400, `Invalid ${field}`);
 return v;
};
const decimal = (v, field, min=0, max=1000000000) => {
 if (typeof v !== 'number' || !Number.isFinite(v) || v<min || v>max) fail(400, `Invalid ${field}`);
 return v;
};
const date = (v, field) => {
 if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0,10)!==v) fail(400, `Invalid ${field}`);
 return v;
};
const dateTime = (v,field) => {
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(v))fail(400,`Invalid ${field}`);
 const parsed=Date.parse(/[Z+-]\d{0,2}:?\d{0,2}$/.test(v)?v:`${v}Z`);if(Number.isNaN(parsed))fail(400,`Invalid ${field}`);
 return v;
};
const dates = (a,b,maxNights=365) => {
 const start=date(a,'start date'), end=date(b,'end date');
 const nights=(Date.parse(`${end}T00:00:00Z`)-Date.parse(`${start}T00:00:00Z`))/86400000;
 if (nights<1 || nights>maxNights) fail(400,`Date range must be 1 to ${maxNights} nights`);
 return {start,end,nights};
};
function localToday() {
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:settings().timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const value=Object.fromEntries(parts.map(p=>[p.type,p.value]));
 return `${value.year}-${value.month}-${value.day}`;
}
const id = v => integer(Number(v),'id',1);
const jsonArray = (v,field) => {
 if (!Array.isArray(v) || v.length>30 || v.some(x=>typeof x!=='string'||x.length>300)) fail(400,`Invalid ${field}`);
 return JSON.stringify(v.map(x=>x.trim()));
};
const webUrl = (v,field,{allowRelative=true}={}) => {
 const value=text(v??'',field,2000);
 if(!value)return '';
 if(allowRelative&&value.startsWith('/')&&!value.startsWith('//')&&!value.includes('\\'))return value;
 let parsed;try{parsed=new URL(value);}catch{fail(400,`Invalid ${field}`);}
 if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)fail(400,`Invalid ${field}`);
 return value;
};
const exposeType = x => x && ({...x,active:bool(x.active),amenities:JSON.parse(x.amenities),images:JSON.parse(x.images)});
const exposeService = x => x && ({...x,active:bool(x.active)});
const exposeReservation = x => x && ({...x,token_hash:undefined,guest_name:x.guest_name,guest_email:x.guest_email,guest_phone:x.guest_phone});
const exposePublicRequest = x => x && ({id:x.id,service_id:x.service_id,title:x.title,message:x.message,status:x.status,created_at:x.created_at,updated_at:x.updated_at,service_name:x.service_name});
const reservations = () => all(`SELECT r.*,g.name guest_name,g.email guest_email,g.phone guest_phone,t.name type_name,rm.number room_number
 FROM reservations r JOIN guests g ON g.id=r.guest_id JOIN accommodation_types t ON t.id=r.type_id JOIN rooms rm ON rm.id=r.room_id ORDER BY r.created_at DESC,r.id DESC`).map(exposeReservation);
const requests = () => all(`SELECT sr.*,s.name service_name,r.reference reservation_reference,rm.number room_number
 FROM service_requests sr LEFT JOIN services s ON s.id=sr.service_id JOIN reservations r ON r.id=sr.reservation_id
 JOIN rooms rm ON rm.id=r.room_id ORDER BY sr.created_at DESC,sr.id DESC`);
function quote(typeId, start, end) {
 const {nights}=dates(start,end);
 let total=0; let minNights=1; let first=null;
 for (let i=0;i<nights;i++) {
  const d=new Date(Date.parse(`${start}T00:00:00Z`)+i*86400000).toISOString().slice(0,10);
  const rate=one('SELECT * FROM rates WHERE type_id=? AND start_date<=? AND end_date>? ORDER BY id DESC LIMIT 1',typeId,d,d);
  if (!rate) return null;
  if (first===null) first=rate.nightly_price;
  total+=rate.nightly_price; minNights=Math.max(minNights,rate.min_nights);
 }
 if (nights<minNights) return null;
 return {effective_price:first,quoted_total:Math.round(total*100)/100};
}
function availableRooms(typeId,start,end) {
 return all(`SELECT rm.* FROM rooms rm WHERE rm.type_id=? AND rm.status='active'
  AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.room_id=rm.id AND b.start_date<? AND b.end_date>?)
  AND NOT EXISTS(SELECT 1 FROM maintenance_tickets m WHERE m.room_id=rm.id AND m.out_of_order=1 AND m.status NOT IN ('resolved','cancelled'))
  AND NOT EXISTS(SELECT 1 FROM reservations r WHERE r.room_id=rm.id AND r.status IN ('pending','confirmed','checked_in') AND r.check_in<? AND r.check_out>?)
 ORDER BY rm.id`,typeId,end,start,end,start);
}
function availableTypes(start,end,adults,children) {
 const rules=bookingRules();dates(start,end,rules.max_stay_nights);integer(adults,'adults',1,30);integer(children,'children',0,30);
 if(!rules.allow_children&&children)fail(400,'Children are not enabled for online reservations');
 const advance=(Date.parse(`${start}T00:00:00Z`)-Date.parse(`${localToday()}T00:00:00Z`))/86400000;
 if(advance<0)fail(400,'Check-in cannot be in the past');
 if(advance>rules.max_advance_days)fail(400,`Reservations open ${rules.max_advance_days} days in advance`);
 return all('SELECT * FROM accommodation_types WHERE active=1 ORDER BY sort_order,id').map(exposeType)
  .filter(t=>adults<=t.max_adults && children<=t.max_children && adults+children<=t.max_guests)
  .map(t=>{const q=quote(t.id,start,end);return {...t,available_count:q?availableRooms(t.id,start,end).length:0,effective_price:q?.effective_price??null,quoted_total:q?.quoted_total??null};});
}
const bearer = req => { const h=req.headers.authorization||''; return h.startsWith('Bearer ')?h.slice(7):null; };
function currentUser(req) {
 const value=bearer(req); if (!value) return null;
 const s=one(`SELECT a.id,a.email,a.display_name,a.role,a.active,s.expires_at FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token_hash=?`,hash(value));
 return s && s.active && Date.parse(s.expires_at)>Date.now()?{id:s.id,email:s.email,display_name:s.display_name,role:s.role}:null;
}
function requireAdmin(req) {const user=currentUser(req);if(!user)fail(401,'Sign in required');return user;}
function requireLeadership(admin){if(!['owner','manager'].includes(admin.role))fail(403,'Leadership access required');}
function requireRoles(admin,roles){if(!['owner','manager'].includes(admin.role)&&!roles.includes(admin.role))fail(403,'Your role cannot perform this action');}
const publicSite = () => ({settings:settings(),features:features(),bookingRules:bookingRules(),types:all('SELECT * FROM accommodation_types WHERE active=1 ORDER BY sort_order,id').map(exposeType),services:featureOn('service_catalog')?all('SELECT * FROM services WHERE active=1 ORDER BY sort_order,id').map(exposeService):[],sections:all('SELECT * FROM content_sections WHERE enabled=1 ORDER BY sort_order,id').map(x=>({...x,enabled:bool(x.enabled)})),setupRequired:!one('SELECT id FROM admins LIMIT 1'),setupKeyRequired:!!process.env.ADMIN_SETUP_KEY});
const adminState = admin => {
 const types=all('SELECT * FROM accommodation_types ORDER BY sort_order,id').map(exposeType);
 const rooms=all('SELECT rm.*,t.name type_name FROM rooms rm JOIN accommodation_types t ON t.id=rm.type_id ORDER BY rm.number,rm.id');
 const rates=all('SELECT ra.*,t.name type_name FROM rates ra JOIN accommodation_types t ON t.id=ra.type_id ORDER BY ra.start_date DESC,ra.id DESC');
 const blocks=all('SELECT b.*,rm.number room_number FROM blocks b JOIN rooms rm ON rm.id=b.room_id ORDER BY b.start_date DESC,b.id DESC');
 const services=all('SELECT * FROM services ORDER BY sort_order,id').map(exposeService);
 const res=reservations(), req=requests(), guests=all('SELECT * FROM guests ORDER BY created_at DESC,id DESC');
 const departments=all('SELECT * FROM departments ORDER BY sort_order,id').map(x=>({...x,active:bool(x.active)}));
 const housekeeping=all(`SELECT h.*,rm.number room_number,r.reference reservation_reference FROM housekeeping_tasks h JOIN rooms rm ON rm.id=h.room_id LEFT JOIN reservations r ON r.id=h.reservation_id ORDER BY h.scheduled_for,h.priority DESC,h.id DESC`);
 const maintenance=all(`SELECT m.*,rm.number room_number FROM maintenance_tickets m LEFT JOIN rooms rm ON rm.id=m.room_id ORDER BY CASE m.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,m.id DESC`).map(x=>({...x,out_of_order:bool(x.out_of_order)}));
 const preferences=all(`SELECT p.*,g.name guest_name,g.email guest_email FROM guest_preferences p JOIN guests g ON g.id=p.guest_id ORDER BY p.updated_at DESC,p.id DESC`).map(x=>({...x,active:bool(x.active)}));
 const sections=all('SELECT * FROM content_sections ORDER BY sort_order,id').map(x=>({...x,enabled:bool(x.enabled)}));
 const staff=all('SELECT id,email,display_name,role,active,created_at FROM admins ORDER BY active DESC,display_name,email').map(x=>({...x,active:bool(x.active)}));
 const state={settings:settings(),features:featureCatalog(),bookingRules:bookingRules(),types,rooms,rates,blocks,services,reservations:res,requests:req,guests,departments,housekeeping,maintenance,preferences,sections,staff,
   overview:{types:types.length,rooms:rooms.length,active_rooms:rooms.filter(x=>x.status==='active').length,
    reservations:res.length,pending_reservations:res.filter(x=>x.status==='pending').length,
    checked_in:res.filter(x=>x.status==='checked_in').length,open_requests:req.filter(x=>x.status==='open'||x.status==='in_progress').length,
    rooms_to_service:housekeeping.filter(x=>!['completed','cancelled'].includes(x.status)).length,
    open_maintenance:maintenance.filter(x=>!['resolved','cancelled'].includes(x.status)).length,
    vip_preferences:preferences.filter(x=>x.active).length}};
 if(!admin||['owner','manager'].includes(admin.role))return state;
 const role=admin.role;
 const fullGuestAccess=['front_office','concierge'].includes(role);
 state.staff=[];
 state.guests=fullGuestAccess?guests:[];
 state.preferences=fullGuestAccess?preferences.filter(x=>x.sensitivity!=='private'):[];
 state.requests=fullGuestAccess?req:[];
 state.departments=fullGuestAccess?departments:[];
 state.services=role==='concierge'?services:[];
 state.rates=role==='revenue'?rates:[];
 state.sections=role==='revenue'?sections:[];
 state.housekeeping=['front_office','housekeeping'].includes(role)?housekeeping:[];
 state.maintenance=['front_office','engineering'].includes(role)?maintenance:maintenance.map(x=>({id:x.id,room_id:x.room_id,status:x.status,out_of_order:x.out_of_order,title:'Engineering hold'}));
 state.blocks=['front_office','revenue'].includes(role)?blocks:blocks.map(x=>({id:x.id,room_id:x.room_id,start_date:x.start_date,end_date:x.end_date,reason:''}));
 state.rooms=rooms.map(x=>role==='revenue'?x:{...x,notes:''});
 if(!fullGuestAccess)state.reservations=res.map(x=>({...x,guest_id:undefined,guest_name:undefined,guest_email:undefined,guest_phone:undefined,notes:undefined}));
 return state;
};
function respond(res,status,data,extra={}) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra});res.end(JSON.stringify(data));}
async function body(req,maxBytes=1024*1024) {
 let chunks=[],size=0;
 for await(const c of req){size+=c.length;if(size>maxBytes)fail(413,'Request too large');chunks.push(c);}
 try {const x=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!x||typeof x!=='object'||Array.isArray(x))throw 0;return x;}
 catch {fail(400,'Invalid JSON body');}
}
const uploadTypes={
 'image/png':{ext:'.png',names:['.png']},
 'image/jpeg':{ext:'.jpg',names:['.jpg','.jpeg']},
 'image/webp':{ext:'.webp',names:['.webp']}
};
function validImage(bytes,mimeType) {
 if(mimeType==='image/png') {
  if(bytes.length<45||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return false;
  if(bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')return false;
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(!width||!height||width>20000||height>20000)return false;
  let offset=8,ended=false,hasImageData=false;
  while(offset+12<=bytes.length){
   const length=bytes.readUInt32BE(offset),end=offset+12+length;
   if(end>bytes.length)return false;
   const type=bytes.toString('ascii',offset+4,offset+8);
   if(!/^[A-Za-z]{4}$/.test(type))return false;
   if(type==='IDAT'&&length>0)hasImageData=true;
   if(type==='IEND'){if(length!==0||end!==bytes.length)return false;ended=true;break;}
   offset=end;
  }
  return ended&&hasImageData;
 }
 if(mimeType==='image/jpeg') {
  if(bytes.length<16||bytes[0]!==0xff||bytes[1]!==0xd8||bytes.at(-2)!==0xff||bytes.at(-1)!==0xd9)return false;
  let pos=2,hasFrame=false,hasScan=false;
  while(pos+4<bytes.length){
   if(bytes[pos]!==0xff)return false;
   while(bytes[pos]===0xff)pos++;
   const marker=bytes[pos++];
   if(marker===0xda){hasScan=true;break;}
   if(marker===0xd8||marker===0xd9||marker===0x01||marker>=0xd0&&marker<=0xd7)return false;
   if(pos+2>bytes.length)return false;
   const length=bytes.readUInt16BE(pos);
   if(length<2||pos+length>bytes.length)return false;
   if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
    if(length<7)return false;
    const height=bytes.readUInt16BE(pos+3),width=bytes.readUInt16BE(pos+5);
    if(!width||!height||width>20000||height>20000)return false;
    hasFrame=true;
   }
   pos+=length;
  }
  return hasFrame&&hasScan&&bytes.length>pos+4;
 }
 if(mimeType==='image/webp'){
  if(bytes.length<30||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP')return false;
  if(bytes.readUInt32LE(4)+8!==bytes.length)return false;
  const chunk=bytes.toString('ascii',12,16),length=bytes.readUInt32LE(16);
  if(!['VP8 ','VP8L','VP8X'].includes(chunk)||20+length+(length%2)>bytes.length)return false;
  if(chunk==='VP8X'&&length<10||chunk==='VP8L'&&length<5||chunk==='VP8 '&&length<10)return false;
  return true;
 }
 return false;
}
async function uploadMedia(admin,b) {
 const filename=text(b.filename,'filename',255,true),mimeType=text(b.mime_type,'mime_type',40,true);
 const type=uploadTypes[mimeType];
 if(!type||filename!==path.basename(filename)||/[\\/\x00-\x1f]/.test(filename)||!type.names.includes(path.extname(filename).toLowerCase()))fail(400,'Unsupported image filename or type');
 const encoded=b.data_base64;
 if(typeof encoded!=='string'||!encoded.length||encoded.length>7*1024*1024||encoded.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))fail(400,'Invalid base64 image data');
 const bytes=Buffer.from(encoded,'base64');
 if(bytes.length>5*1024*1024||bytes.length===0)fail(413,'Image must be 5 MB or smaller');
 if(!validImage(bytes,mimeType))fail(400,'Image content does not match its type');
 const name=`${randomBytes(20).toString('hex')}${type.ext}`,url=`/uploads/${name}`;
 const file=path.join(uploadDir,name);
 await mkdir(uploadDir,{recursive:true});
 await writeFile(file,bytes,{flag:'wx',mode:0o600});
 try{audit(admin,'upload','media',null,null,{url,mime_type:mimeType,size:bytes.length});}
 catch(e){await rm(file,{force:true});throw e;}
 return {url};
}
const fields = {
 types:['slug','name','description','bed_summary','max_adults','max_children','max_guests','size_sqm','amenities','image_url','images','active','sort_order'],
 rooms:['type_id','number','floor','status','notes'],
 rates:['type_id','start_date','end_date','nightly_price','min_nights'],
 blocks:['room_id','start_date','end_date','reason'],
 services:['name','description','category','active','sort_order'],
 departments:['name','color','active','sort_order'],
 housekeeping:['room_id','reservation_id','task_type','priority','status','scheduled_for','assigned_to','notes'],
 maintenance:['room_id','title','description','priority','status','out_of_order','assigned_to','due_at'],
 preferences:['guest_id','category','preference','sensitivity','active'],
 sections:['section_key','nav_label','eyebrow','heading','body','image_url','cta_label','cta_url','layout','enabled','sort_order']
};
const tables={types:'accommodation_types',rooms:'rooms',rates:'rates',blocks:'blocks',services:'services',departments:'departments',housekeeping:'housekeeping_tasks',maintenance:'maintenance_tickets',preferences:'guest_preferences',sections:'content_sections'};
function normalize(entity,b,existing={}) {
 const x={...existing,...b}; const out={};
 for(const k of Object.keys(b)) if(!fields[entity].includes(k)) fail(400,`Unknown field ${k}`);
 if(entity==='types') {
  out.slug=text(x.slug,'slug',100,true).toLowerCase();if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(out.slug))fail(400,'Invalid slug');
  out.name=text(x.name,'name',120,true);out.description=text(x.description??'','description',10000);
  out.bed_summary=text(x.bed_summary??'','bed_summary',300);out.max_adults=integer(x.max_adults??2,'max_adults',1,30);
  out.max_children=integer(x.max_children??0,'max_children',0,30);out.max_guests=integer(x.max_guests??out.max_adults,'max_guests',1,40);
  if(out.max_guests<out.max_adults)fail(400,'max_guests must fit max_adults');
  out.size_sqm=x.size_sqm==null?null:decimal(x.size_sqm,'size_sqm',0,100000);
  out.amenities=jsonArray(x.amenities??[],'amenities');out.image_url=webUrl(x.image_url??'','image_url');
  const images=x.images??[];if(!Array.isArray(images)||images.length>30)fail(400,'Invalid images');
  out.images=JSON.stringify(images.map(value=>webUrl(value,'images')));out.active=boolean(x.active??true,'active');out.sort_order=integer(x.sort_order??0,'sort_order',-10000,10000);
 }
 if(entity==='rooms') {
  out.type_id=id(x.type_id);if(!row('accommodation_types',out.type_id))fail(400,'Unknown accommodation type');
  out.number=text(x.number,'number',50,true);out.floor=text(x.floor??'','floor',50);
  out.status=text(x.status??'active','status',30);if(!['active','maintenance','inactive'].includes(out.status))fail(400,'Invalid status');
  out.notes=text(x.notes??'','notes',3000);
  if(existing.id && out.type_id!==existing.type_id && one(`SELECT id FROM reservations WHERE room_id=? AND status IN ('pending','confirmed','checked_in') AND check_out>? LIMIT 1`,existing.id,localToday()))
   fail(409,'Room type cannot change while it has an active or upcoming reservation');
  if(existing.id && out.status!=='active' && one(`SELECT id FROM reservations WHERE room_id=? AND status IN ('pending','confirmed','checked_in') AND check_out>? LIMIT 1`,existing.id,localToday()))
   fail(409,'Room has an active or upcoming reservation');
 }
 if(entity==='rates') {
  out.type_id=id(x.type_id);if(!row('accommodation_types',out.type_id))fail(400,'Unknown accommodation type');
  const d=dates(x.start_date,x.end_date,3660);out.start_date=d.start;out.end_date=d.end;
  out.nightly_price=decimal(x.nightly_price,'nightly_price');out.min_nights=integer(x.min_nights??1,'min_nights',1,365);
  if(one('SELECT id FROM rates WHERE type_id=? AND start_date<? AND end_date>? AND id!=? LIMIT 1',out.type_id,out.end_date,out.start_date,existing.id??0))
   fail(409,'Rate date range overlaps an existing rate');
 }
 if(entity==='blocks') {
  out.room_id=id(x.room_id);if(!row('rooms',out.room_id))fail(400,'Unknown room');
  const d=dates(x.start_date,x.end_date,3660);out.start_date=d.start;out.end_date=d.end;out.reason=text(x.reason??'','reason',500);
  if(one(`SELECT id FROM reservations WHERE room_id=? AND status IN ('pending','confirmed','checked_in') AND check_in<? AND check_out>? LIMIT 1`,out.room_id,out.end_date,out.start_date))
   fail(409,'Block overlaps an active reservation');
 }
 if(entity==='services') {
  out.name=text(x.name,'name',120,true);out.description=text(x.description??'','description',3000);
  out.category=text(x.category??'','category',100);out.active=boolean(x.active??true,'active');
  out.sort_order=integer(x.sort_order??0,'sort_order',-10000,10000);
 }
 if(entity==='departments') {
  out.name=text(x.name,'name',120,true);out.color=text(x.color??'#315f5a','color',7,true);
  if(!/^#[0-9a-fA-F]{6}$/.test(out.color))fail(400,'Invalid color');
  out.active=boolean(x.active??true,'active');out.sort_order=integer(x.sort_order??0,'sort_order',-10000,10000);
 }
 if(entity==='housekeeping') {
  out.room_id=id(x.room_id);if(!row('rooms',out.room_id))fail(400,'Unknown room');
  out.reservation_id=x.reservation_id==null?null:id(x.reservation_id);if(out.reservation_id&&!row('reservations',out.reservation_id))fail(400,'Unknown reservation');
  out.task_type=text(x.task_type??'stayover','task type',30,true);if(!['arrival','departure','stayover','turndown','inspection','deep_clean','other'].includes(out.task_type))fail(400,'Invalid task type');
  out.priority=text(x.priority??'normal','priority',20,true);if(!['low','normal','high','urgent'].includes(out.priority))fail(400,'Invalid priority');
  out.status=text(x.status??'queued','status',30,true);if(!['queued','assigned','in_progress','inspection','completed','cancelled'].includes(out.status))fail(400,'Invalid status');
  out.scheduled_for=date(x.scheduled_for,'scheduled date');out.assigned_to=text(x.assigned_to??'','assigned to',160);out.notes=text(x.notes??'','notes',3000);
 }
 if(entity==='maintenance') {
  out.room_id=x.room_id==null?null:id(x.room_id);if(out.room_id&&!row('rooms',out.room_id))fail(400,'Unknown room');
  out.title=text(x.title,'title',160,true);out.description=text(x.description??'','description',5000);
  out.priority=text(x.priority??'normal','priority',20,true);if(!['low','normal','high','critical'].includes(out.priority))fail(400,'Invalid priority');
  out.status=text(x.status??'open','status',30,true);if(!['open','assigned','in_progress','on_hold','resolved','cancelled'].includes(out.status))fail(400,'Invalid status');
  out.out_of_order=boolean(x.out_of_order??false,'out_of_order');out.assigned_to=text(x.assigned_to??'','assigned to',160);
  out.due_at=x.due_at?date(x.due_at,'due date'):null;
  out.resolved_at=out.status==='resolved'?(existing.resolved_at||new Date().toISOString()):null;
 }
 if(entity==='preferences') {
  out.guest_id=id(x.guest_id);if(!row('guests',out.guest_id))fail(400,'Unknown guest');
  out.category=text(x.category,'category',100,true);out.preference=text(x.preference,'preference',1000,true);
  out.sensitivity=text(x.sensitivity??'standard','sensitivity',20,true);if(!['standard','private'].includes(out.sensitivity))fail(400,'Invalid sensitivity');
  out.active=boolean(x.active??true,'active');
 }
 if(entity==='sections') {
  out.section_key=text(x.section_key,'section key',100,true).toLowerCase();if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(out.section_key))fail(400,'Invalid section key');
  out.nav_label=text(x.nav_label??'','navigation label',80);out.eyebrow=text(x.eyebrow??'','eyebrow',120);
  out.heading=text(x.heading,'heading',200,true);out.body=text(x.body??'','body',10000);out.image_url=webUrl(x.image_url??'','image URL');
  out.cta_label=text(x.cta_label??'','CTA label',100);out.cta_url=webUrl(x.cta_url??'','CTA URL');
  out.layout=text(x.layout??'editorial','layout',30,true);if(!['editorial','feature','split','quote'].includes(out.layout))fail(400,'Invalid layout');
  out.enabled=boolean(x.enabled??true,'enabled');out.sort_order=integer(x.sort_order??0,'sort_order',-10000,10000);
 }
 return out;
}
function saveEntity(entity,b,itemId) {
 const table=tables[entity];if(!table)fail(404,'Unknown entity');
 const old=itemId?row(table,itemId):null;if(itemId&&!old)fail(404,'Record not found');
 const existing=old?{...old,amenities:entity==='types'?JSON.parse(old.amenities):undefined,images:entity==='types'?JSON.parse(old.images):undefined}:{};
 const data=normalize(entity,b,existing);const keys=Object.keys(data);
 try {
   if(itemId)run(`UPDATE ${table} SET ${keys.map(k=>`${k}=?`).join(',')} WHERE id=?`,...keys.map(k=>data[k]),itemId);
   else itemId=Number(run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,...keys.map(k=>data[k])).lastInsertRowid);
   if(['housekeeping','maintenance','preferences'].includes(entity))run(`UPDATE ${table} SET updated_at=CURRENT_TIMESTAMP WHERE id=?`,itemId);
 } catch(e) {if(e.message.includes('UNIQUE'))fail(409,'A record with this unique value already exists');throw e;}
 const result=row(table,itemId);return entity==='types'?exposeType(result):entity==='services'?exposeService(result):['departments','preferences','sections'].includes(entity)?{...result,[entity==='sections'?'enabled':'active']:bool(result[entity==='sections'?'enabled':'active'])}:entity==='maintenance'?{...result,out_of_order:bool(result.out_of_order)}:result;
}
function deleteEntity(entity,itemId) {
 const table=tables[entity];if(!table)fail(404,'Unknown entity');if(!row(table,itemId))fail(404,'Record not found');
 try {run(`DELETE FROM ${table} WHERE id=?`,itemId);}catch(e){if(e.message.includes('FOREIGN KEY'))fail(409,'Record is in use');throw e;}
}
function updateSettings(b) {
 const old=settings(), data={};
 for(const [k,v] of Object.entries(b)) {
  if(k==='id'||!(k in old))fail(400,`Unknown field ${k}`);
  if(['show_about','show_contact','booking_enabled','demo_mode'].includes(k))data[k]=boolean(v,k);
  else if(['logo_url','hero_image_url'].includes(k))data[k]=webUrl(v,k);
  else data[k]=text(v,k,k==='description'||k==='policies'||k==='about'?10000:2000,k==='hotel_name');
 }
 for(const k of ['primary_color','accent_color']) if(k in data&&!/^#[0-9a-fA-F]{6}$/.test(data[k]))fail(400,`Invalid ${k}`);
 if('currency' in data&&!/^[A-Z]{3}$/.test(data.currency))fail(400,'Invalid currency');
 if('contact_email' in data&&data.contact_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contact_email))fail(400,'Invalid contact_email');
 if('timezone' in data){try{new Intl.DateTimeFormat('en',{timeZone:data.timezone});}catch{fail(400,'Invalid timezone');}}
 for(const k of ['check_in_time','check_out_time'])if(k in data&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(data[k]))fail(400,`Invalid ${k}`);
 if((data.demo_mode??old.demo_mode) && (data.booking_enabled??old.booking_enabled))fail(400,'Turn off demo mode before enabling reservations');
 const keys=Object.keys(data);if(keys.length)run(`UPDATE settings SET ${keys.map(k=>`${k}=?`).join(',')} WHERE id=1`,...keys.map(k=>data[k]));
 return settings();
}
function updateBookingRules(b) {
 const old=bookingRules(),data={};
 const numeric={max_advance_days:[1,3650],max_stay_nights:[1,365],minimum_lead_hours:[0,8760],cancellation_window_hours:[0,8760]};
 for(const [k,v] of Object.entries(b)) {
  if(k in numeric)data[k]=integer(v,k,numeric[k][0],numeric[k][1]);
  else if(['require_phone','allow_children','allow_special_requests','auto_confirm'].includes(k))data[k]=boolean(v,k);
  else if(k==='terms_url')data[k]=webUrl(v,k);
  else fail(400,`Unknown field ${k}`);
 }
 const keys=Object.keys(data);if(keys.length)run(`UPDATE booking_rules SET ${keys.map(k=>`${k}=?`).join(',')} WHERE id=1`,...keys.map(k=>data[k]));
 return bookingRules();
}
function checkLeadTime(start,rules) {
 const settingsValue=settings(),checkInTime=settingsValue.check_in_time||'15:00';
 const target=localDateTimeToEpoch(start,checkInTime,settingsValue.timezone);
 const now=Date.now();
 if(target-now<rules.minimum_lead_hours*3600000)fail(400,`Reservations require at least ${rules.minimum_lead_hours} hours notice`);
}
function createSession(admin) {
 const value=token(), expires=new Date(Date.now()+7*86400000).toISOString();
 run('INSERT INTO sessions(token_hash,admin_id,expires_at) VALUES(?,?,?)',hash(value),admin.id,expires);
 return {user:{id:admin.id,email:admin.email,display_name:admin.display_name||'',role:admin.role||'owner'},token:value};
}
function reserve(b) {
 if(!featureOn('public_booking')||!settings().booking_enabled || settings().demo_mode)fail(409,'Online reservations are currently paused');
 const rules=bookingRules();
 const typeId=id(b.type_id??b.typeId), {start,end}=dates(b.check_in??b.checkIn,b.check_out??b.checkOut,rules.max_stay_nights);
 if(start<localToday())fail(400,'Check-in cannot be in the past');
 const advance=(Date.parse(`${start}T00:00:00Z`)-Date.parse(`${localToday()}T00:00:00Z`))/86400000;
 if(advance>rules.max_advance_days)fail(400,`Reservations open ${rules.max_advance_days} days in advance`);
 checkLeadTime(start,rules);
 const adults=integer(b.adults,'adults',1,30),children=integer(b.children??0,'children',0,30);
 if(!rules.allow_children&&children)fail(400,'Children are not enabled for online reservations');
 const guest=b.guest;if(!guest||typeof guest!=='object')fail(400,'Guest details required');
 const name=text(guest.name,'guest name',160,true),email=text(guest.email,'guest email',254,true).toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Invalid guest email');
 const phone=text(guest.phone??'','guest phone',50,rules.require_phone),notes=text(b.notes??'','notes',3000);
 if(!rules.allow_special_requests&&notes)fail(400,'Special requests are not enabled for online reservations');
 let result;
 db.exec('BEGIN IMMEDIATE');
 try {
  const type=row('accommodation_types',typeId);
  if(!type||!type.active)fail(404,'Accommodation type unavailable');
  if(adults>type.max_adults||children>type.max_children||adults+children>type.max_guests)fail(400,'Party exceeds room capacity');
  const q=quote(typeId,start,end);if(!q)fail(409,'No rate covers this stay');
  const room=availableRooms(typeId,start,end)[0];if(!room)fail(409,'No room available for these dates');
  const guestId=Number(run('INSERT INTO guests(name,email,phone) VALUES(?,?,?)',name,email,phone).lastInsertRowid);
  const access=token();let reference;
  for(let i=0;i<5;i++){reference=`HM-${randomBytes(4).toString('hex').toUpperCase()}`;if(!one('SELECT id FROM reservations WHERE reference=?',reference))break;}
   run(`INSERT INTO reservations(reference,token_hash,type_id,room_id,guest_id,check_in,check_out,adults,children,status,quoted_total,notes)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,reference,hash(access),typeId,room.id,guestId,start,end,adults,children,rules.auto_confirm?'confirmed':'pending',q.quoted_total,notes);
  result={token:access,reference};db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 return result;
}
const reservationByToken = access => one(`SELECT r.*,g.name guest_name,g.email guest_email,g.phone guest_phone,t.name type_name,rm.number room_number
 FROM reservations r JOIN guests g ON g.id=r.guest_id JOIN accommodation_types t ON t.id=r.type_id JOIN rooms rm ON rm.id=r.room_id
 WHERE r.token_hash=?`,hash(access));
function requestService(access,b) {
 if(!featureOn('guest_services'))fail(409,'Guest service requests are currently unavailable');
 const reservation=reservationByToken(access);if(!reservation)fail(404,'Reservation not found');
 if(!['confirmed','checked_in','pending'].includes(reservation.status))fail(409,'Service requests unavailable for this reservation');
 const serviceId=b.service_id==null?null:id(b.service_id);
 const service=serviceId?row('services',serviceId):null;if(serviceId&&(!service||!service.active))fail(400,'Invalid service');
 const title=text(b.title??service?.name,'title',120,true),message=text(b.message??'','message',3000);
 const requestId=Number(run('INSERT INTO service_requests(reservation_id,service_id,title,message) VALUES(?,?,?,?)',reservation.id,serviceId,title,message).lastInsertRowid);
 return row('service_requests',requestId);
}
async function api(req,res,url) {
 const p=url.pathname,method=req.method;
 if(method==='GET'&&p==='/api/public/site')return respond(res,200,publicSite());
 if(method==='GET'&&p==='/api/public/availability') {
  if(!featureOn('public_booking'))fail(409,'Online reservations are currently paused');
  const start=url.searchParams.get('checkIn')??url.searchParams.get('check_in');const end=url.searchParams.get('checkOut')??url.searchParams.get('check_out');
  const adults=Number(url.searchParams.get('adults')??1),children=Number(url.searchParams.get('children')??0);
  return respond(res,200,{types:availableTypes(start,end,adults,children)});
 }
 if(method==='POST'&&p==='/api/public/reservations'){limit(req,res,'reservation',12);return respond(res,201,reserve(await body(req)));}
 let m=p.match(/^\/api\/public\/reservations\/([A-Za-z0-9_-]+)$/);
 if(method==='GET'&&m){const x=reservationByToken(m[1]);if(!x)fail(404,'Reservation not found');return respond(res,200,{reservation:exposeReservation(x),requests:all('SELECT sr.id,sr.service_id,sr.title,sr.message,sr.status,sr.created_at,sr.updated_at,s.name service_name FROM service_requests sr LEFT JOIN services s ON s.id=sr.service_id WHERE sr.reservation_id=? ORDER BY sr.id DESC',x.id).map(exposePublicRequest)});}
 m=p.match(/^\/api\/public\/reservations\/([A-Za-z0-9_-]+)\/requests$/);
 if(method==='POST'&&m){limit(req,res,'service-request',30);return respond(res,201,{request:requestService(m[1],await body(req))});}
 if(method==='GET'&&p==='/api/admin/session')return respond(res,200,{user:currentUser(req),setupRequired:!one('SELECT id FROM admins LIMIT 1')});
 if(method==='POST'&&p==='/api/admin/setup') {
  limit(req,res,'setup',5);
  const b=await body(req);const email=text(b.email,'email',254,true).toLowerCase(),password=text(b.password,'password',200,true);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<12)fail(400,'Valid email and password of at least 12 characters required');
  const configured=process.env.ADMIN_SETUP_KEY;
  if(configured){
   const supplied=b.setup_key??b.setupKey;
   if(typeof supplied!=='string'||hash(supplied)!==hash(configured))fail(403,'Invalid setup key');
  }else if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))fail(403,'ADMIN_SETUP_KEY is required for remote setup');
  db.exec('BEGIN IMMEDIATE');try{if(one('SELECT id FROM admins LIMIT 1'))fail(409,'Setup already completed');
   const salt=randomBytes(16).toString('hex'),digest=scryptSync(password,salt,64).toString('hex');
   const adminId=Number(run('INSERT INTO admins(email,password_hash) VALUES(?,?)',email,`${salt}:${digest}`).lastInsertRowid);
   const session=createSession({id:adminId,email});db.exec('COMMIT');return respond(res,201,session);
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 if(method==='POST'&&p==='/api/admin/login') {
  limit(req,res,'login',10);
  const b=await body(req);const email=text(b.email,'email',254,true).toLowerCase(),password=text(b.password,'password',200,true);
  const admin=one('SELECT * FROM admins WHERE email=?',email);
  const [salt,stored]=(admin?.password_hash??'0:0').split(':');let valid=false;
  try{const actual=scryptSync(password,salt,64),expected=Buffer.from(stored,'hex');valid=actual.length===expected.length&&timingSafeEqual(actual,expected);}catch{}
   if(!valid||!admin.active)fail(401,'Invalid credentials');return respond(res,200,createSession(admin));
 }
 if(method==='POST'&&p==='/api/admin/logout') {const value=bearer(req);if(value)run('DELETE FROM sessions WHERE token_hash=?',hash(value));return respond(res,200,{ok:true});}
 const admin=requireAdmin(req);
 if(method==='POST'&&p==='/api/admin/media'){requireRoles(admin,['revenue']);if(!featureOn('media_library'))fail(409,'Media uploads are disabled');return respond(res,201,await uploadMedia(admin,await body(req,7*1024*1024+1024)));}
 if(method==='GET'&&p==='/api/admin/state')return respond(res,200,adminState(admin));
 if(method==='GET'&&p==='/api/admin/overview')return respond(res,200,adminState(admin).overview);
 if(method==='GET'&&p==='/api/admin/audit'){requireLeadership(admin);return respond(res,200,{audit:all('SELECT a.id,a.action,a.entity,a.entity_id,a.before_json,a.after_json,a.created_at,u.email admin_email FROM audit_log a JOIN admins u ON u.id=a.admin_id ORDER BY a.id DESC LIMIT 200')});}
 if(method==='GET'&&p==='/api/admin/settings')return respond(res,200,settings());
 if(method==='PUT'&&p==='/api/admin/settings'){requireLeadership(admin);const b=await body(req);const after=atomic(()=>{const before=settings(),next=updateSettings(b);audit(admin,'update','settings',1,before,next);return next;});return respond(res,200,after);}
 if(method==='PUT'&&p==='/api/admin/booking-rules'){requireLeadership(admin);const b=await body(req);const after=atomic(()=>{const before=bookingRules(),next=updateBookingRules(b);audit(admin,'update','booking_rules',1,before,next);return next;});return respond(res,200,after);}
 m=p.match(/^\/api\/admin\/features\/([a-z0-9_-]+)$/);
 if(method==='PUT'&&m){requireLeadership(admin);const key=m[1],b=await body(req),before=one('SELECT * FROM feature_flags WHERE key=?',key);if(!before)fail(404,'Feature not found');const enabled=boolean(b.enabled,'enabled');const after=atomic(()=>{run('UPDATE feature_flags SET enabled=? WHERE key=?',enabled,key);const next=one('SELECT * FROM feature_flags WHERE key=?',key);audit(admin,'toggle','feature',null,before,next);return {...next,enabled:bool(next.enabled)};});return respond(res,200,after);}
 if(method==='POST'&&p==='/api/admin/staff'){
  requireLeadership(admin);const b=await body(req),email=text(b.email,'email',254,true).toLowerCase(),password=text(b.password,'password',200,true),displayName=text(b.display_name??'','display name',160);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<12)fail(400,'Valid email and password of at least 12 characters required');
  const role=text(b.role??'viewer','role',30,true);if(!['owner','manager','front_office','housekeeping','concierge','engineering','revenue','viewer'].includes(role))fail(400,'Invalid role');
  if(admin.role!=='owner'&&role==='owner')fail(403,'Only an owner can grant owner access');
  const result=atomic(()=>{const salt=randomBytes(16).toString('hex'),digest=scryptSync(password,salt,64).toString('hex');let staffId;try{staffId=Number(run('INSERT INTO admins(email,password_hash,display_name,role) VALUES(?,?,?,?)',email,`${salt}:${digest}`,displayName,role).lastInsertRowid);}catch(e){if(e.message.includes('UNIQUE'))fail(409,'A staff account with this email already exists');throw e;}const next=one('SELECT id,email,display_name,role,active,created_at FROM admins WHERE id=?',staffId);audit(admin,'create','staff',staffId,null,next);return {...next,active:bool(next.active)};});return respond(res,201,result);
 }
 m=p.match(/^\/api\/admin\/staff\/(\d+)$/);
 if(method==='PUT'&&m){
  requireLeadership(admin);const staffId=id(m[1]),b=await body(req),before=one('SELECT id,email,display_name,role,active,created_at FROM admins WHERE id=?',staffId);if(!before)fail(404,'Staff account not found');const data={};
  if(admin.role!=='owner'&&before.role==='owner')fail(403,'Only an owner can manage owner accounts');
  for(const [k,v] of Object.entries(b)){if(k==='display_name')data.display_name=text(v,'display name',160);else if(k==='role'){data.role=text(v,'role',30,true);if(!['owner','manager','front_office','housekeeping','concierge','engineering','revenue','viewer'].includes(data.role))fail(400,'Invalid role');}else if(k==='active')data.active=boolean(v,'active');else if(k==='password'){const password=text(v,'password',200,true);if(password.length<12)fail(400,'Password must be at least 12 characters');const salt=randomBytes(16).toString('hex');data.password_hash=`${salt}:${scryptSync(password,salt,64).toString('hex')}`;}else fail(400,`Unknown field ${k}`);}
  if(admin.role!=='owner'&&data.role==='owner')fail(403,'Only an owner can grant owner access');
  if(staffId===admin.id&&(data.active===0||data.role&&!['owner','manager'].includes(data.role)))fail(409,'You cannot remove your own leadership access');
  if(before.role==='owner'&&(data.active===0||data.role&&data.role!=='owner')&&one("SELECT COUNT(*) count FROM admins WHERE role='owner' AND active=1 AND id!=?",staffId).count===0)fail(409,'At least one active owner is required');
  const after=atomic(()=>{const keys=Object.keys(data);if(keys.length)run(`UPDATE admins SET ${keys.map(k=>`${k}=?`).join(',')} WHERE id=?`,...keys.map(k=>data[k]),staffId);if(data.active===0||data.password_hash)run('DELETE FROM sessions WHERE admin_id=?',staffId);const next=one('SELECT id,email,display_name,role,active,created_at FROM admins WHERE id=?',staffId);audit(admin,'update','staff',staffId,before,next);return {...next,active:bool(next.active)};});return respond(res,200,after);
 }
 m=p.match(/^\/api\/admin\/guests\/(\d+)$/);
 if(method==='PUT'&&m) {
   requireRoles(admin,['front_office']);
  const guestId=id(m[1]),b=await body(req),data={};
  for(const [k,v] of Object.entries(b)){
   if(k==='name')data.name=text(v,'name',160,true);
   else if(k==='email'){data.email=text(v,'email',254,true).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))fail(400,'Invalid email');}
   else if(k==='phone')data.phone=text(v,'phone',50);
   else fail(400,`Unknown field ${k}`);
  }
  const after=atomic(()=>{const before=row('guests',guestId);if(!before)fail(404,'Guest not found');
   const keys=Object.keys(data);if(keys.length)run(`UPDATE guests SET ${keys.map(k=>`${k}=?`).join(',')} WHERE id=?`,...keys.map(k=>data[k]),guestId);
   const next=row('guests',guestId);audit(admin,'update','guest',guestId,before,next);return next;});return respond(res,200,after);
 }
 m=p.match(/^\/api\/admin\/(types|rooms|rates|blocks|services|departments|housekeeping|maintenance|preferences|sections)(?:\/(\d+))?$/);
 if(m) {
   const entity=m[1],itemId=m[2]?id(m[2]):null,table=tables[entity];
   const permitted={types:['revenue'],rooms:['revenue'],rates:['revenue'],blocks:['revenue','front_office'],services:['concierge'],departments:[],housekeeping:['housekeeping','front_office'],maintenance:['engineering','front_office'],preferences:['front_office','concierge'],sections:['revenue']}[entity];
   const restrictedPreference=b=>entity==='preferences'&&!['owner','manager'].includes(admin.role)&&(b?.sensitivity==='private'||itemId&&row(table,itemId)?.sensitivity==='private');
   if(method==='GET'){
    requireRoles(admin,permitted);
    if(entity==='preferences'&&!['owner','manager'].includes(admin.role))fail(403,'Leadership access required for private preferences');
    if(!itemId){const xs=all(`SELECT * FROM ${table} ORDER BY id DESC`);return respond(res,200,{[entity]:xs.map(x=>entity==='types'?exposeType(x):entity==='services'?exposeService(x):x)});}
    const x=row(table,itemId);if(!x)fail(404,'Record not found');return respond(res,200,entity==='types'?exposeType(x):entity==='services'?exposeService(x):x);
   }
   if(method==='POST'&&!itemId){requireRoles(admin,permitted);const b=await body(req);if(restrictedPreference(b))fail(403,'Private preferences require leadership access');const after=atomic(()=>{const next=saveEntity(entity,b);audit(admin,'create',entity,next.id,null,next);return next;});return respond(res,201,after);}
   if(method==='PUT'&&itemId){requireRoles(admin,permitted);const b=await body(req);if(restrictedPreference(b))fail(403,'Private preferences require leadership access');const after=atomic(()=>{const before=row(table,itemId),next=saveEntity(entity,b,itemId);audit(admin,'update',entity,itemId,before,next);return next;});return respond(res,200,after);}
   if(method==='DELETE'&&itemId){requireRoles(admin,permitted);if(restrictedPreference())fail(403,'Private preferences require leadership access');atomic(()=>{const before=row(table,itemId);deleteEntity(entity,itemId);audit(admin,'delete',entity,itemId,before,null);});return respond(res,200,{ok:true});}
 }
 if(method==='GET'&&p==='/api/admin/reservations'){requireRoles(admin,['front_office','concierge']);return respond(res,200,{reservations:adminState(admin).reservations});}
 m=p.match(/^\/api\/admin\/reservations\/(\d+)$/);
 if(method==='PUT'&&m) {
   requireRoles(admin,['front_office']);
   const itemId=id(m[1]),b=await body(req);
   for(const key of Object.keys(b))if(!['status','room_id','check_in','check_out','adults','children','notes'].includes(key))fail(400,`Unknown field ${key}`);
   const after=atomic(()=>{const x=row('reservations',itemId);if(!x)fail(404,'Reservation not found');const data={};
    if('status' in b){const status=text(b.status,'status',30,true);if(!['pending','confirmed','checked_in','checked_out','cancelled','no_show'].includes(status))fail(400,'Invalid status');const transitions={pending:['confirmed','cancelled','no_show'],confirmed:['checked_in','cancelled','no_show'],checked_in:['checked_out'],checked_out:[],cancelled:[],no_show:[]};if(status!==x.status&&!transitions[x.status].includes(status))fail(409,'Invalid reservation status transition');data.status=status;}
    const start='check_in' in b?date(b.check_in,'check-in'):x.check_in,end='check_out' in b?date(b.check_out,'check-out'):x.check_out;
    const span=dates(start,end,bookingRules().max_stay_nights);const type=row('accommodation_types',x.type_id);
    const adults='adults' in b?integer(b.adults,'adults',1,30):x.adults,children='children' in b?integer(b.children,'children',0,30):x.children;
    if(adults>type.max_adults||children>type.max_children||adults+children>type.max_guests)fail(400,'Party exceeds room capacity');
    const roomId='room_id' in b?id(b.room_id):x.room_id,room=row('rooms',roomId);if(!room||room.type_id!==x.type_id)fail(400,'Room must belong to the reserved accommodation type');
    if(roomId!==x.room_id&&room.status!=='active')fail(409,'Selected room is not active');
    if(one('SELECT id FROM blocks WHERE room_id=? AND start_date<? AND end_date>? LIMIT 1',roomId,span.end,span.start))fail(409,'Selected room is blocked for these dates');
    if(one(`SELECT id FROM maintenance_tickets WHERE room_id=? AND out_of_order=1 AND status NOT IN ('resolved','cancelled') LIMIT 1`,roomId))fail(409,'Selected room is out of order');
    if(one(`SELECT id FROM reservations WHERE room_id=? AND id!=? AND status IN ('pending','confirmed','checked_in') AND check_in<? AND check_out>? LIMIT 1`,roomId,itemId,span.end,span.start))fail(409,'Selected room is already reserved for these dates');
    if(start!==x.check_in||end!==x.check_out){const q=quote(x.type_id,start,end);if(!q)fail(409,'No rate covers the amended stay');data.quoted_total=q.quoted_total;}
    Object.assign(data,{room_id:roomId,check_in:start,check_out:end,adults,children});if('notes' in b)data.notes=text(b.notes??'','notes',3000);
    const keys=Object.keys(data);run(`UPDATE reservations SET ${keys.map(k=>`${k}=?`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=?`,...keys.map(k=>data[k]),itemId);
    const next=reservations().find(y=>y.id===itemId);audit(admin,'update','reservation',itemId,x,next);return next;});return respond(res,200,{reservation:after});
 }
 if(method==='GET'&&p==='/api/admin/requests'){requireRoles(admin,['front_office','concierge']);return respond(res,200,{requests:requests()});}
 m=p.match(/^\/api\/admin\/requests\/(\d+)$/);
 if(method==='PUT'&&m) {
   requireRoles(admin,['front_office','concierge']);
   const itemId=id(m[1]),b=await body(req),x=row('service_requests',itemId);if(!x)fail(404,'Request not found');
   const data={};
   for(const [k,v] of Object.entries(b)){
    if(k==='status'){data.status=text(v,'status',30,true);if(!['open','in_progress','completed','cancelled'].includes(data.status))fail(400,'Invalid status');}
    else if(k==='priority'){data.priority=text(v,'priority',20,true);if(!['low','normal','high','urgent'].includes(data.priority))fail(400,'Invalid priority');}
    else if(k==='department_id'){data.department_id=v==null?null:id(v);if(data.department_id&&!row('departments',data.department_id))fail(400,'Unknown department');}
    else if(k==='assigned_to')data.assigned_to=text(v,'assigned to',160);
    else if(k==='requested_for')data.requested_for=v?dateTime(v,'requested for'):null;
    else if(k==='internal_notes')data.internal_notes=text(v,'internal notes',3000);
    else fail(400,`Unknown field ${k}`);
   }
   if(!Object.keys(data).length)fail(400,'No changes supplied');
   if(data.status==='completed')data.completed_at=x.completed_at||new Date().toISOString();
   else if('status' in data)data.completed_at=null;
   const after=atomic(()=>{const keys=Object.keys(data);run(`UPDATE service_requests SET ${keys.map(k=>`${k}=?`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=?`,...keys.map(k=>data[k]),itemId);
    const next=requests().find(y=>y.id===itemId);audit(admin,'status','service_request',itemId,x,next);return next;});return respond(res,200,{request:after});
 }
 fail(404,'Endpoint not found');
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2'};
async function staticFile(req,res,url) {
 if(req.method!=='GET'&&req.method!=='HEAD')fail(405,'Method not allowed');
 let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{fail(400,'Invalid path');}
 if(pathname.includes('\0')||pathname.includes('\\'))fail(400,'Invalid path');
 let file;
 if(pathname.startsWith('/uploads/')){
  file=path.resolve(uploadDir,pathname.slice('/uploads/'.length));
  if(file===uploadDir||!file.startsWith(uploadDir+path.sep))fail(403,'Forbidden');
  try{if(!(await stat(file)).isFile())throw new Error('Not a file');}catch{fail(404,'File not found');}
 }else{
  const candidate=path.resolve(publicDir,`.${pathname}`);
  if(candidate!==publicDir&&!candidate.startsWith(publicDir+path.sep))fail(403,'Forbidden');
  file=candidate;
  try{if(!(await stat(file)).isFile())throw new Error('Not a file');}
  catch{if(path.extname(pathname)||pathname.startsWith('/demo-media/'))fail(404,'File not found');file=path.join(publicDir,'index.html');}
 }
 try{const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);}
 catch{fail(404,'Page not found');}
}
const server=http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://localhost');
  if(process.env.CORS_ORIGIN){res.setHeader('Access-Control-Allow-Origin',process.env.CORS_ORIGIN);res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}}
  if(req.method==='GET'&&url.pathname==='/health')respond(res,200,{status:'ok'});
  else if(url.pathname.startsWith('/api/'))await api(req,res,url);else await staticFile(req,res,url);
 }catch(e){if(e instanceof ApiError)respond(res,e.status,{error:e.message,...(e.details?{details:e.details}:{})});else {console.error(e);respond(res,500,{error:'Internal server error'});}}
});
const port=Number(process.env.PORT||3000);server.listen(port,()=>console.log(`Hotel management listening on http://localhost:${port}`));
let shuttingDown=false;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{
 if(shuttingDown)return;shuttingDown=true;console.log(`Received ${signal}; closing server and SQLite cleanly.`);
 const timer=setTimeout(()=>process.exit(1),10000);timer.unref();
 server.close(()=>{try{db.close();}finally{clearTimeout(timer);process.exit(0);}});
});
