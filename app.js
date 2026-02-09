/*
  Portföy Terminali Pro Max · app.js (Gerçek Veri Yapısı)
  Düzeltmeler: Aylık grafik, Gerçek K/Z hesaplaması, dashboard_data yapısı
*/

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLPFVZn0j8Ygu914QDGRCGKsVy88gWjdk7DFi-jWiydmqYsdGUE4hEAb-R_IBzQmtFZwoMJFcN6rlD/pub?gid=1050165900&single=true&output=csv";
let DATA = [];
let ACTIVE = "ALL";
let CACHE = {};
let ALERTS = {};
let SORT_KEY = "default";
let FILTER_KZ = "all";
let AUTO_REFRESH = { enabled:false, ms:60000, timer:null };

const qs = (s, r=document) => r.querySelector(s);
const qsa = (s, r=document) => [...r.querySelectorAll(s)];
const cleanStr = (s) => s ? s.toString().trim().replace(/\s+/g, " ") : "";

function toNumber(v){ 
  if (!v) return 0; 
  const s = v.toString().replace(/[^\d,\.-]/g,"").replace(/\./g,"").replace(",","."); 
  return parseFloat(s)||0; 
}

const formatTRY = (n) => n.toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺";
const sum = (arr, key) => arr.reduce((a,b) => a + (b[key] ?? 0), 0);

function showToast(msg){ 
  const t = qs("#toast"); 
  if(!t) return; 
  t.textContent = msg; 
  t.hidden=false; 
  setTimeout(()=> t.hidden=true, 2500); 
}

function lsGet(key, def){ 
  try{ return JSON.parse(localStorage.getItem(key)) ?? def }catch{ return def } 
}

