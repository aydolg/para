/*
  Portföy Terminali Pro Max · Dark Nebula Edition
  app.js (Enhanced) — Özellikler: #9 Uyarılar, #8 Ağırlık, #7 Modal, #6 Otomatik Yenileme,
                                 #5 Gelişmiş Arama & Sıralama, #3 Trend Sparkline
  Not: Ek CSS gerektiren stiller JS ile enjekte edilir; index.html / style.css değişikliği GEREKMEZ.
*/

/* =========================================================
   0) Sabitler & Global Durum
========================================================= */
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLPFVZn0j8Ygu914QDGRCGKsVy88gWjdk7DFi-jWiydmqYsdGUE4hEAb-R_IBzQmtFZwoMJFcN6rlD/pub?gid=1050165900&single=true&output=csv";
let DATA = [];
let ACTIVE = "ALL";
let CACHE = {};                 // filtre-cache
let ALERTS = {};                // { [urun]: { guncel:null|num, kz:null|num, dailyPerc:null|num } }
let SORT_KEY = "default";      // default | kzDesc | kzAsc | maliyetDesc | guncelDesc | nameAZ | nameZA
let FILTER_KZ = "all";         // all | pos | neg
let AUTO_REFRESH = { enabled:false, ms:60000, timer:null };

/* =========================================================
   1) Yardımcılar
========================================================= */
const qs = (s, r=document) => r.querySelector(s);
const qsa = (s, r=document) => [...r.querySelectorAll(s)];
const cleanStr = (s) => s ? s.toString().trim().replace(/\s+/g, " ") : "";
function toNumber(v){ if (!v) return 0; const s = v.toString().replace(/[^\d,\.-]/g,"").replace(/\./g,"").replace(",","."); return parseFloat(s)||0; }
const formatTRY = (n) => n.toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺";
const sum = (arr, key) => arr.reduce((a,b) => a + (b[key] ?? 0), 0);
function showToast(msg){ const t = qs("#toast"); if(!t) return; t.textContent = msg; t.hidden=false; setTimeout(()=> t.hidden=true, 2500); }
function lsGet(key, def){ try{ return JSON.parse(localStorage.getItem(key)) ?? def }catch{ return def } }
function lsSet(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)) }catch{} }

/* =========================================================
   2) CSS Enjeksiyonu (Modal + Toolbar + Highlight)
========================================================= */
(function injectStyles(){
  if (qs('#dynamic-styles')) return;
  const css = `
    .toolbar{display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:8px var(--gutter); margin:4px 0 10px}
    .toolbar .card{padding:8px; display:flex; gap:8px; align-items:center; justify-content:space-between}
    .toolbar-group{display:flex; gap:8px; align-items:center; flex-wrap:wrap}
    .toolbar select, .toolbar input[type="checkbox"], .toolbar input[type="number"]{
      background:linear-gradient(180deg, rgba(17,24,39,.85), rgba(17,24,39,.65)); color:var(--text);
      border:1px solid var(--line); border-radius:8px; padding:6px 8px; font-size:12px;
    }
    .modal{position:fixed; inset:0; display:none; align-items:center; justify-content:center; z-index:200}
    .modal.active{display:flex}
    .modal-backdrop{position:absolute; inset:0; backdrop-filter:blur(calc(var(--blur) * .9)); background:rgba(8,14,26,.6)}
    .modal-card{position:relative; width:min(720px, 92vw); border-radius:14px; padding:14px; z-index:1;
      background:linear-gradient(145deg, rgba(17,24,39,.95), rgba(14,20,34,.85)); border:1px solid var(--line);
      box-shadow:0 10px 40px rgba(0,0,0,.55), 0 0 60px rgba(59,130,246,.18)}
    .modal-header{display:flex; justify-content:space-between; align-items:center; margin-bottom:10px}
    .modal-title{font-weight:800; font-size:16px}
    .modal-close{cursor:pointer; border:0; background:transparent; color:#cfe2ff; font-size:20px}
    .modal-grid{display:grid; grid-template-columns:1fr 1fr; gap:12px}
    .stat{border:1px solid var(--line); border-radius:12px; padding:10px; background:linear-gradient(145deg, rgba(17,24,39,.9), rgba(17,24,39,.7))}
    .spark{width:100%; height:64px; display:block}
    .alert-form{display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:10px}
    .alert-form label{font-size:11px; opacity:.7; display:block; margin-bottom:4px}
    .alert-form input{width:100%; padding:8px; border-radius:8px; border:1px solid var(--line); background:rgba(17,24,39,.8); color:var(--text)}
    .modal-actions{display:flex; gap:8px; justify-content:flex-end; margin-top:10px}
    .btn{padding:8px 10px; border-radius:9px; border:1px solid var(--line); background:rgba(17,24,39,.85); color:var(--text); cursor:pointer}
    .btn.primary{border-color:rgba(59,130,246,.6); box-shadow:0 0 12px rgba(59,130,246,.25)}
    .weight-badge{font-size:11px; opacity:.85; color:#cfe2ff}
    .alert-pulse{animation:alertPulse 1.4s ease-in-out infinite}
    @keyframes alertPulse{0%{box-shadow:0 0 0 0 rgba(239,68,68,.35)}70%{box-shadow:0 0 0 12px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
    @media (max-width:640px){ .modal-grid{grid-template-columns:1fr} .alert-form{grid-template-columns:1fr} .toolbar{grid-template-columns:1fr} }
  `;
  const style = document.createElement('style'); style.id='dynamic-styles'; style.textContent = css; document.head.appendChild(style);
})();

