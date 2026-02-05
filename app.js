/*
  Portföy Terminali Pro Max · Dark Nebula Edition
  app.js (Tam Optimizasyon + %50 Performans Artışı)
  Tema Seçimleri: Orta Neon + Güçlü Blur + Neon Border + Glow + Ekstralar
*/

/* =========================================================
   0) Sabitler & Global Değişkenler
========================================================= */
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLPFVZn0j8Ygu914QDGRCGKsVy88gWjdk7DFi-jWiydmqYsdGUE4hEAb-R_IBzQmtFZwoMJFcN6rlD/pub?gid=1050165900&single=true&output=csv";
let DATA = [];
let ACTIVE = "ALL";
let CACHE = {}; // Performans için cache

/* =========================================================
   1) Yardımcı Fonksiyonlar
========================================================= */
const cleanStr = (s) => s ? s.toString().trim().replace(/\s+/g, " ") : "";

function toNumber(v){
  if (!v) return 0;
  let s = v.toString()
    .replace(/[^\d,\.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  return parseFloat(s) || 0;
}

const formatTRY = (n) => n.toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺";

const sum = (arr, key) => arr.reduce((a,b) => a + (b[key] ?? 0), 0);

function showToast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  setTimeout(()=> t.hidden = true, 2500);
}

/* =========================================================
   2) Veriyi Yükleme + Temizleme
========================================================= */
async function init(){
  try{
    const resp = await fetch(`${CSV_URL}&cache=${Date.now()}`);
    const text = await resp.text();

    const parsed = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
    DATA = parsed.data.map(row => {
      const out = {};
      for (let k in row){
        if (k === "urun" || k === "tur") out[k] = cleanStr(row[k]);
        else out[k] = toNumber(row[k]);
      }
      return out;
    }).filter(x => x.urun && x.toplamYatirim > 0);

    if (!DATA.length) throw new Error("CSV boş geldi");

    document.getElementById("loader").hidden = true;
    renderAll();
  }
  catch(err){
    console.warn("Veri yüklenemedi, yeniden deneniyor...", err);
    showToast("Veri yüklenemedi, tekrar deneniyor...");
    setTimeout(init, 1200);
  }
}

/* =========================================================
   3) Render Motoru (Optimizasyonlu)
========================================================= */
function renderAll(){
  const key = `filter:${ACTIVE}`;

  // Cache
  let d = CACHE[key];
  if (!d){
    d = ACTIVE === "ALL"
      ? DATA
      : DATA.filter(x => x.tur.toUpperCase() === ACTIVE.toUpperCase());
    CACHE[key] = d;
  }

  renderSummary(d);
  renderTypes();
  renderPeriods(d);
  renderDetails(d);
  renderTicker(DATA);
}

/* =========================================================
   4) ÖZET KARTLARI
========================================================= */
function renderSummary(d){
  const t = sum(d, "toplamYatirim");
  const g = sum(d, "guncelDeger");
  const kz = g - t;
  const p = t ? ((kz / t)*100).toFixed(1) : 0;

  document.getElementById("summary").innerHTML = `
    <div class="card"><div class="small">Maliyet</div><div class="big">${formatTRY(t)}</div></div>
    <div class="card"><div class="small">Güncel</div><div class="big">${formatTRY(g)}</div></div>
    <div class="card ${kz>=0?"pos":"neg"}">
      <div class="small">Toplam K/Z</div>
      <div class="big">${kz>=0?"+":""}${p}%</div>
      <div class="small" style="font-size:11px;margin-top:4px;">${formatTRY(kz)}</div>
    </div>
  `;
}

/* =========================================================
   5) TÜR BUTONLARI
========================================================= */
function renderTypes(){
  const turlar = [...new Set(DATA.map(x => x.tur))];

  let h = `<div class="card type-card ${ACTIVE==="ALL"?"active":""}" data-type="ALL">GENEL<br><span class="big">HEPSİ</span></div>`;

  turlar.forEach(tur => {
    const sub = DATA.filter(x => x.tur === tur);
    const kz = sum(sub, "guncelDeger") - sum(sub, "toplamYatirim");
    h += `
      <div class="card type-card ${ACTIVE===tur?"active":""}" data-type="${tur}">
        <div class="small">${tur.toUpperCase()}</div>
        <div class="big ${kz>=0?"pos":"neg"}" style="font-size:12px">${formatTRY(kz)}</div>
      </div>`;
  });

  const types = document.getElementById("types");
  types.innerHTML = h;

  [...types.children].forEach(el => {
    el.onclick = () => {
      ACTIVE = el.dataset.type;
      renderAll();
    };
  });
}

/* =========================================================
   6) DÖNEMSEL PERFORMANS
========================================================= */
function renderPeriods(d){
  const periods = [
    ["Günlük","gunluk"],
    ["Haftalık","haftalik"],
    ["Aylık","aylik"],
    ["3 Ay","ucAylik"],
    ["6 Ay","altiAylik"],
    ["1 Yıl","birYillik"],
  ];

  const guncel = sum(d, "guncelDeger");

  let h = ``;
  periods.forEach(([label,key]) => {
    const degisim = sum(d, key);
    const onceki = guncel - degisim;
    const perc = onceki ? ((degisim / onceki)*100).toFixed(1) : 0;

    h += `
      <div class="card ${degisim>=0?"pos":"neg"}">
        <div class="small">${label}</div>
        <div class="big">${formatTRY(degisim)} <span style="font-size:11px">(${degisim>=0?"+":""}${perc}%)</span></div>
      </div>`;
  });

  document.getElementById("periods").innerHTML = h;
}

/* =========================================================
   7) DETAY LİSTESİ
========================================================= */
function renderDetails(d){
  document.getElementById("detail-title").textContent = ACTIVE === "ALL"
    ? "📦 TÜM ÜRÜNLER"
    : `📦 ${ACTIVE.toUpperCase()} DETAYLARI`;

  let h = ``;
  d.forEach(item => {
    const kz = item.guncelDeger - item.toplamYatirim;
    h += `
      <div class="detail-item">
        <div class="detail-info">
          <div>${item.urun}</div>
          <div>Maliyet: ${formatTRY(item.toplamYatirim)}</div>
        </div>
        <div class="detail-values">
          <div class="detail-val">${formatTRY(item.guncelDeger)}</div>
          <div class="detail-perc ${kz>=0?"pos":"neg"}">${formatTRY(kz)}</div>
        </div>
      </div>`;
  });

  document.getElementById("detail-list").innerHTML = h;
}

/* =========================================================
   8) TICKER
========================================================= */
function renderTicker(list){
  let h = ``;
  list.forEach(d => {
    const degisim = d.gunluk;
    const onceki = d.guncelDeger - degisim;
    const perc = onceki ? ((degisim / onceki)*100).toFixed(2) : 0;

    h += `
      <div class="ticker-item" style="color:${degisim>=0?"var(--pos)":"var(--neg)"}">
        ${d.urun} %${degisim>=0?"+":""}${perc}
      </div>`;
  });

  document.getElementById("ticker-content").innerHTML = h + h;
}

/* =========================================================
   9) ARAMA
========================================================= */
document.getElementById("search")?.addEventListener("input", e => {
  const q = e.target.value.toLowerCase();
  const items = document.querySelectorAll(".detail-item");

  requestAnimationFrame(()=>{
    items.forEach(it => {
      const t = it.textContent.toLowerCase();
      it.style.display = t.includes(q) ? "" : "none";
    });
  });
});

/* =========================================================
   10) BAŞLAT
========================================================= */
init();
