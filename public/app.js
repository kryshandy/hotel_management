const root = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
const state = {
  site: null, availability: null, admin: null, user: null, audit: null,
  token: localStorage.getItem('hotel_admin_token') || '',
  adminTab: 'overview', search: { checkIn: '', checkOut: '', adults: 2, children: 0 },
  selectedType: null, loading: false, calendarStart: todayDate()
};
function todayDate() { return new Date().toLocaleDateString('en-CA'); }

const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const safeUrl = value => { if(!value || !String(value).trim()) return ''; try { const u = new URL(value, location.origin); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
const money = amount => { const c = state.site?.settings?.currency || state.admin?.settings?.currency || 'USD'; try { return new Intl.NumberFormat(undefined, {style:'currency',currency:c,maximumFractionDigits:0}).format(Number(amount)); } catch { return `${Number(amount).toLocaleString()} ${c}`; } };
const dateText = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : '—';
const nights = (a,b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`))/86400000);
const today = () => new Date().toLocaleDateString('en-CA');
const icon = (name,size=20) => {
  const paths = {
    arrow:'<path d="M4 12h16m-7-7 7 7-7 7"/>', calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
    bed:'<path d="M3 11V6m18 5V6M3 17v3m18-3v3M3 14h18v3H3zM5 14v-3a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3M6 9V7h5v2m2 0V7h5v2"/>',
    users:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2H3zm14-15a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 5v1h-4"/>',
    menu:'<path d="M4 7h16M4 12h16M4 17h16"/>', close:'<path d="M5 5l14 14M19 5 5 19"/>', check:'<path d="m4 12 5 5L20 6"/>',
    key:'<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9 2 2-2 2 1 1-3 3-2-2-4 4"/>', spark:'<path d="m12 2 2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2z"/>',
    grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    edit:'<path d="M4 20h4L20 8l-4-4L4 16v4zM14 6l4 4"/>', trash:'<path d="M4 7h16M9 7V4h6v3m-9 0 1 14h10l1-14M10 11v6m4-6v6"/>',
    chevron:'<path d="m9 18 6-6-6-6"/>', phone:'<path d="M5 3h4l1 5-2 2a15 15 0 0 0 6 6l2-2 5 1v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
    pin:'<path d="M12 22s8-7 8-13a8 8 0 1 0-16 0c0 6 8 13 8 13z"/><circle cx="12" cy="9" r="2"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
};

async function api(path, options={}) {
  const headers = {'Content-Type':'application/json',...(state.token ? {'Authorization':`Bearer ${state.token}`} : {})};
  const res = await fetch(`/api${path}`, {headers, ...options});
  let data = {}; try { data = await res.json(); } catch { /* handled below */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
const send = (path, body, method='POST') => api(path,{method,body:JSON.stringify(body)});
function toast(message, bad=false) { toastEl.textContent = message; toastEl.className = `show ${bad?'bad':''}`; clearTimeout(toastEl.timer); toastEl.timer=setTimeout(()=>toastEl.className='',4400); }
function setBusy(b) { state.loading=b; document.body.classList.toggle('busy',b); }
function applyTheme(settings={}) { for (const [key,css] of [['primary_color','--navy'],['accent_color','--aqua']]) { if (/^#[0-9a-f]{6}$/i.test(settings[key] || '')) document.documentElement.style.setProperty(css,settings[key]); } document.title = `${settings.hotel_name || 'Hotel'} | Stays`; }
function navigate(path) { history.pushState({},'',path); if(path!=='/book') state.selectedType=null; render(); scrollTo({top:0,behavior:'smooth'}); }
window.addEventListener('popstate',render);

function siteHeader() {
  const s=state.site?.settings || {};
  const logo=safeUrl(s.logo_url);
  return `${s.demo_mode?'<div class="demo-banner"><strong>Demo property</strong><span>Imagery, rooms and XAF rates are illustrative. Online reservations are paused.</span></div>':''}<header class="site-header"><a href="/" class="brand" data-link><span class="brand-mark">${logo?`<img src="${esc(logo)}" alt=""/>`:icon('spark',19)}</span><span>${esc(s.hotel_name || 'Your hotel')}</span></a><nav id="public-nav"><a href="#stays" data-scroll>Stay</a><a href="#about" data-scroll>About</a><a href="#contact" data-scroll>Contact</a></nav><div class="header-actions"><a href="/admin" data-link class="staff-link">Staff access</a><button class="menu-button" data-action="toggle-menu" aria-label="Toggle menu">${icon('menu')}</button></div></header>`;
}
function searchPanel() {
  return `<form id="search-form" class="search-panel"><label><span>Check in</span><input name="checkIn" type="date" min="${today()}" value="${esc(state.search.checkIn)}" required></label><label><span>Check out</span><input name="checkOut" type="date" min="${esc(state.search.checkIn || today())}" value="${esc(state.search.checkOut)}" required></label><label><span>Adults</span><select name="adults">${Array.from({length:8},(_,i)=>`<option value="${i+1}" ${Number(state.search.adults)===i+1?'selected':''}>${i+1}</option>`).join('')}</select></label><label><span>Children</span><select name="children">${Array.from({length:9},(_,i)=>`<option value="${i}" ${Number(state.search.children)===i?'selected':''}>${i}</option>`).join('')}</select></label><button class="button primary" type="submit">Find a stay ${icon('arrow',17)}</button></form>`;
}
function typeCard(t, searched=false) {
  const image=safeUrl(t.image_url || (Array.isArray(t.images)?t.images[0]:''));
  const available=Number(t.availableCount ?? t.available_count ?? 0);
  const price=t.effectivePrice ?? t.effective_price;
  const reservable=!!state.site?.settings?.booking_enabled&&!state.site?.settings?.demo_mode;
  return `<article class="stay-card"><div class="stay-image">${image?`<img src="${esc(image)}" alt="${esc(t.name)}" loading="lazy">`:`<div class="image-placeholder">${icon('bed',42)}<span>Image to be added</span></div>`}</div><div class="stay-info"><div class="eyebrow">Accommodation</div><h3>${esc(t.name)}</h3><p>${esc(t.description || 'Details will be available soon.')}</p><div class="stay-meta"><span>${icon('bed',18)} ${esc(t.bed_summary || 'Bed details pending')}</span><span>${icon('users',18)} Up to ${esc(t.max_guests || t.max_adults || '—')} guests</span>${t.size_sqm?`<span>${esc(t.size_sqm)} m²</span>`:''}</div><div class="card-foot"><div>${searched ? (available>0 ? `<strong>${price!=null?money(price):'Rate on request'}</strong><small>per night · ${available} available</small>` : `<strong>Unavailable</strong><small>Try other dates</small>`) : `<strong>Explore this stay</strong><small>Search dates for rates</small>`}</div><button class="button ${searched&&available>0&&reservable?'primary':'outline'}" data-action="type" data-id="${t.id}" ${searched&&available===0?'disabled':''}>${searched&&reservable?'Select stay':'View details'} ${icon('arrow',16)}</button></div></div></article>`;
}
function homePage() {
  const s=state.site?.settings || {}, types=state.availability?.types ?? state.site?.types ?? [];
  const hero=safeUrl(s.hero_image_url);
  const searched=!!state.availability;
  return `${siteHeader()}<main><section class="hero ${hero?'has-hero':''}" ${hero?`style="--hero-image:url('${esc(hero)}')"`:''}><div class="hero-inner"><div class="eyebrow light">A stay, thoughtfully arranged</div><h1>${esc(s.tagline || 'Your next stay starts here.')}</h1><p>${esc(s.description || 'Explore our accommodation and choose the dates that work for you.')}</p><div class="hero-line"><span></span><span>${esc([s.city,s.country].filter(Boolean).join(', ') || 'Welcome')}</span></div></div></section><section class="search-wrap" aria-label="Search availability"><div class="search-heading"><span>${icon('calendar',19)} Plan your stay</span><span>Real availability, clearly shown</span></div>${searchPanel()}</section><section id="stays" class="section stays-section"><div class="section-heading"><div><div class="eyebrow">Rooms & suites</div><h2>${searched?'Available for your dates':'Find your kind of stay'}</h2></div><p>${searched?`${dateText(state.search.checkIn)} — ${dateText(state.search.checkOut)} · ${nights(state.search.checkIn,state.search.checkOut)} night${nights(state.search.checkIn,state.search.checkOut)===1?'':'s'}`:'Each space has its own way of welcoming you.'}</p></div>${types.length?`<div class="stay-grid">${types.map(t=>typeCard(t,searched)).join('')}</div>`:`<div class="empty guest-empty">${icon('bed',34)}<h3>${searched?'No stays found for these dates':'Accommodation is being prepared'}</h3><p>${searched?'Choose other dates or change your guest count.':'Room details and availability will appear here once the hotel completes setup.'}</p>${searched?`<button class="text-button" data-action="clear-search">Show all accommodation ${icon('arrow',16)}</button>`:''}</div>`}</section><section id="about" class="about-section"><div class="about-label">The property</div><div><h2>${esc(s.hotel_name || 'A place to arrive.')}</h2><p>${esc(s.about || 'More about this property will be available soon.')}</p></div><div class="about-detail"><span>${icon('clock',19)} Check in ${esc(s.check_in_time || '—')}</span><span>${icon('clock',19)} Check out ${esc(s.check_out_time || '—')}</span></div></section></main><footer id="contact" class="site-footer"><div><strong>${esc(s.hotel_name || 'Your hotel')}</strong><p>${esc(s.footer_text || s.description || '')}</p></div><div><span>Contact</span>${s.address?`<p>${icon('pin',16)} ${esc([s.address,s.city,s.country].filter(Boolean).join(', '))}</p>`:''}${s.contact_phone?`<a href="tel:${esc(s.contact_phone)}">${icon('phone',16)} ${esc(s.contact_phone)}</a>`:''}${s.contact_email?`<a href="mailto:${esc(s.contact_email)}">${esc(s.contact_email)}</a>`:''}</div><div><a href="/admin" data-link>Staff sign in</a></div></footer>${state.selectedType?typeDrawer(state.selectedType):''}`;
}
function typeDrawer(t) {
  const price=t.effectivePrice??t.effective_price;
  const amenities=Array.isArray(t.amenities)?t.amenities:String(t.amenities||'').split(',').map(x=>x.trim()).filter(Boolean);
  return `<div class="drawer-backdrop" data-action="close-drawer"><aside class="type-drawer" role="dialog" aria-modal="true" aria-label="${esc(t.name)}" onclick="event.stopPropagation()"><button class="icon-button drawer-close" data-action="close-drawer" aria-label="Close">${icon('close')}</button><div class="eyebrow">Your stay</div><h2>${esc(t.name)}</h2><p>${esc(t.description || '')}</p><div class="detail-list"><div><span>Sleeping arrangements</span><strong>${esc(t.bed_summary || 'Contact the hotel')}</strong></div><div><span>Capacity</span><strong>${esc(t.max_adults)} adults · ${esc(t.max_children)} children</strong></div>${t.size_sqm?`<div><span>Floor area</span><strong>${esc(t.size_sqm)} m²</strong></div>`:''}<div><span>Nightly rate</span><strong>${price!=null?money(price):'Search dates for pricing'}</strong></div></div>${amenities.length?`<h3>Amenities</h3><div class="amenities">${amenities.map(a=>`<span>${icon('check',15)} ${esc(a)}</span>`).join('')}</div>`:''}${state.site?.settings?.policies?`<div class="policy-note"><strong>Stay policies</strong><p>${esc(state.site.settings.policies)}</p></div>`:''}${(!state.site?.settings?.booking_enabled||state.site?.settings?.demo_mode)?'<div class="policy-note"><strong>Reservations paused</strong><p>This property is available for preview only. An administrator can enable bookings when the property is ready.</p></div>':state.availability?`<button class="button primary full" data-action="book" data-id="${t.id}">Continue to reservation ${icon('arrow',17)}</button>`:`<button class="button primary full" data-action="focus-search">Search dates ${icon('arrow',17)}</button>`}</aside></div>`;
}
function bookingPage(t) {
  const s=state.site?.settings || {}, price=t.effectivePrice??t.effective_price, n=nights(state.search.checkIn,state.search.checkOut), total=t.quoted_total??(price!=null?price*n:null);
  return `${siteHeader()}<main class="booking-page"><button class="back-link" data-action="back-home">← Back to stays</button><div class="booking-layout"><div><div class="eyebrow">Reservation details</div><h1>Make this stay yours.</h1><p class="lead">Tell us who is arriving. The hotel will confirm your reservation; payment is not collected here.</p><form id="booking-form" class="form-card"><h2>Lead guest</h2><div class="form-grid"><label>Full name <input name="name" autocomplete="name" required maxlength="120"></label><label>Email <input name="email" type="email" autocomplete="email" required maxlength="200"></label><label>Phone <input name="phone" type="tel" autocomplete="tel" required maxlength="50"></label><label class="wide">Requests or arrival notes <textarea name="notes" rows="4" maxlength="1000" placeholder="Optional"></textarea></label></div><p class="fine-print">By requesting this reservation, you agree to the property's stay policies. No payment details are requested.</p><button class="button primary" type="submit">Request reservation ${icon('arrow',18)}</button></form></div><aside class="summary-card"><div class="eyebrow">Your selection</div><h2>${esc(t.name)}</h2><p>${esc(t.bed_summary || '')}</p><div class="summary-row"><span>Check in</span><strong>${dateText(state.search.checkIn)}</strong></div><div class="summary-row"><span>Check out</span><strong>${dateText(state.search.checkOut)}</strong></div><div class="summary-row"><span>Guests</span><strong>${state.search.adults} adults${Number(state.search.children)?`, ${state.search.children} children`:''}</strong></div><div class="summary-row"><span>Length of stay</span><strong>${n} night${n===1?'':'s'}</strong></div><div class="summary-total"><span>Estimated stay total</span><strong>${total!=null?money(total):'Hotel will confirm'}</strong></div><small>Room rate estimate only. No online payment.</small>${s.policies?`<div class="policy-note"><strong>Stay policies</strong><p>${esc(s.policies)}</p></div>`:''}</aside></div></main>`;
}
function reservationPage(data, requests=[]) {
  const r=data.reservation || data, s=state.site?.settings || {};
  return `${siteHeader()}<main class="reservation-page"><div class="eyebrow">Your reservation</div><h1>Stay details</h1><p class="lead">Keep this private link to return to your stay and request room services.</p><div class="reservation-layout"><div class="form-card"><div class="reservation-top"><div><span class="eyebrow">Reference</span><h2>${esc(r.reference)}</h2></div><span class="status ${esc(r.status)}">${esc(r.status || 'pending')}</span></div><div class="summary-row"><span>Accommodation</span><strong>${esc(r.type_name || r.name || 'Room')}</strong></div><div class="summary-row"><span>Dates</span><strong>${dateText(r.check_in)} — ${dateText(r.check_out)}</strong></div><div class="summary-row"><span>Lead guest</span><strong>${esc(r.guest_name || '')}</strong></div><div class="summary-row"><span>Guests</span><strong>${esc(r.adults)} adults · ${esc(r.children)} children</strong></div><div class="summary-row"><span>Estimated total</span><strong>${r.quoted_total!=null?money(r.quoted_total):'Hotel will confirm'}</strong></div><p class="fine-print">No payment has been taken through this site.</p></div><div class="form-card"><h2>Request a service</h2><p>Send a request linked to your stay. The hotel team will update its status here.</p><form id="request-form"><label>Service <select name="serviceId"><option value="">Other request</option>${(state.site?.services||[]).filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label><label>What do you need? <input name="title" maxlength="120" required placeholder="e.g. Extra towels"></label><label>Details <textarea name="message" maxlength="1000" rows="3" required></textarea></label><button class="button primary" type="submit">Send request ${icon('arrow',17)}</button></form></div></div><section class="request-history"><h2>Your requests</h2>${requests.length?requests.map(x=>`<div class="request-item"><div><strong>${esc(x.title)}</strong><p>${esc(x.message)}</p></div><span class="status ${esc(x.status)}">${esc(x.status)}</span></div>`).join(''):`<div class="empty"><p>No service requests yet.</p></div>`}</section><div class="contact-strip">Questions about your stay? ${s.contact_email?`<a href="mailto:${esc(s.contact_email)}">${esc(s.contact_email)}</a>`:''} ${s.contact_phone?`<a href="tel:${esc(s.contact_phone)}">${esc(s.contact_phone)}</a>`:''}</div></main>`;
}

async function loadSite() { state.site=await api('/public/site'); applyTheme(state.site.settings); }
async function searchAvailability() {
  const p=new URLSearchParams(state.search); const data=await api(`/public/availability?${p}`); state.availability=data; state.selectedType=null; render(); document.querySelector('#stays')?.scrollIntoView({behavior:'smooth'});
}
async function loadAdmin() { const data=await api('/admin/state'); state.admin=data; applyTheme(data.settings); }
function adminShell(content) {
  const items=[['overview','Overview','grid'],['site','Site & brand','spark'],['types','Accommodation','bed'],['rooms','Rooms & capacity','key'],['calendar','Availability calendar','calendar'],['rates','Rates','calendar'],['blocks','Availability blocks','calendar'],['reservations','Reservations','users'],['guests','Guests','users'],['services','Service catalog','spark'],['requests','Service requests','phone'],['audit','Activity log','clock']];
  const s=state.admin?.settings||state.site?.settings||{};
  return `<div class="admin-app"><aside class="admin-sidebar"><a class="admin-brand" href="/admin" data-link><span class="brand-mark">${icon('spark',18)}</span><span>${esc(s.hotel_name||'Hotel console')}<small>Property workspace</small></span></a><nav>${items.map(([key,label,glyph])=>`<button class="side-link ${state.adminTab===key?'active':''}" data-action="admin-tab" data-tab="${key}">${icon(glyph,18)}<span>${label}</span></button>`).join('')}</nav><div class="sidebar-bottom"><a href="/" data-link>View guest site ${icon('arrow',15)}</a><button data-action="logout">Sign out</button></div></aside><div class="admin-main"><header class="admin-top"><button class="menu-button admin-menu" data-action="toggle-admin-menu" aria-label="Toggle navigation">${icon('menu')}</button><div><span class="eyebrow">Property management</span><h1>${esc(items.find(i=>i[0]===state.adminTab)?.[1]||'Overview')}</h1></div><div class="admin-profile"><span>${esc(state.user?.email||'Administrator')}</span><span class="avatar">${esc((state.user?.email||'A').charAt(0).toUpperCase())}</span></div></header><div class="admin-content">${content}</div></div></div>`;
}
function adminOverview() {
  const a=state.admin, counts=[['Room types',a.types?.length||0,'types'],['Physical rooms',a.rooms?.length||0,'rooms'],['Reservations',a.reservations?.length||0,'reservations'],['Open requests',(a.requests||[]).filter(x=>!['completed','cancelled'].includes(x.status)).length,'requests']];
  const ready=!!a.settings?.hotel_name && a.types?.length && a.rooms?.length && a.rates?.length;
  return `<div class="welcome-banner"><div><div class="eyebrow">Your workspace</div><h2>${ready?'Your property at a glance.':'Let’s get your property ready.'}</h2><p>${ready?'Manage your rooms, reservations and guest requests from one place.':'Add your hotel details, accommodation, rooms and rates to open online reservations.'}</p></div><a href="/" data-link class="button light">View guest site ${icon('arrow',16)}</a></div><div class="stat-grid">${counts.map(([label,value,tab])=>`<button class="stat-card" data-action="admin-tab" data-tab="${tab}"><span>${esc(label)}</span><strong>${value}</strong><small>Open ${esc(label.toLowerCase())} ${icon('arrow',14)}</small></button>`).join('')}</div><div class="admin-two-col"><section class="panel"><div class="panel-head"><div><div class="eyebrow">Setup</div><h2>Launch checklist</h2></div></div><div class="checklist">${[['Add your property name and contact details',!!a.settings?.hotel_name,'site'],['Create accommodation types',!!a.types?.length,'types'],['Add physical rooms',!!a.rooms?.length,'rooms'],['Set nightly rates',!!a.rates?.length,'rates'],['Add guest services',!!a.services?.length,'services']].map(([label,done,tab])=>`<button data-action="admin-tab" data-tab="${tab}"><span class="check-icon ${done?'done':''}">${done?icon('check',15):''}</span><span>${esc(label)}</span>${icon('chevron',17)}</button>`).join('')}</div></section><section class="panel"><div class="panel-head"><div><div class="eyebrow">Recent activity</div><h2>Reservations</h2></div><button class="text-button" data-action="admin-tab" data-tab="reservations">View all ${icon('arrow',15)}</button></div>${(a.reservations||[]).length?`<div class="activity-list">${a.reservations.slice(0,5).map(r=>`<div><span class="activity-icon">${icon('calendar',18)}</span><span><strong>${esc(r.guest_name||r.reference)}</strong><small>${dateText(r.check_in)} — ${dateText(r.check_out)}</small></span><span class="status ${esc(r.status)}">${esc(r.status)}</span></div>`).join('')}</div>`:`<div class="empty compact">Reservations will appear here as guests book online.</div>`}</section></div>`;
}
function field(label,name,value='',type='text',opts={}) {
  const attrs=`name="${name}" ${opts.required?'required':''} ${opts.min!=null?`min="${opts.min}"`:''} ${opts.max!=null?`max="${opts.max}"`:''} ${opts.minlength!=null?`minlength="${opts.minlength}"`:''}`;
  if (type==='textarea') return `<label class="${opts.wide?'wide':''}">${label}<textarea ${attrs} rows="${opts.rows||4}">${esc(value)}</textarea></label>`;
  if (type==='select') return `<label class="${opts.wide?'wide':''}">${label}<select ${attrs}>${opts.options.map(([v,l])=>`<option value="${esc(v)}" ${String(v)===String(typeof value==='boolean'?Number(value):value)?'selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
  return `<label class="${opts.wide?'wide':''}">${label}<input ${attrs} type="${type}" value="${esc(value)}" ${opts.placeholder?`placeholder="${esc(opts.placeholder)}"`:''}></label>`;
}
const uploadField=(target,label)=>`<label class="upload-field wide">${label}<input type="file" accept="image/png,image/jpeg,image/webp" data-upload-target="${target}"><small>PNG, JPEG or WebP · up to 5 MB</small></label>`;
function settingsForm() {
  const s=state.admin.settings||{};
  const fields=[
    ['Property name','hotel_name','text',{required:true}],['Tagline','tagline','text',{wide:true}],['Introduction','description','textarea',{wide:true}],
    ['Stay navigation label','nav_stays_label','text',{}],['About navigation label','nav_about_label','text',{}],['Contact navigation label','nav_contact_label','text',{}],
    ['Availability search heading','search_heading','text',{wide:true}],['Accommodation heading','stays_heading','text',{wide:true}],['Accommodation introduction','stays_intro','text',{wide:true}],
    ['About section heading','about_heading','text',{wide:true}],['Reservation introduction','booking_intro','textarea',{wide:true}],
    ['Show about section','show_about','select',{options:[[1,'Show'],[0,'Hide']]}],['Show contact footer','show_contact','select',{options:[[1,'Show'],[0,'Hide']]}],
    ['Online reservations','booking_enabled','select',{options:[[1,'Open'],[0,'Paused']]}],['Demo property label','demo_mode','select',{options:[[1,'Show demo notice'],[0,'Hide demo notice']]}],
    ['Logo URL','logo_url','url',{wide:true}],['Hero image URL','hero_image_url','url',{wide:true}],['Primary color','primary_color','color',{}],['Accent color','accent_color','color',{}],
    ['Contact email','contact_email','email',{}],['Contact phone','contact_phone','tel',{}],['Street address','address','text',{wide:true}],['City','city','text',{}],['Country','country','text',{}],
    ['Currency (ISO code)','currency','text',{}],['Time zone','timezone','text',{}],['Check-in time','check_in_time','time',{}],['Check-out time','check_out_time','time',{}],
    ['About the property','about','textarea',{wide:true,rows:6}],['Stay policies','policies','textarea',{wide:true,rows:6}],['Footer text','footer_text','textarea',{wide:true}]
  ];
  return `<div class="section-intro"><p>Every change here appears on the guest site. Add your own copy and photographs so visitors see the real property.</p></div><form id="settings-form" class="panel edit-panel"><div class="panel-head"><div><div class="eyebrow">Public site</div><h2>Property & appearance</h2></div><button class="button primary" type="submit">Save changes</button></div><div class="form-grid">${fields.map(([label,name,type,opts])=>field(label,name,s[name]??(type==='color'?'#18314a':''),type,opts)+(name==='logo_url'?uploadField('logo_url','Or upload a logo'):'')+(name==='hero_image_url'?uploadField('hero_image_url','Or upload a hero photograph'):'' )).join('')}</div></form>`;
}
const configs={
  types:{title:'Accommodation types',singular:'accommodation type',columns:[['name','Name'],['bed_summary','Beds'],['max_guests','Capacity'],['active','Status']],fields:[['Name','name','text',{required:true}],['URL slug','slug','text',{}],['Description','description','textarea',{wide:true}],['Bed configuration','bed_summary','text',{required:true}],['Max adults','max_adults','number',{required:true,min:1}],['Max children','max_children','number',{min:0}],['Max guests','max_guests','number',{min:1}],['Size (m²)','size_sqm','number',{min:0}],['Amenities (comma separated)','amenities','text',{wide:true}],['Image URL','image_url','url',{wide:true}],['Additional image URLs (comma separated)','images','text',{wide:true}],['Display order','sort_order','number',{min:0}],['Active','active','select',{options:[[1,'Visible'],[0,'Hidden']]}]]},
  rooms:{title:'Physical rooms',singular:'room',columns:[['number','Room'],['type_name','Accommodation'],['floor','Floor'],['status','Status']],fields:[['Room number','number','text',{required:true}],['Accommodation type','type_id','type',{required:true}],['Floor','floor','text',{}],['Status','status','select',{options:[['active','Active'],['maintenance','Maintenance'],['inactive','Inactive']]}],['Staff notes','notes','textarea',{wide:true}]]},
  rates:{title:'Nightly rates',singular:'rate',columns:[['type_name','Accommodation'],['start_date','From'],['end_date','To'],['nightly_price','Nightly price']],fields:[['Accommodation type','type_id','type',{required:true}],['Start date','start_date','date',{required:true}],['End date','end_date','date',{required:true}],['Nightly price','nightly_price','number',{required:true,min:0}],['Minimum nights','min_nights','number',{min:1}]]},
  blocks:{title:'Availability blocks',singular:'block',columns:[['room_number','Room'],['start_date','From'],['end_date','To'],['reason','Reason']],fields:[['Room','room_id','room',{required:true}],['Start date','start_date','date',{required:true}],['End date','end_date','date',{required:true}],['Reason','reason','text',{required:true}]]},
  services:{title:'Guest services',singular:'service',columns:[['name','Service'],['category','Category'],['active','Status']],fields:[['Service name','name','text',{required:true}],['Category','category','text',{}],['Description','description','textarea',{wide:true}],['Display order','sort_order','number',{min:0}],['Active','active','select',{options:[[1,'Available'],[0,'Hidden']]}]]}
};
function configField(label,name,type,opts,value) {
  if (name==='amenities' || name==='images') value=Array.isArray(value)?value.join(', '):value;
  if(type==='type') return field(label,name,value,'select',{...opts,options:[['','Choose accommodation'],...(state.admin.types||[]).map(x=>[x.id,x.name])]});
  if(type==='room') return field(label,name,value,'select',{...opts,options:[['','Choose room'],...(state.admin.rooms||[]).map(x=>[x.id,`${x.number} · ${state.admin.types?.find(t=>t.id===x.type_id)?.name||'Room'}`])]});
  return field(label,name,value,type,opts);
}
function entityTable(key) {
  const c=configs[key], rows=state.admin[key]||[];
  const display=(r,name)=>{
    if(name==='type_name') return state.admin.types?.find(t=>t.id===r.type_id)?.name||'—';
    if(name==='room_number') return state.admin.rooms?.find(room=>room.id===r.room_id)?.number||'—';
    if(name==='active') return `<span class="status ${r.active?'confirmed':'cancelled'}">${r.active?'Active':'Hidden'}</span>`;
    if(name==='nightly_price') return money(r[name]);
    if(['start_date','end_date'].includes(name)) return dateText(r[name]);
    return esc(r[name]??'—');
  };
  return `<div class="section-intro"><p>${({types:'Describe your room categories, bed choices and occupancy limits.',rooms:'Add each physical room to make capacity accurate.',rates:'Rates are displayed to guests as estimates. This app does not collect money.',blocks:'Keep maintenance or private-use rooms out of online availability.',services:'Give guests a clear way to ask for help during their stay.'})[key]}</p><button class="button primary" data-action="add-entity" data-key="${key}">+ Add ${c.singular}</button></div><section class="panel table-panel"><div class="panel-head"><div><div class="eyebrow">${rows.length} total</div><h2>${c.title}</h2></div></div>${rows.length?`<div class="table-scroll"><table><thead><tr>${c.columns.map(([,label])=>`<th>${label}</th>`).join('')}<th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows.map(r=>`<tr>${c.columns.map(([name])=>`<td>${display(r,name)}</td>`).join('')}<td class="row-actions"><button class="icon-button" data-action="edit-entity" data-key="${key}" data-id="${r.id}" aria-label="Edit ${esc(c.singular)}">${icon('edit',17)}</button><button class="icon-button danger" data-action="delete-entity" data-key="${key}" data-id="${r.id}" aria-label="Delete ${esc(c.singular)}">${icon('trash',17)}</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty"><div class="empty-icon">${icon(key==='rooms'?'key':key==='rates'?'calendar':'bed',26)}</div><h3>No ${c.title.toLowerCase()} yet</h3><p>Add your first ${c.singular} to get started.</p><button class="button outline" data-action="add-entity" data-key="${key}">Add ${c.singular}</button></div>`}</section>`;
}
function entityDialog(key,id) {
  const c=configs[key], item=id?state.admin[key].find(x=>String(x.id)===String(id)):{};
  if(id&&!item) return;
  const defaults={max_adults:2,max_children:0,max_guests:2,sort_order:0,active:1,min_nights:1,status:'active'};
  const dialog=document.createElement('dialog'); dialog.className='modal'; dialog.innerHTML=`<form id="entity-form" data-key="${key}" data-id="${id||''}"><div class="modal-head"><div><div class="eyebrow">${id?'Edit':'New'} record</div><h2>${id?'Edit':'Add'} ${c.singular}</h2></div><button type="button" class="icon-button" data-action="close-modal" aria-label="Close">${icon('close')}</button></div><div class="form-grid">${c.fields.map(([label,name,type,opts])=>configField(label,name,type,opts,item[name]??defaults[name]??'')+(name==='image_url'?uploadField('image_url','Or upload a room photograph'):'' )).join('')}</div><div class="modal-actions"><button type="button" class="button outline" data-action="close-modal">Cancel</button><button type="submit" class="button primary">${id?'Save changes':'Add '+c.singular}</button></div></form>`; document.body.append(dialog); dialog.showModal(); dialog.addEventListener('close',()=>dialog.remove());
}
function reservationsView() {
  const rows=state.admin.reservations||[];
  return `<div class="section-intro"><p>Review requests, assign arrivals and track stays. Each stay is tied to real room capacity.</p></div><section class="panel table-panel"><div class="panel-head"><div><div class="eyebrow">${rows.length} total</div><h2>All reservations</h2></div></div>${rows.length?`<div class="table-scroll"><table><thead><tr><th>Reference</th><th>Guest</th><th>Stay</th><th>Accommodation</th><th>Room</th><th>Status</th><th>Update</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.reference)}</strong></td><td>${esc(r.guest_name||'—')}<small>${esc(r.guest_email||'')}</small></td><td>${dateText(r.check_in)}<small>to ${dateText(r.check_out)}</small></td><td>${esc(r.type_name||'—')}</td><td>${esc(r.room_number||'Unassigned')}</td><td><span class="status ${esc(r.status)}">${esc(r.status)}</span></td><td><select class="inline-select" data-action="reservation-status" data-id="${r.id}" aria-label="Update reservation status"><option value="">Change status</option>${['pending','confirmed','checked_in','checked_out','cancelled'].map(x=>`<option value="${x}">${x.replace('_',' ')}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty"><div class="empty-icon">${icon('calendar',27)}</div><h3>No reservations yet</h3><p>Guest reservations will appear here when online booking begins.</p></div>`}</section>`;
}
function requestsView() {
  const rows=state.admin.requests||[];
  return `<div class="section-intro"><p>Respond to guest callouts and keep the request status current.</p></div><section class="panel table-panel"><div class="panel-head"><div><div class="eyebrow">${rows.length} total</div><h2>Guest requests</h2></div></div>${rows.length?`<div class="table-scroll"><table><thead><tr><th>Request</th><th>Reservation</th><th>Details</th><th>Received</th><th>Status</th><th>Update</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.title)}</strong><small>${esc(r.service_name||'Other')}</small></td><td>${esc(r.reservation_reference||'—')}</td><td>${esc(r.message)}</td><td>${r.created_at?new Date(r.created_at).toLocaleString():'—'}</td><td><span class="status ${esc(r.status)}">${esc(r.status)}</span></td><td><select class="inline-select" data-action="request-status" data-id="${r.id}" aria-label="Update request status"><option value="">Change status</option>${['open','in_progress','completed','cancelled'].map(x=>`<option value="${x}">${x.replace('_',' ')}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty"><div class="empty-icon">${icon('phone',27)}</div><h3>No service requests yet</h3><p>Guest requests will appear here during their stay.</p></div>`}</section>`;
}
function guestsView() {
  const rows=state.admin.guests||[];
  return `<div class="section-intro"><p>Guest profiles are created from real reservations and kept private to staff.</p><label class="guest-search">Search guests <input id="guest-search" type="search" placeholder="Name, email or phone"></label></div><section class="panel table-panel"><div class="panel-head"><div><div class="eyebrow">${rows.length} total</div><h2>Guest directory</h2></div></div>${rows.length?`<div class="table-scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Reservations</th><th></th></tr></thead><tbody>${rows.map(g=>`<tr data-guest-search="${esc(`${g.name} ${g.email} ${g.phone}`.toLowerCase())}"><td><strong>${esc(g.name)}</strong></td><td>${esc(g.email)}</td><td>${esc(g.phone||'—')}</td><td>${(state.admin.reservations||[]).filter(r=>r.guest_id===g.id).length}</td><td><button class="icon-button" data-action="edit-guest" data-id="${g.id}" aria-label="Edit ${esc(g.name)}">${icon('edit',17)}</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty"><div class="empty-icon">${icon('users',27)}</div><h3>No guests yet</h3><p>Guest profiles will appear as reservations are made.</p></div>`}</section>`;
}
function guestDialog(id) {
  const g=state.admin.guests.find(x=>String(x.id)===String(id));if(!g)return;
  const dialog=document.createElement('dialog');dialog.className='modal';dialog.innerHTML=`<form id="guest-form" data-id="${g.id}"><div class="modal-head"><div><div class="eyebrow">Guest profile</div><h2>Edit contact details</h2></div><button type="button" class="icon-button" data-action="close-modal" aria-label="Close">${icon('close')}</button></div><div class="form-grid">${field('Full name','name',g.name,'text',{required:true})}${field('Email','email',g.email,'email',{required:true})}${field('Phone','phone',g.phone,'tel',{})}</div><div class="modal-actions"><button type="button" class="button outline" data-action="close-modal">Cancel</button><button class="button primary" type="submit">Save changes</button></div></form>`;document.body.append(dialog);dialog.showModal();dialog.addEventListener('close',()=>dialog.remove());
}
function addDays(date,count) { const d=new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+count); return d.toISOString().slice(0,10); }
function calendarView() {
  const days=Array.from({length:14},(_,i)=>addDays(state.calendarStart,i));
  const rooms=state.admin.rooms||[], reservations=state.admin.reservations||[], blocks=state.admin.blocks||[];
  const cell=(room,day)=>{ const r=reservations.find(x=>x.room_id===room.id&&['pending','confirmed','checked_in'].includes(x.status)&&x.check_in<=day&&x.check_out>day); if(r)return `<span class="calendar-cell booked" title="${esc(r.reference)} · ${esc(r.guest_name||'Guest')}">${esc(r.reference)}</span>`; const b=blocks.find(x=>x.room_id===room.id&&x.start_date<=day&&x.end_date>day); if(b)return `<span class="calendar-cell blocked" title="${esc(b.reason||'Blocked')}">Blocked</span>`; if(room.status!=='active')return `<span class="calendar-cell blocked">${esc(room.status)}</span>`;return `<span class="calendar-cell open" title="Available">·</span>`; };
  return `<div class="section-intro"><p>See room capacity, booked nights and blocked dates together. Check-out days are available for a new arrival.</p><div class="calendar-controls"><button class="button outline" data-action="calendar-shift" data-days="-14" aria-label="Previous two weeks">←</button><strong>${dateText(days[0])} — ${dateText(days[13])}</strong><button class="button outline" data-action="calendar-shift" data-days="14" aria-label="Next two weeks">→</button></div></div><section class="panel table-panel"><div class="calendar-legend"><span><i class="open"></i>Available</span><span><i class="booked"></i>Reserved</span><span><i class="blocked"></i>Blocked or inactive</span></div>${rooms.length?`<div class="table-scroll"><table class="calendar-table"><thead><tr><th>Room</th>${days.map(d=>`<th><span>${new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined,{weekday:'short',timeZone:'UTC'})}</span><strong>${d.slice(8)}</strong></th>`).join('')}</tr></thead><tbody>${rooms.map(room=>`<tr><th><strong>${esc(room.number)}</strong><small>${esc(state.admin.types.find(t=>t.id===room.type_id)?.name||'')}</small></th>${days.map(day=>`<td>${cell(room,day)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:`<div class="empty"><h3>No rooms on the calendar</h3><p>Add your physical rooms first to see live capacity.</p><button class="button outline" data-action="admin-tab" data-tab="rooms">Add rooms</button></div>`}</section>`;
}
function auditView() {
  const rows=state.audit||[];
  return `<div class="section-intro"><p>Recent staff changes to property content, guests, inventory and reservation statuses.</p><button class="button outline" data-action="refresh-audit">Refresh log</button></div><section class="panel table-panel"><div class="panel-head"><div><div class="eyebrow">Recent changes</div><h2>Activity log</h2></div></div>${rows.length?`<div class="table-scroll"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${x.created_at?new Date(x.created_at).toLocaleString():'—'}</td><td>${esc(x.admin_email||x.actor_email||'Administrator')}</td><td>${esc(x.action)}</td><td>${esc(x.entity)} #${esc(x.entity_id)}</td></tr>`).join('')}</tbody></table></div>`:`<div class="empty"><h3>No changes recorded yet</h3><p>Staff actions will appear here as you configure the property.</p></div>`}</section>`;
}
function adminPage() {
  if(!state.user) return authPage();
  if(!state.admin) return loadingPage();
  const content=state.adminTab==='overview'?adminOverview():state.adminTab==='site'?settingsForm():configs[state.adminTab]?entityTable(state.adminTab):state.adminTab==='calendar'?calendarView():state.adminTab==='reservations'?reservationsView():state.adminTab==='guests'?guestsView():state.adminTab==='audit'?auditView():requestsView();
  return adminShell(content);
}
function authPage() {
  const setup=state.site?.setupRequired;
  return `<main class="auth-page"><div class="auth-art"><a href="/" data-link class="brand"><span class="brand-mark">${icon('spark',19)}</span><span>${esc(state.site?.settings?.hotel_name||'Hotel')}</span></a><div><div class="eyebrow light">Property workspace</div><h1>Every stay starts with a well-run house.</h1><p>Manage the details your guests see and the work your team does each day.</p></div><span>Hotel management, made clear.</span></div><div class="auth-form-wrap"><button class="back-link" data-action="back-home">← Guest site</button><form id="auth-form" class="auth-form"><div class="eyebrow">Staff access</div><h2>${setup?'Set up your workspace':'Welcome back'}</h2><p>${setup?'Create the first administrator account for this property. Use a password of at least 12 characters.':'Sign in to manage your property.'}</p>${field('Email','email','','email',{required:true})}${field('Password','password','','password',{required:true,minlength:12})}${setup&&state.site?.setupKeyRequired?field('Setup key','setup_key','','password',{required:true}):''}<button class="button primary full" type="submit">${setup?'Create administrator':'Sign in'} ${icon('arrow',17)}</button></form></div></main>`;
}
function loadingPage() { return `<div class="loading-screen"><span class="brand-mark">${icon('spark')}</span><p>Preparing your workspace…</p></div>`; }
function errorPage(message) { return `${siteHeader()}<main class="error-page"><div class="eyebrow">Stay details</div><h1>We couldn't open this reservation.</h1><p>${esc(message)}</p><a href="/" data-link class="button primary">Return to stays ${icon('arrow',17)}</a></main>`; }
function applySiteCopy() {
  const s=state.site?.settings||{};
  const set=(selector,value)=>{ if(value){const el=root.querySelector(selector);if(el)el.textContent=value;} };
  set('.site-header nav a[href="#stays"]',s.nav_stays_label);
  set('.site-header nav a[href="#about"]',s.nav_about_label);
  set('.site-header nav a[href="#contact"]',s.nav_contact_label);
  set('.search-heading span:first-child',s.search_heading);
  if(!state.availability) set('.stays-section .section-heading h2',s.stays_heading);
  if(!state.availability) set('.stays-section .section-heading p',s.stays_intro);
  set('.about-section h2',s.about_heading);
  set('.booking-page .lead',s.booking_intro);
  if(s.show_about===0 || s.show_about===false){const section=root.querySelector('#about'),link=root.querySelector('.site-header nav a[href="#about"]');if(section)section.style.display='none';if(link)link.style.display='none';}
  if(s.show_contact===0 || s.show_contact===false){const section=root.querySelector('#contact'),link=root.querySelector('.site-header nav a[href="#contact"]');if(section)section.style.display='none';if(link)link.style.display='none';}
}

async function render() {
  const path=location.pathname;
  if(!state.site) { root.innerHTML=loadingPage(); try { await loadSite(); } catch(e) { root.innerHTML=`<main class="error-page"><h1>Unable to load the hotel site</h1><p>${esc(e.message)}</p><button class="button primary" onclick="location.reload()">Try again</button></main>`; return; } }
  if(path.startsWith('/admin')) { root.innerHTML=adminPage(); return; }
  if(path.startsWith('/reservation/')) {
    root.innerHTML=loadingPage(); try { const token=decodeURIComponent(path.split('/')[2]||''); const data=await api(`/public/reservations/${encodeURIComponent(token)}`); root.innerHTML=reservationPage(data,data.requests||[]); } catch(e) { root.innerHTML=errorPage(e.message); } return;
  }
  if(path==='/book' && state.selectedType) { root.innerHTML=state.site.settings.booking_enabled&&!state.site.settings.demo_mode?bookingPage(state.selectedType):errorPage('Online reservations are paused for this property.'); applySiteCopy(); return; }
  root.innerHTML=homePage(); applySiteCopy();
}

document.addEventListener('click', async e => {
  const link=e.target.closest('[data-link]'); if(link) { e.preventDefault(); navigate(link.getAttribute('href')); return; }
  const scroll=e.target.closest('[data-scroll]'); if(scroll) { e.preventDefault(); document.querySelector(scroll.getAttribute('href'))?.scrollIntoView({behavior:'smooth'}); document.querySelector('#public-nav')?.classList.remove('open'); return; }
  const el=e.target.closest('[data-action]'); if(!el) return;
  const act=el.dataset.action;
  try {
    if(act==='toggle-menu') document.querySelector('#public-nav')?.classList.toggle('open');
    if(act==='toggle-admin-menu') document.querySelector('.admin-sidebar')?.classList.toggle('open');
    if(act==='clear-search') { state.availability=null; render(); }
    if(act==='type') { const id=Number(el.dataset.id); state.selectedType=(state.availability?.types||state.site.types).find(x=>Number(x.id)===id); render(); }
    if(act==='close-drawer') { state.selectedType=null; if(location.pathname==='/') render(); else navigate('/'); }
    if(act==='focus-search') { state.selectedType=null; render(); document.querySelector('#search-form')?.scrollIntoView({behavior:'smooth'}); }
    if(act==='book') { state.selectedType=(state.availability?.types||[]).find(x=>Number(x.id)===Number(el.dataset.id)); navigate('/book'); }
    if(act==='back-home') navigate('/');
    if(act==='admin-tab') { state.adminTab=el.dataset.tab; if(state.adminTab==='audit')state.audit=(await api('/admin/audit')).audit; document.querySelector('.admin-sidebar')?.classList.remove('open'); render(); }
    if(act==='refresh-audit') { state.audit=(await api('/admin/audit')).audit; render(); }
    if(act==='calendar-shift') { state.calendarStart=addDays(state.calendarStart,Number(el.dataset.days)); render(); }
    if(act==='add-entity') entityDialog(el.dataset.key);
    if(act==='edit-entity') entityDialog(el.dataset.key,el.dataset.id);
    if(act==='edit-guest') guestDialog(el.dataset.id);
    if(act==='close-modal') el.closest('dialog')?.close();
    if(act==='delete-entity') { const {key,id}=el.dataset; if(confirm(`Delete this ${configs[key].singular}?`)) { await api(`/admin/${key}/${id}`,{method:'DELETE'}); await loadAdmin(); render(); toast('Record deleted.'); } }
    if(act==='logout') { await send('/admin/logout',{}); state.token=''; state.user=null; state.admin=null; localStorage.removeItem('hotel_admin_token'); render(); }
  } catch(err) { toast(err.message,true); }
});

document.addEventListener('change', async e => {
  if(e.target.matches('[data-upload-target]')) {
    const input=e.target,file=input.files?.[0]; if(!file)return;
    if(file.size>5*1024*1024){toast('Choose an image smaller than 5 MB.',true);input.value='';return;}
    try {
      const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read image.'));reader.readAsDataURL(file);});
      const result=await send('/admin/media',{filename:file.name,mime_type:file.type,data_base64:String(dataUrl).split(',')[1]});
      const urlField=input.closest('form')?.querySelector(`[name="${input.dataset.uploadTarget}"]`);if(urlField)urlField.value=result.url;
      toast('Image uploaded. Save the form to publish it.');
    } catch(err){toast(err.message,true);} return;
  }
  if(e.target.name==='checkIn' && e.target.closest('#search-form')) { const end=document.querySelector('[name="checkOut"]'); end.min=e.target.value; if(end.value && end.value<=e.target.value) end.value=''; }
  const el=e.target; if(!['reservation-status','request-status'].includes(el.dataset.action)||!el.value) return;
  try { const key=el.dataset.action==='reservation-status'?'reservations':'requests'; await send(`/admin/${key}/${el.dataset.id}`,{status:el.value},'PUT'); await loadAdmin(); render(); toast('Status updated.'); } catch(err) { toast(err.message,true); el.value=''; }
});
document.addEventListener('input',e=>{if(e.target.id!=='guest-search')return;const q=e.target.value.trim().toLowerCase();for(const row of document.querySelectorAll('[data-guest-search]'))row.hidden=!row.dataset.guestSearch.includes(q);});

document.addEventListener('submit', async e => {
  const form=e.target; if(!form.id) return; e.preventDefault(); if(state.loading) return;
  const values=Object.fromEntries(new FormData(form).entries()); setBusy(true);
  try {
    if(form.id==='search-form') { state.search={...values,adults:Number(values.adults),children:Number(values.children)}; if(values.checkOut<=values.checkIn) throw new Error('Check-out must be after check-in.'); await searchAvailability(); }
    if(form.id==='booking-form') { const t=state.selectedType; if(!t) throw new Error('Choose an accommodation first.'); const result=await send('/public/reservations',{typeId:t.id,checkIn:state.search.checkIn,checkOut:state.search.checkOut,adults:Number(state.search.adults),children:Number(state.search.children),guest:{name:values.name,email:values.email,phone:values.phone},notes:values.notes}); state.selectedType=null; navigate(`/reservation/${encodeURIComponent(result.token)}`); toast(`Reservation ${result.reference} received.`); }
    if(form.id==='request-form') { const token=decodeURIComponent(location.pathname.split('/')[2]); await send(`/public/reservations/${encodeURIComponent(token)}/requests`,{service_id:values.serviceId?Number(values.serviceId):null,title:values.title,message:values.message}); render(); toast('Request sent to the hotel.'); }
    if(form.id==='auth-form') { const path=state.site?.setupRequired?'/admin/setup':'/admin/login'; const result=await send(path,values); state.token=result.token; state.user=result.user; localStorage.setItem('hotel_admin_token',result.token); state.site.setupRequired=false; await loadAdmin(); render(); toast(state.admin?.settings?.hotel_name?'Signed in.':'Workspace created.'); }
    if(form.id==='settings-form') { const payload={...values,show_about:Number(values.show_about),show_contact:Number(values.show_contact),booking_enabled:Number(values.booking_enabled),demo_mode:Number(values.demo_mode)}; await send('/admin/settings',payload,'PUT'); await Promise.all([loadAdmin(),loadSite()]); render(); toast('Property details saved.'); }
    if(form.id==='guest-form') { await send(`/admin/guests/${form.dataset.id}`,values,'PUT'); form.closest('dialog')?.close(); await loadAdmin(); render(); toast('Guest details saved.'); }
    if(form.id==='entity-form') { const key=form.dataset.key,id=form.dataset.id; const payload={...values}; if(key==='types'&&!payload.slug) payload.slug=payload.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); for(const n of ['type_id','room_id','max_adults','max_children','max_guests','size_sqm','sort_order','nightly_price','min_nights','active']) if(payload[n]!==undefined) payload[n]=payload[n]===''?null:Number(payload[n]); if(payload.amenities!==undefined) payload.amenities=payload.amenities.split(',').map(x=>x.trim()).filter(Boolean); if(payload.images!==undefined) payload.images=payload.images.split(',').map(x=>x.trim()).filter(Boolean); await send(`/admin/${key}${id?`/${id}`:''}`,payload,id?'PUT':'POST'); form.closest('dialog')?.close(); await Promise.all([loadAdmin(),loadSite()]); render(); toast(id?'Changes saved.':'Record added.'); }
  } catch(err) { toast(err.message,true); } finally { setBusy(false); }
});

async function start() {
  await render();
  if(state.token) { try { const data=await api('/admin/session'); state.user=data.user; if(state.user) await loadAdmin(); else { state.token=''; localStorage.removeItem('hotel_admin_token'); } } catch { state.token=''; localStorage.removeItem('hotel_admin_token'); } if(location.pathname.startsWith('/admin')) render(); }
}
start();