/* =========================================================
   3) Başlat — Veri Yükle
========================================================= */
async function init(){
  try{
    const resp = await fetch(`${CSV_URL}&cache=${Date.now()}`);
    const text = await resp.text();
    const parsed = Papa.parse(text.trim(), { header:true, skipEmptyLines:true });
    DATA = parsed.data.map(row => {
      const o = {}; for (let k in row){ o[k] = (k==="urun"||k==="tur") ? cleanStr(row[k]) : toNumber(row[k]); }
      return o;
    }).filter(x => x.urun && x.toplamYatirim > 0);
    if (!DATA.length) throw new Error("CSV boş geldi");

    ALERTS = lsGet('alerts', {});
    ensureUI();
    qs('#loader')?.setAttribute('hidden','');
    renderAll();
    if (AUTO_REFRESH.enabled) startAutoRefresh();
  }catch(err){
    console.warn('Veri yüklenemedi, yeniden deneniyor...', err);
    showToast('Veri yüklenemedi, tekrar deneniyor...');
    setTimeout(init, 1200);
  }
}

/* =========================================================
   4) UI Kurulumu (Toolbar + Modal)
========================================================= */
function ensureUI(){
  // Toolbar
  if (!qs('.toolbar')){
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    toolbar.innerHTML = `
      <div class="card">
        <div class="toolbar-group">
          <label for="sort-select" class="small">Sıralama</label>
          <select id="sort-select">
            <option value="default">Varsayılan</option>
            <option value="kzDesc">K/Z (yüksek → düşük)</option>
            <option value="kzAsc">K/Z (düşük → yüksek)</option>
            <option value="maliyetDesc">Maliyet (yüksek → düşük)</option>
            <option value="guncelDesc">Güncel (yüksek → düşük)</option>
            <option value="nameAZ">A→Z</option>
            <option value="nameZA">Z→A</option>
          </select>
        </div>
        <div class="toolbar-group">
          <label class="small">Filtre</label>
          <label style="display:inline-flex; gap:6px; align-items:center"><input type="radio" name="kzfilter" value="all" checked> Hepsi</label>
          <label style="display:inline-flex; gap:6px; align-items:center"><input type="radio" name="kzfilter" value="pos"> K/Z (+)</label>
          <label style="display:inline-flex; gap:6px; align-items:center"><input type="radio" name="kzfilter" value="neg"> K/Z (−)</label>
        </div>
      </div>
      <div class="card">
        <div class="toolbar-group">
          <label class="small" for="arate">Oto Yenile</label>
          <label style="display:inline-flex; gap:6px; align-items:center"><input id="autoref" type="checkbox"> Aç</label>
          <select id="arate">
            <option value="30000">30 sn</option>
            <option value="60000" selected>1 dk</option>
            <option value="300000">5 dk</option>
          </select>
        </div>
        <div class="toolbar-group"><span class="small">İpucu:</span> <span style="font-size:12px;opacity:.75">Uyarı tanımları ürün detay modaldan yapılır.</span></div>
      </div>`;
    const content = qs('.content-section');
    content?.insertBefore(toolbar, content.firstChild);

    // Events
    qs('#sort-select').onchange = (e)=>{ SORT_KEY = e.target.value; renderAll(); };
    qsa('input[name="kzfilter"]').forEach(inp => inp.onchange = (e)=>{ FILTER_KZ = e.target.value; renderAll(); });
    qs('#autoref').onchange = (e)=>{ AUTO_REFRESH.enabled = !!e.target.checked; AUTO_REFRESH.enabled ? startAutoRefresh() : stopAutoRefresh(); };
    qs('#arate').onchange = (e)=>{ AUTO_REFRESH.ms = +e.target.value; if (AUTO_REFRESH.enabled){ startAutoRefresh(); } };
  }

  // Modal
  if (!qs('#modal')){
    const modal = document.createElement('div');
    modal.id = 'modal'; modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-card">
        <div class="modal-header">
          <div class="modal-title">Detay</div>
          <button class="modal-close" aria-label="Kapat">×</button>
        </div>
        <div class="modal-body"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e)=>{ if (e.target.classList.contains('modal-backdrop') || e.target.classList.contains('modal-close')) closeModal(); });
  }
}

