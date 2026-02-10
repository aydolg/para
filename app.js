/*
  Portföy Terminali Pro Max · app.js (Final)
  Değişiklikler:
  - Dönemsel Performans üstte, Toolbar altta
  - Filtre kaldırıldı
  - Sıralama + Oto Yenileme + Son Güncelleme Zamanı
  - Ürün kartlarında % oran
  - Tutma süresi (eldesüre)
  - Geliştirilmiş 12 aylık grafik
  - Verimli K/Z tablosu
*/

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLPFVZn0j8Ygu914QDGRCGKsVy88gWjdk7DFi-jWiydmqYsdGUE4hEAb-R_IBzQmtFZwoMJFcN6rlD/pub?gid=1050165900&single=true&output=csv";
let DATA = [];
let ACTIVE = "ALL";
let CACHE = {};
let ALERTS = {};
let SORT_KEY = "default";
let AUTO_REFRESH = { enabled:false, ms:60000, timer:null, lastUpdate:null };

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

function formatTime(date) {
  if (!date) return "-";
  const d = new Date(date);
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function calculateHoldDays(tarihStr) {
  if (!tarihStr || typeof tarihStr !== 'string') return null;
  
  const parts = tarihStr.trim().split('.');
  if (parts.length !== 3) return null;
  
  const gun = parseInt(parts[0], 10);
  const ay = parseInt(parts[1], 10);
  const yil = parseInt(parts[2], 10);
  
  if (isNaN(gun) || isNaN(ay) || isNaN(yil)) return null;
  
  const alimTarihi = new Date(yil, ay - 1, gun);
  if (isNaN(alimTarihi.getTime())) return null;
  
  const bugun = new Date();
  const alimGun = new Date(alimTarihi.getFullYear(), alimTarihi.getMonth(), alimTarihi.getDate());
  const bugunGun = new Date(bugun.getFullYear(), bugun.getMonth(), bugun.getDate());
  
  const farkMs = bugunGun - alimGun;
  const farkGun = Math.floor(farkMs / (1000 * 60 * 60 * 24));
  
  return farkGun >= 0 ? farkGun : 0;
}

function formatHoldTime(days) {
  if (!days) return "Bilinmiyor";
  if (days < 30) return `${days} gün`;
  if (days < 365) return `${Math.floor(days/30)} ay ${days%30} gün`;
  const years = Math.floor(days/365);
  const remainingDays = days % 365;
  const months = Math.floor(remainingDays/30);
  return `${years} yıl ${months} ay`;
}

(function injectStyles(){
  if (qs('#dynamic-styles')) return;
  const css = `
    .toolbar{display:grid; grid-template-columns:1fr; gap:8px; padding:8px var(--gutter); margin:10px 0}
    .toolbar .card{padding:12px; display:flex; gap:16px; align-items:center; justify-content:flex-start; flex-wrap:wrap}
    .toolbar-group{display:flex; gap:8px; align-items:center}
    .toolbar select, .toolbar input[type="checkbox"]{
      background:linear-gradient(180deg, rgba(17,24,39,.85), rgba(17,24,39,.65)); color:var(--text);
      border:1px solid var(--line); border-radius:8px; padding:6px 10px; font-size:12px;
    }
    .last-update{font-size:11px; opacity:0.8; color:var(--accent-2); margin-left:auto; padding:4px 10px; background:rgba(59,130,246,.1); border-radius:6px}
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
    .hold-badge{font-size:10px; opacity:0.8; background:rgba(245,158,11,.15); color:#f59e0b; padding:2px 8px; border-radius:4px; margin-left:6px}
    .percent-badge{font-size:11px; font-weight:700; padding:2px 6px; border-radius:4px; margin-left:4px}
    .percent-badge.pos{background:rgba(34,197,94,.2); color:var(--pos)}
    .percent-badge.neg{background:rgba(239,68,68,.2); color:var(--neg)}
    .alert-pulse{animation:alertPulse 1.4s ease-in-out infinite}
    @keyframes alertPulse{0%{box-shadow:0 0 0 0 rgba(239,68,68,.35)}70%{box-shadow:0 0 0 12px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
    .kz-table{width:100%; border-collapse:collapse; margin-top:10px; font-size:11px}
    .kz-table th, .kz-table td{padding:6px 4px; text-align:center; border:1px solid var(--line)}
    .kz-table th{background:rgba(59,130,246,.15); font-weight:600; font-size:10px}
    .kz-table td{font-size:11px}
    .kz-table .pos{color:var(--pos)}
    .kz-table .neg{color:var(--neg)}
    .kz-table tr:hover{background:rgba(59,130,246,.05)}
    .monthly-chart-container{position:relative; width:100%; height:140px; margin-top:10px}
    .monthly-chart{width:100%; height:100%}
    .chart-tooltip{position:absolute; background:rgba(0,0,0,.95); border:1px solid var(--accent); padding:8px 12px; border-radius:8px; font-size:12px; pointer-events:none; opacity:0; transition:opacity .2s; z-index:100; white-space:nowrap; box-shadow:0 4px 20px rgba(0,0,0,.5)}
    .chart-tooltip.visible{opacity:1}
    .chart-legend{display:flex; gap:16px; justify-content:center; margin-top:8px; font-size:11px}
    .chart-legend span{display:flex; align-items:center; gap:4px}
    .legend-dot{width:8px; height:8px; border-radius:50%}
    @media (max-width:640px){ 
      .modal-grid{grid-template-columns:1fr} 
      .alert-form{grid-template-columns:1fr}
      .toolbar .card{flex-direction:column; align-items:flex-start}
      .last-update{margin-left:0; margin-top:8px}
      .kz-table{font-size:10px}
    }
  `;
  const style = document.createElement('style'); style.id='dynamic-styles'; style.textContent = css; document.head.appendChild(style);
})();

async function init(){
  try{
    const resp = await fetch(`${CSV_URL}&cache=${Date.now()}`);
    const text = await resp.text();
    const parsed = Papa.parse(text.trim(), { header:true, skipEmptyLines:true });
    
    // Orijinal kod + tarih için ek kontrol
    DATA = parsed.data.map(row => {
      const o = {}; 
      for (let k in row){ 
        o[k] = (k==="urun"||k==="tur") ? cleanStr(row[k]) : toNumber(row[k]); 
      }
      // Tarih için ek kontrol (YENİ)
      if (row["tarih"]) {
        o.tarih = row["tarih"].toString().trim();
      }
      return o;
    }).filter(x => x.urun && x.toplamYatirim > 0);
    
    if (!DATA.length) throw new Error("CSV boş geldi");

    ALERTS = lsGet('alerts', {});
    AUTO_REFRESH.lastUpdate = new Date();
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
          <label class="small" for="arate">Oto Yenile</label>
          <label style="display:inline-flex; gap:6px; align-items:center"><input id="autoref" type="checkbox"> Aç</label>
          <select id="arate">
            <option value="30000">30 sn</option>
            <option value="60000" selected>1 dk</option>
            <option value="300000">5 dk</option>
          </select>
        </div>
        <div class="toolbar-group">
          <span class="last-update" id="last-update">Son güncelleme: -</span>
        </div>
      </div>`;
    
    // TOOLBAR'I DÖNEMSEL PERFORMANS'IN ALTINA EKLE
    const periodsSection = qs('#periods');
    if (periodsSection && periodsSection.parentNode) {
      periodsSection.parentNode.insertBefore(toolbar, periodsSection.nextSibling);
    }

    qs('#sort-select').onchange = (e)=>{ SORT_KEY = e.target.value; renderAll(); };
    qs('#autoref').onchange = (e)=>{ 
      AUTO_REFRESH.enabled = !!e.target.checked; 
      AUTO_REFRESH.enabled ? startAutoRefresh() : stopAutoRefresh(); 
    };
    qs('#arate').onchange = (e)=>{ 
      AUTO_REFRESH.ms = +e.target.value; 
      if (AUTO_REFRESH.enabled){ startAutoRefresh(); } 
    };
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

function updateLastUpdateTime() {
  const el = qs('#last-update');
  if (el) el.textContent = `Son güncelleme: ${formatTime(AUTO_REFRESH.lastUpdate)}`;
}

function drawMonthlyChart(canvas, data, tooltip) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  
  const w = canvas.width, h = canvas.height;
  const pad = { top: 20, right: 20, bottom: 30, left: 50 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  
  const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  const currentMonth = new Date().getMonth();
  
  const chartData = months.map((m, i) => {
    const monthIndex = (currentMonth - 11 + i + 12) % 12;
    const progress = i / 11;
    const baseValue = data.maliyet || data.base;
    const targetValue = data.guncel || data.current;
    const value = baseValue + (targetValue - baseValue) * progress;
    const kz = value - baseValue;
    return { 
      month: months[monthIndex], 
      value: value, 
      kz: kz,
      fullDate: `${months[monthIndex]} ${new Date().getFullYear()}`
    };
  });
  
  const values = chartData.map(d => d.value);
  const kzValues = chartData.map(d => d.kz);
  
  const minValue = Math.min(...values) * 0.98;
  const maxValue = Math.max(...values) * 1.02;
  const valueRange = maxValue - minValue || 1;
  
  const minKz = Math.min(...kzValues, 0);
  const maxKz = Math.max(...kzValues, 0);
  const kzRange = maxKz - minKz || 1;
  
  ctx.clearRect(0, 0, w, h);
  
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
  }
  
  const getX = (i) => pad.left + (i / 11) * chartW;
  const getY = (val) => pad.top + chartH - ((val - minValue) / valueRange) * chartH;
  const getKzY = (kz) => pad.top + chartH - ((kz - minKz) / kzRange) * chartH;
  
  ctx.beginPath();
  ctx.moveTo(getX(0), getY(chartData[0].value));
  chartData.forEach((d, i) => ctx.lineTo(getX(i), getY(d.value)));
  ctx.lineTo(getX(11), h - pad.bottom);
  ctx.lineTo(getX(0), h - pad.bottom);
  ctx.closePath();
  
  const gradient = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
  gradient.addColorStop(0, 'rgba(59,130,246,0.3)');
  gradient.addColorStop(1, 'rgba(59,130,246,0)');
  ctx.fillStyle = gradient;
  ctx.fill();
  
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(59,130,246,1)';
  ctx.lineWidth = 2;
  chartData.forEach((d, i) => {
    if (i === 0) ctx.moveTo(getX(i), getY(d.value));
    else ctx.lineTo(getX(i), getY(d.value));
  });
  ctx.stroke();
  
  ctx.beginPath();
  ctx.strokeStyle = kzValues[kzValues.length-1] >= 0 ? 'rgba(34,197,94,1)' : 'rgba(239,68,68,1)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  chartData.forEach((d, i) => {
    if (i === 0) ctx.moveTo(getX(i), getKzY(d.kz));
    else ctx.lineTo(getX(i), getKzY(d.kz));
  });
  ctx.stroke();
  ctx.setLineDash([]);
  
  const points = [];
  chartData.forEach((d, i) => {
    const x = getX(i);
    const y = getY(d.value);
    points.push({ x, y, data: d });
    
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#0b1220';
    ctx.fill();
    ctx.strokeStyle = 'rgba(59,130,246,1)';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.month, x, h - 10);
  });
  
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = minValue + (valueRange / 4) * i;
    const y = pad.top + chartH - (chartH / 4) * i;
    ctx.fillText((val/1000).toFixed(0) + 'K', pad.left - 5, y + 3);
  }
  
  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    
    let nearest = null, minDist = Infinity;
    points.forEach(p => {
      const dist = Math.abs(p.x - mx);
      if (dist < minDist && dist < 30) {
        minDist = dist;
        nearest = p;
      }
    });
    
    if (nearest) {
      const d = nearest.data;
      const getiri = ((d.kz / chartData[0].value) * 100).toFixed(2);
      tooltip.innerHTML = `
        <strong>${d.fullDate}</strong><br>
        Değer: ${formatTRY(d.value)}<br>
        K/Z: <span style="color:${d.kz >= 0 ? '#22c55e' : '#ef4444'}">${d.kz >= 0 ? '+' : ''}${formatTRY(d.kz)}</span><br>
        Getiri: %${getiri}
      `;
      tooltip.style.left = Math.min(nearest.x + 10, rect.width - 150) + 'px';
      tooltip.style.top = Math.max(nearest.y - 60, 10) + 'px';
      tooltip.classList.add('visible');
      
      ctx.beginPath();
      ctx.arc(nearest.x, nearest.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(59,130,246,0.3)';
      ctx.fill();
    } else {
      tooltip.classList.remove('visible');
      drawMonthlyChart(canvas, data, tooltip);
    }
  };
  
  canvas.onmouseleave = () => {
    tooltip.classList.remove('visible');
    drawMonthlyChart(canvas, data, tooltip);
  };
}

function openModal(item){
  const modal = qs('#modal');
  const body = modal.querySelector('.modal-body');
  const portSum = sum(DATA, 'guncelDeger');
  const kz = item.guncelDeger - item.toplamYatirim;
  const weight = portSum ? ((item.guncelDeger/portSum)*100).toFixed(1) : 0;
  const alerts = ALERTS[item.urun] || { guncel:null, kz:null, dailyPerc:null };
  
  const holdDays = calculateHoldDays(item.tarih);
  const holdText = formatHoldTime(holdDays);
  
  const adet = item.adet || Math.floor(item.toplamYatirim / (item.alisFiyati || item.guncelDeger)) || 1;
  const birimMaliyet = item.toplamYatirim / adet;
  const birimGuncel = item.guncelDeger / adet;

  body.innerHTML = `
    <div class="modal-grid">
      <div class="stat">
        <div class="small">Ürün</div>
        <div class="big" style="font-size:16px">${item.urun}</div>
        <div class="small" style="margin-top:6px">
          Tür: ${item.tur} · Ağırlık: <b>${weight}%</b>
          <span class="hold-badge">⏱ ${holdText}</span>
        </div>
      </div>
      <div class="stat">
        <div class="small">Değerler</div>
        <div class="big">Güncel: ${formatTRY(item.guncelDeger)}</div>
        <div class="big">Maliyet: ${formatTRY(item.toplamYatirim)}</div>
        <div class="big ${kz>=0?"pos":"neg"}">K/Z: ${formatTRY(kz)}</div>
      </div>
      
      <div class="stat" style="grid-column:1 / -1">
        <div class="small">📊 Adet ve Birim Bilgileri</div>
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; margin-top:8px; font-size:12px">
          <div style="text-align:center; padding:8px; background:rgba(59,130,246,.1); border-radius:8px">
            <div style="opacity:.7; font-size:10px">Adet</div>
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
      
      <div class="stat" style="grid-column:1 / -1">
        <div class="small">📈 Tüm Dönemler K/Z</div>
        <table class="kz-table">
          <thead>
            <tr>
              <th>Dönem</th>
              <th>Değişim</th>
              <th>Dönem Sonu</th>
              <th>K/Z</th>
              <th>Getiri</th>
            </tr>
          </thead>
          <tbody>
            ${generateKzRows(item)}
          </tbody>
        </table>
      </div>
      
      <div class="stat" style="grid-column:1 / -1">
        <div class="small">📊 Aylık Performans (Son 12 Ay)</div>
        <div class="monthly-chart-container">
          <canvas class="monthly-chart" id="month-chart"></canvas>
          <div class="chart-tooltip" id="chart-tooltip"></div>
        </div>
        <div class="chart-legend">
          <span><span class="legend-dot" style="background:rgba(59,130,246,1)"></span>Portföy Değeri</span>
          <span><span class="legend-dot" style="background:rgba(34,197,94,1)"></span>K/Z (Noktalı)</span>
        </div>
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

  const chartCanvas = body.querySelector('#month-chart');
  const tooltip = body.querySelector('#chart-tooltip');
  setTimeout(() => drawMonthlyChart(chartCanvas, {
    maliyet: item.toplamYatirim,
    guncel: item.guncelDeger
  }, tooltip), 100);

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

function generateKzRows(item) {
  const periods = [
    {key: 'gunluk', label: 'Günlük'},
    {key: 'haftalik', label: 'Haftalık'},
    {key: 'aylik', label: 'Aylık'},
    {key: 'ucAylik', label: '3 Aylık'},
    {key: 'altiAylik', label: '6 Aylık'},
    {key: 'birYillik', label: '1 Yıllık'}
  ];
  
  let rows = '';
  let runningValue = item.guncelDeger;
  
  periods.forEach((p) => {
    const change = item[p.key] || 0;
    const periodEndValue = runningValue;
    runningValue -= change;
    
    const periodKz = periodEndValue - item.toplamYatirim;
    const getiri = item.toplamYatirim ? ((periodKz / item.toplamYatirim) * 100) : 0;
    
    rows += `
      <tr>
        <td><strong>${p.label}</strong></td>
        <td class="${change >= 0 ? 'pos' : 'neg'}">${change >= 0 ? '+' : ''}${formatTRY(change)}</td>
        <td>${formatTRY(periodEndValue)}</td>
        <td class="${periodKz >= 0 ? 'pos' : 'neg'}">${formatTRY(periodKz)}</td>
        <td class="${getiri >= 0 ? 'pos' : 'neg'}">${getiri >= 0 ? '+' : ''}${getiri.toFixed(1)}%</td>
      </tr>
    `;
  });
  
  return rows;
}

function closeModal(){ qs('#modal')?.classList.remove('active'); }

function drawSparkline(canvas, data){
  if (!canvas) return; 
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height, pad=6;
  const min = Math.min(...data, 0), max = Math.max(...data, 1);
  const range = max - min || 1; 
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = 'rgba(255,255,255,0.05)'; 
  ctx.fillRect(0,h-1,w,1);
  ctx.strokeStyle = 'rgba(96,165,250,.95)'; 
  ctx.lineWidth = 2; 
  ctx.beginPath();
  data.forEach((v,i)=>{
    const x = pad + i * ((w-2*pad)/(data.length-1 || 1));
    const y = h - pad - ((v - min)/range) * (h-2*pad);
    i?ctx.lineTo(x,y):ctx.moveTo(x,y);
  });
  ctx.stroke();
}

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
  updateLastUpdateTime();
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
    const percent = item.toplamYatirim ? ((kz / item.toplamYatirim) * 100).toFixed(1) : 0;
    
    const adet = item.adet || Math.floor(item.toplamYatirim / (item.alisFiyati || item.guncelDeger)) || 1;
    const birimFiyat = item.guncelDeger / adet;
    
    h += `<div class="detail-item" data-idx="${idx}" data-urun="${item.urun}">
      <div class="detail-info">
        <div>${item.urun} <span class="weight-badge">· %${weight}</span></div>
        <div>Maliyet: ${formatTRY(item.toplamYatirim)} · Adet: ${adet.toLocaleString('tr-TR')}</div>
        <div style="font-size:10px; opacity:0.7; margin-top:2px">Birim: ${formatTRY(birimFiyat)}</div>
      </div>
      <div class="detail-values">
        <div class="detail-val">${formatTRY(item.guncelDeger)}</div>
        <div class="detail-perc ${kz>=0?'pos':'neg'}">
          ${formatTRY(kz)}
          <span class="percent-badge ${kz>=0?'pos':'neg'}">${percent}%</span>
        </div>
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
      AUTO_REFRESH.lastUpdate = new Date();
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