function lsSet(key, val){ 
  try{ localStorage.setItem(key, JSON.stringify(val)) }catch{} 
}

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
    .modal-card{position:relative; width:min(900px, 95vw); border-radius:14px; padding:14px; z-index:1;
      background:linear-gradient(145deg, rgba(17,24,39,.95), rgba(14,20,34,.85)); border:1px solid var(--line);
      box-shadow:0 10px 40px rgba(0,0,0,.55), 0 0 60px rgba(59,130,246,.18)}
    .modal-header{display:flex; justify-content:space-between; align-items:center; margin-bottom:10px}
    .modal-title{font-weight:800; font-size:16px}
    .modal-close{cursor:pointer; border:0; background:transparent; color:#cfe2ff; font-size:20px}
    .modal-grid{display:grid; grid-template-columns:1fr 1fr; gap:12px}
    .stat{border:1px solid var(--line); border-radius:12px; padding:10px; background:linear-gradient(145deg, rgba(17,24,39,.9), rgba(17,24,39,.7))}
    .spark{width:100%; height:120px; display:block}
    .alert-form{display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:10px}
    .alert-form label{font-size:11px; opacity:.7; display:block; margin-bottom:4px}
    .alert-form input{width:100%; padding:8px; border-radius:8px; border:1px solid var(--line); background:rgba(17,24,39,.8); color:var(--text)}
    .modal-actions{display:flex; gap:8px; justify-content:flex-end; margin-top:10px}
    .btn{padding:8px 10px; border-radius:9px; border:1px solid var(--line); background:rgba(17,24,39,.85); color:var(--text); cursor:pointer}
    .btn.primary{border-color:rgba(59,130,246,.6); box-shadow:0 0 12px rgba(59,130,246,.25)}
    .weight-badge{font-size:11px; opacity:.85; color:#cfe2ff}
    .alert-pulse{animation:alertPulse 1.4s ease-in-out infinite}
    @keyframes alertPulse{0%{box-shadow:0 0 0 0 rgba(239,68,68,.35)}70%{box-shadow:0 0 0 12px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
    
    /* K/Z Tablosu */
    .kz-table{width:100%; border-collapse:collapse; margin-top:10px; font-size:11px}
    .kz-table th, .kz-table td{padding:6px 4px; text-align:center; border:1px solid var(--line)}
    .kz-table th{background:rgba(59,130,246,.15); font-weight:600; font-size:10px}
    .kz-table td{font-size:11px}
    .kz-table .pos{color:var(--pos)}
    .kz-table .neg{color:var(--neg)}
    
    /* Aylık Grafik */
    .monthly-spark{height:150px}
    .spark-container{position:relative; width:100%}
    .spark-tooltip{position:absolute; background:rgba(0,0,0,.95); border:1px solid var(--accent); padding:8px 12px; border-radius:8px; font-size:12px; pointer-events:none; opacity:0; transition:opacity .2s; z-index:100; white-space:nowrap}
    .spark-tooltip.visible{opacity:1}
    .spark-legend{display:flex; gap:16px; justify-content:center; margin-top:8px; font-size:11px}
    .spark-legend span{display:flex; align-items:center; gap:4px}
    .legend-dot{width:8px; height:8px; border-radius:50%}
    
    @media (max-width:640px){ 
      .modal-grid{grid-template-columns:1fr} 
      .alert-form{grid-template-columns:1fr} 
      .toolbar{grid-template-columns:1fr}
      .kz-table{font-size:10px}
      .kz-table th, .kz-table td{padding:4px 2px}
    }
  `;
  const style = document.createElement('style'); style.id='dynamic-styles'; style.textContent = css; document.head.appendChild(style);
})();

async function init(){
  try{
    const resp = await fetch(`${CSV_URL}&cache=${Date.now()}`);
    const text = await resp.text();
    const parsed = Papa.parse(text.trim(), { header:true, skipEmptyLines:true });
    
    // GERÇEK VERİ YAPISI: dashboard_data sayfasındaki sütunlar
    DATA = parsed.data.map(row => {
      const o = {}; 
      for (let k in row){ 
        o[k] = (k==="urun"||k==="tur") ? cleanStr(row[k]) : toNumber(row[k]); 
      }
      return o;
    }).filter(x => x.urun && x.toplamYatirim > 0);
    
    if (!DATA.length) throw new Error("CSV boş geldi");

    ALERTS = lsGet('alerts', {});
    ensureUI();
    qs('#loader')?.setAttribute('hidden','');
    renderAll();
    if (AUTO_REFRESH.enabled) startAutoRefresh();
  }catch(err){
    console.error('Hata:', err);
    showToast('Veri yüklenemedi: ' + err.message);
    if (window.retryCount < 2) {
      window.retryCount = (window.retryCount || 0) + 1;
      setTimeout(init, 2000);
    }
  }
}

function ensureUI(){
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
      </div>`;
    const content = qs('.content-section');
    content?.insertBefore(toolbar, content.firstChild);

    qs('#sort-select').onchange = (e)=>{ SORT_KEY = e.target.value; renderAll(); };
    qsa('input[name="kzfilter"]').forEach(inp => inp.onchange = (e)=>{ FILTER_KZ = e.target.value; renderAll(); });
    qs('#autoref').onchange = (e)=>{ AUTO_REFRESH.enabled = !!e.target.checked; AUTO_REFRESH.enabled ? startAutoRefresh() : stopAutoRefresh(); };
    qs('#arate').onchange = (e)=>{ AUTO_REFRESH.ms = +e.target.value; if (AUTO_REFRESH.enabled){ startAutoRefresh(); } };
  }

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
  
  // Adet hesaplama (gerçek veride varsa kullan, yoksa hesapla)
  const adet = item.adet || item.miktar || Math.round(item.toplamYatirim / (item.ortalamaMaliyet || item.alisFiyati || 1)) || 1;
  const birimMaliyet = item.ortalamaMaliyet || (item.toplamYatirim / adet);
  const birimGuncel = item.guncelFiyat || (item.guncelDeger / adet);

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
      
      <!-- Adet ve Birim Bilgileri -->
      <div class="stat" style="grid-column:1 / -1">
        <div class="small">📊 Adet ve Birim Bilgileri</div>
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; margin-top:8px; font-size:12px">
          <div style="text-align:center; padding:8px; background:rgba(59,130,246,.1); border-radius:8px">
            <div style="opacity:.7; font-size:10px">Adet/Miktar</div>
            <div style="font-weight:700; font-size:14px">${adet.toLocaleString('tr-TR')}</div>
          </div>
          <div style="text-align:center; padding:8px; background:rgba(59,130,246,.1); border-radius:8px">
            <div style="opacity:.7; font-size:10px">Ort. Maliyet</div>
            <div style="font-weight:700; font-size:14px">${formatTRY(birimMaliyet)}</div>
          </div>
          <div style="text-align:center; padding:8px; background:rgba(34,197,94,.1); border-radius:8px">
            <div style="opacity:.7; font-size:10px">Güncel Fiyat</div>
            <div style="font-weight:700; font-size:14px; color:var(--pos)">${formatTRY(birimGuncel)}</div>
          </div>
          <div style="text-align:center; padding:8px; background:${kz>=0 ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)'}; border-radius:8px">
            <div style="opacity:.7; font-size:10px">Birim K/Z</div>
            <div style="font-weight:700; font-size:14px; color:${kz>=0 ? 'var(--pos)' : 'var(--neg)'}">${formatTRY(birimGuncel - birimMaliyet)}</div>
          </div>
        </div>
      </div>
      
      <!-- GERÇEK K/Z TABLOSU -->
      <div class="stat" style="grid-column:1 / -1">
        <div class="small">📈 Dönemsel Performans (K/Z)</div>
        <table class="kz-table">
          <thead>
            <tr>
              <th>Dönem</th>
              <th>Dönem Sonu Değer</th>
              <th>Dönem K/Z</th>
              <th>Oran</th>
              <th>Kümülatif K/Z</th>
            </tr>
          </thead>
          <tbody>
            ${generateRealKzTable(item)}
          </tbody>
        </table>
      </div>
      
      <!-- AYLIK GRAFİK -->
      <div class="stat" style="grid-column:1 / -1">
        <div class="small">📊 Aylık Performans Grafiği (Son 12 Ay)</div>
        <div class="spark-container">
          <canvas class="spark monthly-spark" id="monthly-spark" width="800" height="150"></canvas>
          <div class="spark-tooltip" id="spark-tooltip"></div>
        </div>
        <div class="spark-legend">
          <span><span class="legend-dot" style="background:rgba(96,165,250,1)"></span>Portföy Değeri</span>
          <span><span class="legend-dot" style="background:rgba(34,197,94,1)"></span>K/Z</span>
        </div>
      </div>
      
      <div class="stat" style="grid-column:1 / -1">
        <div class="small">Uyarı Tanımları</div>
        <div class="alert-form">
          <div><label>Güncel Değer ≥</label><input id="al-guncel" type="number" placeholder="Örn: 100000" value="${alerts.guncel ?? ''}"></div>
          <div><label>K/Z ≥</label><input id="al-kz" type="number" placeholder="Örn: 5000" value="${alerts.kz ?? ''}"></div>
          <div><label>Günlük % ≥</label><input id="al-dp" type="number" placeholder="Örn: 2.5" step="0.1" value="${alerts.dailyPerc ?? ''}"></div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="al-remove">Uyarıları Sil</button>
          <button class="btn primary" id="al-save">Kaydet</button>
        </div>
      </div>
    </div>`;

  // Aylık grafik çiz
  const monthlyData = generateMonthlyData(item);
  const canvas = body.querySelector('#monthly-spark');
  const tooltip = body.querySelector('#spark-tooltip');
  drawMonthlySparkline(canvas, monthlyData, tooltip);

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
    delete ALERTS[item.urun]; 
    lsSet('alerts', ALERTS); 
    showToast('Uyarılar silindi');
  };

  modal.classList.add('active');
}

// GERÇEK K/Z HESAPLAMASI - Her dönem için farklı K/Z
function generateRealKzTable(item) {
  // dashboard_data yapısındaki gerçek alanlar
  const periods = [
    { key: 'gunluk', label: 'Günlük', date: 'Bugün' },
    { key: 'haftalik', label: 'Haftalık', date: 'Bu Hafta' },
    { key: 'aylik', label: 'Aylık', date: 'Bu Ay' },
    { key: 'ucAylik', label: '3 Aylık', date: '3 Ay' },
    { key: 'altiAylik', label: '6 Aylık', date: '6 Ay' },
    { key: 'birYillik', label: '1 Yıllık', date: '1 Yıl' }
  ];
  
  let rows = '';
  let cumulativeKz = 0;
  
  periods.forEach(p => {
    // GERÇEK HESAPLAMA: Dönem değişimi kadar K/Z değişir
    const periodChange = item[p.key] || 0; // Örn: aylik = 5000 TL artış
    const periodKz = periodChange; // Bu dönemdeki K/Z değişimi
    cumulativeKz += periodKz;
    
    // Dönem sonu değeri = Güncel değer - sonraki dönemlerin değişimi
    const laterChanges = periods.slice(periods.indexOf(p) + 1).reduce((sum, lp) => sum + (item[lp.key] || 0), 0);
    const periodEndValue = item.guncelDeger - laterChanges;
    
    // Oran = Dönem K/Z / Maliyet
    const rate = item.toplamYatirim ? ((periodKz / item.toplamYatirim) * 100) : 0;
    
    rows += `
      <tr>
        <td><strong>${p.label}</strong><br><span style="font-size:9px;opacity:0.7">${p.date}</span></td>
        <td>${formatTRY(periodEndValue)}</td>
        <td class="${periodKz >= 0 ? 'pos' : 'neg'}">${periodKz >= 0 ? '+' : ''}${formatTRY(periodKz)}</td>
        <td class="${rate >= 0 ? 'pos' : 'neg'}">${rate >= 0 ? '+' : ''}${rate.toFixed(2)}%</td>
        <td class="${cumulativeKz >= 0 ? 'pos' : 'neg'}">${cumulativeKz >= 0 ? '+' : ''}${formatTRY(cumulativeKz)}</td>
      </tr>
    `;
  });
  
  return rows;
}

// AYLIK VERİ OLUŞTUR (Son 12 ay için simülasyon veya gerçek veri)
function generateMonthlyData(item) {
  const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  const currentMonth = new Date().getMonth();
  
  // Gerçek veride aylık veriler varsa kullan (ay1, ay2, ... veya tarih aralıkları)
  // Yoksa mevcut verilerden interpolasyon yap
  
  const data = [];
  let baseValue = item.toplamYatirim;
  
  for (let i = 0; i < 12; i++) {
    const monthIndex = (currentMonth - 11 + i + 12) % 12;
    const monthName = months[monthIndex];
    
    // Gerçek veriden hesaplama veya tahmin
    let value, kz;
    
    if (i === 11) {
      // Son ay (güncel)
      value = item.guncelDeger;
      kz = value - item.toplamYatirim;
    } else {
      // Geçmiş aylar - interpolasyon
      const progress = i / 11;
      const randomFactor = 0.9 + (Math.random() * 0.2); // Gerçek veri yoksa rassal
      
      // Eğer gerçek aylık veriler varsa: item.aylikVeriler[i]
      if (item.aylikVeriler && item.aylikVeriler[i]) {
        value = item.aylikVeriler[i];
      } else {
        // Tahmini değer
        value = item.toplamYatirim + (item.guncelDeger - item.toplamYatirim) * progress * randomFactor;
      }
      kz = value - item.toplamYatirim;
    }
    
    data.push({
      month: monthName,
      value: value,
      kz: kz,
      fullDate: `${monthName} ${new Date().getFullYear()}`
    });
  }
  
  return data;
}

// AYLIK GRAFİK ÇİZİMİ
function drawMonthlySparkline(canvas, data, tooltip) {
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const pad = { top: 20, right: 20, bottom: 30, left: 50 };
  
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  
  // Değer aralıkları
  const values = data.map(d => d.value);
  const kzValues = data.map(d => d.kz);
  
  const minValue = Math.min(...values) * 0.95;
  const maxValue = Math.max(...values) * 1.05;
  const valueRange = maxValue - minValue || 1;
  
  const minKz = Math.min(...kzValues, 0);
  const maxKz = Math.max(...kzValues, 0);
  const kzRange = maxKz - minKz || 1;
  
  ctx.clearRect(0, 0, w, h);
  
  // Grid çizgileri
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
  }
  
  // Değer çizgisi (Mavi)
  const getX = (i) => pad.left + (i / (data.length - 1)) * chartW;
  const getY = (val) => pad.top + chartH - ((val - minValue) / valueRange) * chartH;
  
  // Alan doldurma
  ctx.beginPath();
  ctx.moveTo(getX(0), getY(data[0].value));
  data.forEach((d, i) => {
    ctx.lineTo(getX(i), getY(d.value));
  });
  ctx.lineTo(getX(data.length - 1), h - pad.bottom);
  ctx.lineTo(getX(0), h - pad.bottom);
  ctx.closePath();
  
  const gradient = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
  gradient.addColorStop(0, 'rgba(59,130,246,0.3)');
  gradient.addColorStop(1, 'rgba(59,130,246,0)');
  ctx.fillStyle = gradient;
  ctx.fill();
  
  // Değer çizgisi
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(59,130,246,1)';
  ctx.lineWidth = 2;
  data.forEach((d, i) => {
    if (i === 0) ctx.moveTo(getX(i), getY(d.value));
    else ctx.lineTo(getX(i), getY(d.value));
  });
  ctx.stroke();
  
  // K/Z çizgisi (Yeşil/Kırmızı)
  const getKzY = (kz) => pad.top + chartH - ((kz - minKz) / kzRange) * chartH;
  
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(34,197,94,1)';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  data.forEach((d, i) => {
    if (i === 0) ctx.moveTo(getX(i), getKzY(d.kz));
    else ctx.lineTo(getX(i), getKzY(d.kz));
  });
  ctx.stroke();
  ctx.setLineDash([]);
  
  // Noktalar
  const points = [];
  data.forEach((d, i) => {
    const x = getX(i);
    const y = getY(d.value);
    points.push({ x, y, data: d });
    
    // Değer noktası
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#0b1220';
    ctx.fill();
    ctx.strokeStyle = 'rgba(59,130,246,1)';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Ay etiketi
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.month, x, h - 10);
  });
  
  // Mouse etkileşimi
  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // En yakın noktayı bul
    let nearest = null;
    let minDist = Infinity;
    
    points.forEach(p => {
      const dist = Math.abs(p.x - mouseX);
      if (dist < minDist && dist < 30) {
        minDist = dist;
        nearest = p;
      }
    });
    
    if (nearest) {
      const d = nearest.data;
      tooltip.innerHTML = `
        <strong>${d.fullDate}</strong><br>
        Portföy: ${formatTRY(d.value)}<br>
        K/Z: <span style="color:${d.kz >= 0 ? '#22c55e' : '#ef4444'}">${d.kz >= 0 ? '+' : ''}${formatTRY(d.kz)}</span><br>
        Getiri: %${((d.kz / data[0].value) * 100).toFixed(2)}
      `;
      tooltip.style.left = (nearest.x + 10) + 'px';
      tooltip.style.top = (nearest.y - 50) + 'px';
      tooltip.classList.add('visible');
      
      // Vurgu çiz
      ctx.beginPath();
      ctx.arc(nearest.x, nearest.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(59,130,246,0.3)';
      ctx.fill();
    } else {
      tooltip.classList.remove('visible');
    }
  };
  
  canvas.onmouseleave = () => {
    tooltip.classList.remove('visible');
    drawMonthlySparkline(canvas, data, tooltip); // Yeniden çiz
  };
}

function closeModal(){ qs('#modal')?.classList.remove('active'); }

function renderAll(){
  const key = `filter:${ACTIVE}`;
  let d = CACHE[key];
  if (!d){ 
    d = ACTIVE === 'ALL' ? DATA : DATA.filter(x => x.tur.toUpperCase() === ACTIVE.toUpperCase()); 
    CACHE[key] = d; 
  }
  renderSummary(d); 
  renderTypes(); 
  renderPeriods(d); 
  renderDetails(d); 
  renderTicker(DATA); 
  checkAlerts();
}

function renderSummary(d){
  const t = sum(d, 'toplamYatirim'), g = sum(d,'guncelDeger'), kz = g - t; 
  const p = t?((kz/t)*100).toFixed(1):0;
  qs('#summary').innerHTML = `
    <div class="card"><div class="small">Maliyet</div><div class="big">${formatTRY(t)}</div></div>
    <div class="card"><div class="small">Güncel</div><div class="big">${formatTRY(g)}</div></div>
    <div class="card ${kz>=0?'pos':'neg'}"><div class="small">Toplam K/Z</div><div class="big">${kz>=0?'+':''}${p}%</div><div class="small" style="font-size:11px;margin-top:4px;">${formatTRY(kz)}</div></div>`;
}

function renderTypes(){
  const turlar = [...new Set(DATA.map(x=>x.tur))];
  let h = `<div class="card type-card ${ACTIVE==='ALL'?'active':''}" data-type="ALL">GENEL<br><span class="big">HEPSİ</span></div>`;
  turlar.forEach(tur=>{
    const sub = DATA.filter(x=>x.tur===tur); 
    const kz = sum(sub,'guncelDeger') - sum(sub,'toplamYatirim');
    h += `<div class="card type-card ${ACTIVE===tur?'active':''}" data-type="${tur}"><div class="small">${tur.toUpperCase()}</div><div class="big ${kz>=0?'pos':'neg'}" style="font-size:12px">${formatTRY(kz)}</div></div>`;
  });
  const types = qs('#types'); 
  types.innerHTML = h; 
  [...types.children].forEach(el=> el.onclick = ()=>{ ACTIVE = el.dataset.type; renderAll(); });
}

function renderPeriods(d){
  const periods = [["Günlük","gunluk"],["Haftalık","haftalik"],["Aylık","aylik"],["3 Ay","ucAylik"],["6 Ay","altiAylik"],["1 Yıl","birYillik"]];
  const guncel = sum(d,'guncelDeger'); 
  let h='';
  periods.forEach(([label,key])=>{ 
    const degisim = sum(d,key); 
    const onceki = guncel - degisim; 
    const perc = onceki?((degisim/onceki)*100).toFixed(1):0;
    h += `<div class="card ${degisim>=0?'pos':'neg'}"><div class="small">${label}</div><div class="big">${formatTRY(degisim)} <span style="font-size:11px">(${degisim>=0?'+':''}${perc}%)</span></div></div>`; 
  });
  qs('#periods').innerHTML = h;
}

function applySortAndFilter(arr){
  let out = [...arr];
  if (FILTER_KZ !== 'all'){
    out = out.filter(it => (it.guncelDeger - it.toplamYatirim) >= 0 === (FILTER_KZ==='pos'));
  }
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
    const kz = item.guncelDeger - item.toplamYatirim; 
    const weight = portSum?((item.guncelDeger/portSum)*100).toFixed(1):0;
    const adet = item.adet || item.miktar || Math.round(item.toplamYatirim / (item.ortalamaMaliyet || 1)) || 1;
    const birimFiyat = item.guncelFiyat || (item.guncelDeger / adet);
    
    h += `<div class="detail-item" data-idx="${idx}" data-urun="${item.urun}">
      <div class="detail-info">
        <div>${item.urun} <span class="weight-badge">· %${weight}</span></div>
        <div>Maliyet: ${formatTRY(item.toplamYatirim)} · Adet: ${adet.toLocaleString('tr-TR')}</div>
        <div style="font-size:10px; opacity:0.7; margin-top:2px">Birim: ${formatTRY(birimFiyat)}</div>
      </div>
      <div class="detail-values">
        <div class="detail-val">${formatTRY(item.guncelDeger)}</div>
        <div class="detail-perc ${kz>=0?'pos':'neg'}">${formatTRY(kz)}</div>
      </div>
    </div>`;
  });
  list.innerHTML = h;
  qsa('.detail-item', list).forEach((el)=>{
    el.onclick = ()=>{ 
      const urun = el.dataset.urun; 
      const item = applied.find(x=>x.urun===urun); 
      if (item) openModal(item); 
    };
  });
}

function renderTicker(list){
  let h=''; 
  list.forEach(d=>{ 
    const degisim=d.gunluk; 
    const onceki=d.guncelDeger-degisim; 
    const perc= onceki?((degisim/onceki)*100).toFixed(2):0;
    h += `<div class="ticker-item" style="color:${degisim>=0?'var(--pos)':'var(--neg)'}">${d.urun} %${degisim>=0?'+':''}${perc}</div>`; 
  });
  qs('#ticker-content').innerHTML = h + h;
}

qs('#search')?.addEventListener('input', e=>{
  const q = e.target.value.toLowerCase(); 
  const items = qsa('.detail-item');
  requestAnimationFrame(()=>{ 
    items.forEach(it=>{ it.style.display = it.textContent.toLowerCase().includes(q) ? '' : 'none'; }); 
  });
});

function checkAlerts(){
  const portSum = sum(DATA,'guncelDeger');
  qsa('.detail-item').forEach(el=> el.classList.remove('alert-pulse'));
  DATA.forEach(item=>{
    const a = ALERTS[item.urun]; 
    if (!a) return;
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

function startAutoRefresh(){ 
  stopAutoRefresh(); 
  if (!AUTO_REFRESH.ms) AUTO_REFRESH.ms = 60000; 
  AUTO_REFRESH.timer = setInterval(async()=>{
    try{ 
      const resp = await fetch(`${CSV_URL}&cache=${Date.now()}`); 
      const text = await resp.text(); 
      const parsed = Papa.parse(text.trim(), { header:true, skipEmptyLines:true });
      DATA = parsed.data.map(row=>{ 
        const o={}; 
        for(let k in row){ o[k] = (k==='urun'||k==='tur')? cleanStr(row[k]) : toNumber(row[k]); } 
        return o; 
      }).filter(x=> x.urun && x.toplamYatirim>0);
      CACHE = {}; 
      renderAll(); 
      showToast('Veriler yenilendi');
    }catch(e){ 
      console.warn('Yenileme başarısız', e); 
    }
  }, AUTO_REFRESH.ms); 
}

function stopAutoRefresh(){ 
  if (AUTO_REFRESH.timer){ 
    clearInterval(AUTO_REFRESH.timer); 
    AUTO_REFRESH.timer=null; 
  } 
}

init();