function openModal(item){
  const modal = qs('#modal');
  const body = modal.querySelector('.modal-body');
  const portSum = sum(DATA, 'guncelDeger');
  const kz = item.guncelDeger - item.toplamYatirim;
  const weight = portSum ? ((item.guncelDeger/portSum)*100).toFixed(1) : 0;
  const alerts = ALERTS[item.urun] || { guncel:null, kz:null, dailyPerc:null };

  body.innerHTML = `
    <div class="modal-grid">
      <div class="stat">
        <div class="small">Ürün</div>
        <div class="big" style="font-size:16px">${item.urun}</div>
        <div class="small" style="margin-top:6px">Tür: ${item.tur} · Ağırlık: <b>${weight}%</b></div>
      </div>
      <div class="stat">
        <div class="small">Değerler</div>
        <div class="big">Güncel: ${formatTRY(item.guncelDeger)}</div>
        <div class="big">Maliyet: ${formatTRY(item.toplamYatirim)}</div>
        <div class="big ${kz>=0?"pos":"neg"}">K/Z: ${formatTRY(kz)}</div>
      </div>
      <div class="stat" style="grid-column:1 / -1">
        <div class="small">Trend (Günlük • Haftalık • Aylık)</div>
        <canvas class="spark" width="640" height="64"></canvas>
      </div>
      <div class="stat" style="grid-column:1 / -1">
        <div class="small">Uyarı Tanımları</div>
        <div class="alert-form">
          <div><label>Güncel ≥</label><input id="al-guncel" type="number" placeholder="Örn: 100000" value="${alerts.guncel ?? ''}"></div>
          <div><label>K/Z ≥</label><input id="al-kz" type="number" placeholder="Örn: 5000" value="${alerts.kz ?? ''}"></div>
          <div><label>Günlük % ≥</label><input id="al-dp" type="number" placeholder="Örn: 2.5" step="0.1" value="${alerts.dailyPerc ?? ''}"></div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="al-remove">Uyarıları Sil</button>
          <button class="btn primary" id="al-save">Kaydet</button>
        </div>
      </div>
    </div>`;

  // Sparkline çiz
  const series = [item.gunluk||0, item.haftalik||0, item.aylik||0];
  drawSparkline(body.querySelector('.spark'), series);

  // Alert actions
  body.querySelector('#al-save').onclick = ()=>{
    const g = toNumber(qs('#al-guncel', body)?.value);
    const k = toNumber(qs('#al-kz', body)?.value);
    const d = parseFloat(qs('#al-dp', body)?.value);
    ALERTS[item.urun] = {
      guncel: isNaN(g)||g<=0 ? null : g,
      kz:     isNaN(k)||k<=0 ? null : k,
      dailyPerc: isNaN(d)||d<=0 ? null : d
    };
    lsSet('alerts', ALERTS);
    showToast('Uyarılar kaydedildi');
  };
  body.querySelector('#al-remove').onclick = ()=>{
    delete ALERTS[item.urun]; lsSet('alerts', ALERTS); showToast('Uyarılar silindi');
  };

  modal.classList.add('active');
}
function closeModal(){ qs('#modal')?.classList.remove('active'); }

