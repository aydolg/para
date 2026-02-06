(function(){
  'use strict';
  // app.js — IIFE wrapped to prevent scope leaks and to catch truncation issues

  /*
    NOTE: If you still see "Unexpected end of input", the issue is very likely
    coming from: a) an unclosed <script> tag in HTML, b) another inline script
    concatenated right after this file, or c) the browser receiving a truncated
    response. This file now ends with an explicit EOF marker and a console log.
  */

  /****************************************************
   * 0) GLOBAL DURUM
   ****************************************************/
  const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLPFVZn0j8Ygu914QDGRCGKsVy88gWjdk7DFi-jWiydmqYsdGUE4hEAb-R_IBzQmtFZwoMJFcN6rlD/pub?gid=1050165900&single=true&output=csv";
  let DATA = [];
  let ALERTS = {};
  let SORT_KEY = "default";
  let FILTER_KZ = "all";
  let AUTO_REFRESH = { enabled:false, ms:60000, timer:null };
  let THEME = "dark";

  /****************************************************
   * 1) YARDIMCI FONKSİYONLAR
   ****************************************************/
  const qs=(s,r=document)=>r.querySelector(s);
  const qsa=(s,r=document)=>[...r.querySelectorAll(s)];
  const cleanStr=s=>s?s.toString().trim().replace(/\s+/g," "):"";
  const sum=(a,k)=>a.reduce((x,y)=>x+(y[k]||0),0);
  const toNumber=v=>{if(!v&&v!==0)return 0;const s=v.toString().replace(/[^0-9,.-]/g,"").replace(/\./g,"").replace(",",".");return parseFloat(s)||0;};
  const formatTRY=n=>(n||0).toLocaleString("tr-TR")+" ₺";
  function lsGet(k,d){try{return JSON.parse(localStorage.getItem(k))??d;}catch{return d;}}
  function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}
  function showToast(m){const t=qs('#toast');if(!t)return;t.textContent=m;t.hidden=false;setTimeout(()=>t.hidden=true,2000);} 
  function showLoader(msg="Veriler analiz ediliyor..."){const l=qs('#loader');if(l){l.hidden=false;l.innerHTML=`<div class='loader-core'><div class='loader-ring'></div><div class='loader-text'>${msg}</div></div>`;}}
  function hideLoader(){const l=qs('#loader');if(l){l.hidden=true;}}

  /****************************************************
   * 2) CSV BAŞLIK KONTROLÜ
   ****************************************************/
  function validateHeaders(fields){
    const req=["urun","tur","toplamYatirim","guncelDeger","gunluk","haftalik","aylik","ucAylik","altiAylik","birYillik"];
    const missing=req.filter(f=>!fields.includes(f));
    return {ok:missing.length===0,missing};
  }

  /****************************************************
   * 3) VERİ YÜKLEME
   ****************************************************/
  async function init(){
    try{
      showLoader();

      if(typeof Papa==='undefined')
        throw new Error("PapaParse kütüphanesi yüklenmedi");

      const resp=await fetch(`${CSV_URL}&cache=${Date.now()}`);
      if(!resp.ok) throw new Error("CSV yüklenemedi: "+resp.status);

      const text=await resp.text();
      const parsed=Papa.parse(text.trim(),{header:true,skipEmptyLines:true});

      const fields=parsed.meta.fields||Object.keys(parsed.data[0]||{});
      const vh=validateHeaders(fields);
      if(!vh.ok){ showToast("Eksik sütun: "+vh.missing.join(', ')); return; }

      DATA=parsed.data.map(r=>{
        const o={};
        for(let k in r){ o[k]=(k==="urun"||k==="tur")?cleanStr(r[k]):toNumber(r[k]); }
        return o;
      }).filter(x=>x.urun && x.toplamYatirim>0);

      ALERTS=lsGet('alerts',{});
      THEME=lsGet('theme','dark');

      applyTheme(THEME);
      ensureUI();
      renderAll();

      hideLoader();
      if(AUTO_REFRESH.enabled) startAutoRefresh();

    }catch(err){
      console.error(err);
      showToast("Yükleme hatası: "+err.message);
      setTimeout(init,4000);
    }
  }

  /****************************************************
   * 4) UI OLUŞTURMA
   ****************************************************/
  function ensureUI(){
    if(!qs('.toolbar')){
      const bar=document.createElement('div');
      bar.className='toolbar';
      bar.innerHTML=`
        <div>
          <label>Sıralama:</label>
          <select id='sort-select'>
            <option value='default'>Varsayılan</option>
            <option value='kzDesc'>K/Z çok → az</option>
            <option value='kzAsc'>K/Z az → çok</option>
            <option value='guncelDesc'>Güncel yüksek → düşük</option>
            <option value='maliyetDesc'>Maliyet yüksek → düşük</option>
          </select>
        </div>
        <div>
          <label>Filtre:</label>
          <label><input type='radio' name='fz' value='all' checked> Hepsi</label>
          <label><input type='radio' name='fz' value='pos'> K/Z +</label>
          <label><input type='radio' name='fz' value='neg'> K/Z -</label>
        </div>
        <div>
          <label>Tema:</label>
          <select id='theme-select'><option value='dark'>Dark</option><option value='light'>Light</option></select>
        </div>
        <div>
          <label>Oto Yenile:</label>
          <input id='autoref' type='checkbox'>
          <select id='arate'>
            <option value='30000'>30 sn</option>
            <option value='60000' selected>1 dk</option>
            <option value='300000'>5 dk</option>
          </select>
        </div>`;

      document.body.prepend(bar);

      qs('#sort-select').onchange=e=>{ SORT_KEY=e.target.value; renderAll(); };
      qsa("input[name='fz']").forEach(i=> i.onchange=e=>{ FILTER_KZ=e.target.value; renderAll(); });
      qs('#theme-select').onchange=e=> applyTheme(e.target.value);
      qs('#autoref').onchange=e=>{ AUTO_REFRESH.enabled=e.target.checked; e.target.checked?startAutoRefresh():stopAutoRefresh(); };
      qs('#arate').onchange=e=>{ AUTO_REFRESH.ms=+e.target.value; if(AUTO_REFRESH.enabled) startAutoRefresh(); };
    }

    if(!qs('#modal')){
      const m=document.createElement('div');
      m.id='modal';
      m.className='modal';
      m.innerHTML=`
        <div class='modal-backdrop'></div>
        <div class='modal-card'>
          <div class='modal-header'>
            <div class='modal-title'>Detay</div>
            <button class='modal-close'>×</button>
          </div>
          <div class='modal-body'></div>
        </div>`;
      document.body.append(m);
      m.addEventListener('click',e=>{ if(e.target.classList.contains('modal-backdrop')||e.target.classList.contains('modal-close')) closeModal(); });
    }
  }

  function applyTheme(t){ THEME=t; document.documentElement.setAttribute('data-theme',t==='light'?'light-nebula':'dark-nebula'); lsSet('theme',t); }

  /****************************************************
   * 5) MODAL + TREND
   ****************************************************/
  function openModal(item){
    const modal=qs('#modal');
    const body=modal.querySelector('.modal-body');
    const port=sum(DATA,'guncelDeger');
    const kz=item.guncelDeger-item.toplamYatirim;
    const weight=port?((item.guncelDeger/port)*100).toFixed(1):0;
    const al=ALERTS[item.urun]||{};

    body.innerHTML=`
      <b>${item.urun}</b> · ${item.tur} · Ağırlık: ${weight}%<br><br>
      Güncel: ${formatTRY(item.guncelDeger)}<br>
      Maliyet: ${formatTRY(item.toplamYatirim)}<br>
      K/Z: ${formatTRY(kz)}<br><hr>
      <div class='trend-tabs'>
        <button class='tab active' data-i='0'>Günlük</button>
        <button class='tab' data-i='1'>Haftalık</button>
        <button class='tab' data-i='2'>Aylık</button>
      </div>
      <canvas class='spark' width='600' height='64'></canvas>
      <div id='trend-info'></div>
      <hr>
      <h4>Uyarılar</h4>
      <label>Güncel ≥ <input id='al-g' type='number' value='${al.guncel||""}'></label><br>
      <label>K/Z ≥ <input id='al-k' type='number' value='${al.kz||""}'></label><br>
      <label>Günlük % ≥ <input id='al-d' type='number' step='0.1' value='${al.dailyPerc||""}'></label><br><br>
      <button id='alsave'>Kaydet</button>
      <button id='aldel'>Sil</button>
    `;

    const series=[item.gunluk||0,item.haftalik||0,item.aylik||0];
    const canvas=body.querySelector('.spark');
    let mode=0;

    const updateTrend=()=>{
      const v=series[mode];
      const prev=item.guncelDeger-v;
      const perc=prev>0?((v/prev)*100).toFixed(2):0;
      body.querySelector('#trend-info').textContent=["Günlük","Haftalık","Aylık"][mode]+`: ${formatTRY(v)} (${perc}%)`;
    };

    drawSparkline(canvas,series,mode);
    updateTrend();

    body.querySelectorAll('.tab').forEach(btn=>{
      btn.onclick=()=>{
        body.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
        btn.classList.add('active');
        mode=parseInt(btn.dataset.i);
        drawSparkline(canvas,series,mode);
        updateTrend();
      };
    });

    body.querySelector('#alsave').onclick=()=>{
      ALERTS[item.urun]={
        guncel:toNumber(body.querySelector('#al-g').value)||null,
        kz:toNumber(body.querySelector('#al-k').value)||null,
        dailyPerc:parseFloat(body.querySelector('#al-d').value)||null
      };
      lsSet('alerts',ALERTS);
      showToast('Kaydedildi');
    };

    body.querySelector('#aldel').onclick=()=>{
      delete ALERTS[item.urun];
      lsSet('alerts',ALERTS);
      showToast('Silindi');
    };

    modal.classList.add('active');
  }
  function closeModal(){ qs('#modal').classList.remove('active'); }

  function drawSparkline(canvas,data,active){
    const ctx=canvas.getContext('2d');
    const w=canvas.width,h=canvas.height,p=8;
    const min=Math.min(...data),max=Math.max(...data),rng=max-min||1;
    ctx.clearRect(0,0,w,h);

    const pts=data.map((v,i)=>({
      x:p+i*((w-2*p)/(data.length-1)),
      y:h-p-((v-min)/rng)*(h-2*p)
    }));

    ctx.beginPath();
    ctx.strokeStyle='#60a5fa';
    ctx.lineWidth=2;
    pts.forEach((pt,i)=>{if(i===0)ctx.moveTo(pt.x,pt.y);else ctx.lineTo(pt.x,pt.y);});
    ctx.stroke();

    const a=pts[active];
    ctx.beginPath();
    ctx.arc(a.x,a.y,4,0,Math.PI*2);
    ctx.fillStyle='#93c5fd';
    ctx.fill();
  }

  /****************************************************
   * 6) LİSTE + FİLTRE
   ****************************************************/
  function computeDerived(x){return{...x,kz:(x.guncelDeger-x.toplamYatirim)}}

  function applyFilterAndSort(list){
    let out=list;

    if(FILTER_KZ==='pos') out=out.filter(x=>x.kz>=0);
    if(FILTER_KZ==='neg') out=out.filter(x=>x.kz<0);

    switch(SORT_KEY){
      case 'kzDesc': out.sort((a,b)=>b.kz-a.kz); break;
      case 'kzAsc' : out.sort((a,b)=>a.kz-b.kz); break;
      case 'guncelDesc': out.sort((a,b)=>b.guncelDeger-a.guncelDeger); break;
      case 'maliyetDesc': out.sort((a,b)=>b.toplamYatirim-a.toplamYatirim); break;
    }
    return out;
  }

  function checkAlerts(x){
    const a=ALERTS[x.urun]; if(!a) return false;
    const r=[];
    if(a.guncel && x.guncelDeger>=a.guncel) r.push('Güncel≥');
    if(a.kz && x.kz>=a.kz) r.push('K/Z≥');
    if(a.dailyPerc){
      const prev=x.guncelDeger-(x.gunluk||0);
      const perc=prev?((x.gunluk||0)/prev)*100:0;
      if(perc>=a.dailyPerc) r.push('Günlük %≥');
    }
    return r.length?r.join(', '):false;
  }

  function renderList(){
    let host=qs('#list');
    if(!host){host=document.createElement('div');host.id='list';document.body.append(host);} 

    host.innerHTML='';
    const arr=DATA.map(computeDerived);
    const port=sum(arr,'guncelDeger');
    const filt=applyFilterAndSort(arr);

    filt.forEach(x=>{
      const card=document.createElement('div');
      card.className='card';
      const al=checkAlerts(x);
      if(al) card.classList.add('alert-pulse');

      card.innerHTML=`<b>${x.urun}</b> — ${formatTRY(x.guncelDeger)} · K/Z: ${formatTRY(x.kz)} ${al?`<span style='color:red'>(${al})</span>`:""}<br><small>Ağırlık: ${(port?(x.guncelDeger/port)*100:0).toFixed(1)}%</small>`;

      card.onclick=()=>openModal(x);
      host.append(card);
    });
  }

  /****************************************************
   * 7) ÖZET + TICKER
   ****************************************************/
  function renderSummary(){
    const tot=sum(DATA,'guncelDeger');
    const cost=sum(DATA,'toplamYatirim');
    const pnl=tot-cost;

    if(qs('#summary-total')) qs('#summary-total').textContent=formatTRY(tot);
    if(qs('#summary-cost')) qs('#summary-cost').textContent=formatTRY(cost);
    if(qs('#summary-pnl')) qs('#summary-pnl').textContent=(pnl>=0?'+':'')+formatTRY(pnl);
  }

  function renderTicker(){
    const el=qs('#ticker'); if(!el)return;
    const top=[...DATA].sort((a,b)=>Math.abs(b.gunluk)-Math.abs(a.gunluk)).slice(0,5);
    el.innerHTML= top.map(x=>{
      const prev=x.guncelDeger-(x.gunluk||0);
      const perc=prev?(((x.gunluk||0)/prev)*100).toFixed(2):0;
      return `<span style='margin-right:12px'>${x.urun}: ${(x.gunluk>=0?'+':'')+formatTRY(x.gunluk)} (${perc}%)</span>`;
    }).join('');
  }

  function renderAll(){ renderSummary(); renderList(); renderTicker(); }

  /****************************************************
   * 8) OTO-YENİLE
   ****************************************************/
  function startAutoRefresh(){ stopAutoRefresh(); AUTO_REFRESH.timer=setInterval(()=>init(),AUTO_REFRESH.ms);} 
  function stopAutoRefresh(){ if(AUTO_REFRESH.timer){ clearInterval(AUTO_REFRESH.timer); AUTO_REFRESH.timer=null; }}

  /****************************************************
   * 9) GİRİŞ
   ****************************************************/
  window.addEventListener('DOMContentLoaded',init);

  // EOF marker & load ping
  console.log('[app.js] loaded OK');
})();