function drawSparkline(canvas, data){
  if (!canvas) return; const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height, pad=6;
  const min = Math.min(...data, 0), max = Math.max(...data, 1);
  const range = max - min || 1; ctx.clearRect(0,0,w,h);
  // grid fade
  ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(0,h-1,w,1);
  // line
  ctx.strokeStyle = 'rgba(96,165,250,.95)'; ctx.lineWidth = 2; ctx.beginPath();
  data.forEach((v,i)=>{
    const x = pad + i * ((w-2*pad)/(data.length-1 || 1));
    const y = h - pad - ((v - min)/range) * (h-2*pad);
    i?ctx.lineTo(x,y):ctx.moveTo(x,y);
  });
  ctx.stroke();
}

/* =========================================================
   5) Render Akışı (Özet, Türler, Periyotlar, Detay, Ticker)
========================================================= */
function renderAll(){
  const key = `filter:${ACTIVE}`;
  let d = CACHE[key];
  if (!d){ d = ACTIVE === 'ALL' ? DATA : DATA.filter(x => x.tur.toUpperCase() === ACTIVE.toUpperCase()); CACHE[key] = d; }
  renderSummary(d); renderTypes(); renderPeriods(d); renderDetails(d); renderTicker(DATA); checkAlerts();
}

function renderSummary(d){
  const t = sum(d, 'toplamYatirim'), g = sum(d,'guncelDeger'), kz = g - t; const p = t?((kz/t)*100).toFixed(1):0;
  qs('#summary').innerHTML = `
    <div class="card"><div class="small">Maliyet</div><div class="big">${formatTRY(t)}</div></div>
    <div class="card"><div class="small">Güncel</div><div class="big">${formatTRY(g)}</div></div>
    <div class="card ${kz>=0?'pos':'neg'}"><div class="small">Toplam K/Z</div><div class="big">${kz>=0?'+':''}${p}%</div><div class="small" style="font-size:11px;margin-top:4px;">${formatTRY(kz)}</div></div>`;
}

function renderTypes(){
  const turlar = [...new Set(DATA.map(x=>x.tur))];
  let h = `<div class="card type-card ${ACTIVE==='ALL'?'active':''}" data-type="ALL">GENEL<br><span class="big">HEPSİ</span></div>`;
  turlar.forEach(tur=>{
    const sub = DATA.filter(x=>x.tur===tur); const kz = sum(sub,'guncelDeger') - sum(sub,'toplamYatirim');
    h += `<div class="card type-card ${ACTIVE===tur?'active':''}" data-type="${tur}"><div class="small">${tur.toUpperCase()}</div><div class="big ${kz>=0?'pos':'neg'}" style="font-size:12px">${formatTRY(kz)}</div></div>`;
  });
  const types = qs('#types'); types.innerHTML = h; [...types.children].forEach(el=> el.onclick = ()=>{ ACTIVE = el.dataset.type; renderAll(); });
}

function renderPeriods(d){
  const periods = [["Günlük","gunluk"],["Haftalık","haftalik"],["Aylık","aylik"],["3 Ay","ucAylik"],["6 Ay","altiAylik"],["1 Yıl","birYillik"]];
  const guncel = sum(d,'guncelDeger'); let h='';
  periods.forEach(([label,key])=>{ const degisim = sum(d,key); const onceki = guncel - degisim; const perc = onceki?((degisim/onceki)*100).toFixed(1):0;
    h += `<div class="card ${degisim>=0?'pos':'neg'}"><div class="small">${label}</div><div class="big">${formatTRY(degisim)} <span style="font-size:11px">(${degisim>=0?'+':''}${perc}%)</span></div></div>`; });
  qs('#periods').innerHTML = h;
}

function applySortAndFilter(arr){
  let out = [...arr];
  // filter by KZ
  if (FILTER_KZ !== 'all'){
    out = out.filter(it => (it.guncelDeger - it.toplamYatirim) >= 0 === (FILTER_KZ==='pos'));
  }
  // sort
  const cmp = {
    'kzDesc': (a,b)=> (b.guncelDeger-b.toplamYatirim) - (a.guncelDeger-a.toplamYatirim),
    'kzAsc':  (a,b)=> (a.guncelDeger-a.toplamYatirim) - (b.guncelDeger-b.toplamYatirim),
    'maliyetDesc': (a,b)=> b.toplamYatirim - a.toplamYatirim,
    'guncelDesc':  (a,b)=> b.guncelDeger - a.guncelDeger,
    'nameAZ': (a,b)=> a.urun.localeCompare(b.urun,'tr'),
    'nameZA': (a,b)=> b.urun.localeCompare(a.urun,'tr'),
  }[SORT_KEY];
  if (cmp) out.sort(cmp);
  return out;
}

function renderDetails(d){
  const list = qs('#detail-list');
  const portSum = sum(DATA, 'guncelDeger');
  const applied = applySortAndFilter(d);
  qs('#detail-title').textContent = ACTIVE==='ALL' ? '📦 TÜM ÜRÜNLER' : `📦 ${ACTIVE.toUpperCase()} DETAYLARI`;
  let h='';
  applied.forEach((item, idx)=>{
    const kz = item.guncelDeger - item.toplamYatirim; const weight = portSum?((item.guncelDeger/portSum)*100).toFixed(1):0;
    h += `<div class="detail-item" data-idx="${idx}" data-urun="${item.urun}">
      <div class="detail-info">
        <div>${item.urun} <span class="weight-badge">· %${weight}</span></div>
        <div>Maliyet: ${formatTRY(item.toplamYatirim)}</div>
      </div>
      <div class="detail-values">
        <div class="detail-val">${formatTRY(item.guncelDeger)}</div>
        <div class="detail-perc ${kz>=0?'pos':'neg'}">${formatTRY(kz)}</div>
      </div>
    </div>`;
  });
  list.innerHTML = h;
  // click handlers
  qsa('.detail-item', list).forEach((el)=>{
    el.onclick = ()=>{ const urun = el.dataset.urun; const item = applied.find(x=>x.urun===urun); if (item) openModal(item); };
  });
}

function renderTicker(list){
  let h=''; list.forEach(d=>{ const degisim=d.gunluk; const onceki=d.guncelDeger-degisim; const perc= onceki?((degisim/onceki)*100).toFixed(2):0;
    h += `<div class="ticker-item" style="color:${degisim>=0?'var(--pos)':'var(--neg)'}">${d.urun} %${degisim>=0?'+':''}${perc}</div>`; });
  qs('#ticker-content').innerHTML = h + h;
}

/* =========================================================
   6) Arama
========================================================= */
qs('#search')?.addEventListener('input', e=>{
  const q = e.target.value.toLowerCase(); const items = qsa('.detail-item');
  requestAnimationFrame(()=>{ items.forEach(it=>{ it.style.display = it.textContent.toLowerCase().includes(q) ? '' : 'none'; }); });
});

/* =========================================================
   7) Uyarı Sistemi (Local)
========================================================= */
function checkAlerts(){
  const portSum = sum(DATA,'guncelDeger');
  qsa('.detail-item').forEach(el=> el.classList.remove('alert-pulse'));
  DATA.forEach(item=>{
    const a = ALERTS[item.urun]; if (!a) return;
    const kz = item.guncelDeger - item.toplamYatirim;
    const dailyPerc = (item.guncelDeger - item.gunluk) ? (item.gunluk / (item.guncelDeger - item.gunluk))*100 : 0;
    let hit = false;
    if (a.guncel!=null && item.guncelDeger >= a.guncel) hit = true;
    if (a.kz!=null && kz >= a.kz) hit = true;
    if (a.dailyPerc!=null && dailyPerc >= a.dailyPerc) hit = true;
    if (hit){
      const el = qsa('.detail-item').find(n=> n.dataset.urun===item.urun);
      if (el){ el.classList.add('alert-pulse'); }
      showToast(`${item.urun}: uyarı koşulu tetiklendi`);
    }
  });
}

/* =========================================================
   8) Otomatik Yenileme
========================================================= */
function startAutoRefresh(){ stopAutoRefresh(); if (!AUTO_REFRESH.ms) AUTO_REFRESH.ms = 60000; AUTO_REFRESH.timer = setInterval(async()=>{
  try{ const resp = await fetch(`${CSV_URL}&cache=${Date.now()}`); const text = await resp.text(); const parsed = Papa.parse(text.trim(), { header:true, skipEmptyLines:true });
    DATA = parsed.data.map(row=>{ const o={}; for(let k in row){ o[k] = (k==='urun'||k==='tur')? cleanStr(row[k]) : toNumber(row[k]); } return o; }).filter(x=> x.urun && x.toplamYatirim>0);
    CACHE = {}; renderAll(); showToast('Veriler yenilendi');
  }catch(e){ console.warn('Yenileme başarısız', e); }
}, AUTO_REFRESH.ms); }
function stopAutoRefresh(){ if (AUTO_REFRESH.timer){ clearInterval(AUTO_REFRESH.timer); AUTO_REFRESH.timer=null; } }

/* =========================================================
   9) Başlat
========================================================= */
init();
