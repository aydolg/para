/*
  Portföy Terminali Pro Max · app.js (Tam Versiyon)
  Özellikler: Kompakt modal, 6 dönem gerçek veri grafiği, günlük ticker
*/

const PortfolioApp = (() => {
  'use strict';

  const CONFIG = {
    CSV_URL: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLPFVZn0j8Ygu914QDGRCGKsVy88gWjdk7DFi-jWiydmqYsdGUE4hEAb-R_IBzQmtFZwoMJFcN6rlD/pub?gid=1050165900&single=true&output=csv",
    PERIODS: [
      { key: 'gunluk', label: 'Günlük', short: '1G' },
      { key: 'haftalik', label: 'Haftalık', short: '1H' },
      { key: 'aylik', label: 'Aylık', short: '1A' },
      { key: 'ucAylik', label: '3 Ay', short: '3A' },
      { key: 'altiAylik', label: '6 Ay', short: '6A' },
      { key: 'birYillik', label: '1 Yıl', short: '1Y' }
    ]
  };

  const state = {
    data: [],
    activeFilter: "ALL",
    cache: {},
    alerts: {},
    sortKey: "default",
    autoRefresh: { enabled: false, ms: 60000, timer: null, lastUpdate: null }
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const cleanStr = (s) => s ? s.toString().trim() : "";

  const toNumber = (v) => {
    if (!v) return 0;
    const n = parseFloat(v.toString().replace(/[^\d,\.-]/g, "").replace(/\./g, "").replace(",", "."));
    return isNaN(n) ? 0 : n;
  };

  const formatTRY = (n) => {
    const num = Number(n);
    return isNaN(num) ? "0 ₺" : num.toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺";
  };

  const formatCompact = (n) => {
    const num = Number(n);
    if (isNaN(num)) return "0";
    if (Math.abs(num) >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (Math.abs(num) >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString("tr-TR", { maximumFractionDigits: 0 });
  };

  const sum = (arr, key) => arr.reduce((a, b) => a + (b[key] || 0), 0);

  const storage = {
    get: (key, def) => { try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; } },
    set: (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch { } }
  };

  const getHoldTime = (tarihStr) => {
    if (!tarihStr) return null;
    const parts = tarihStr.trim().split('.');
    if (parts.length !== 3) return null;
    const [g, a, y] = parts.map(Number);
    if ([g, a, y].some(isNaN)) return null;
    const alim = new Date(y, a - 1, g);
    const bugun = new Date();
    const fark = Math.floor((new Date(bugun.getFullYear(), bugun.getMonth(), bugun.getDate()) - 
                            new Date(alim.getFullYear(), alim.getMonth(), alim.getDate())) / (1000 * 60 * 60 * 24));
    if (fark < 0) return null;
    if (fark < 30) return `${fark}g`;
    if (fark < 365) return `${Math.floor(fark / 30)}a`;
    return `${Math.floor(fark / 365)}y`;
  };

  // === AI ANALIZ ===
  const Analyzer = {
    calculateRisk(data) {
      const vols = data.map(d => Math.abs(d.gunluk || 0) / (d.guncelDeger || 1) * 100);
      const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length || 0;
      const total = data.reduce((a, b) => a + b.guncelDeger, 0) || 1;
      const concentration = data.map(d => d.guncelDeger / total).reduce((a, w) => a + (w * w), 0);
      return {
        score: Math.min(100, (avgVol * 2 + concentration * 30)),
        level: avgVol > 5 ? 'Yüksek' : avgVol > 2 ? 'Orta' : 'Düşük',
        volatility: avgVol.toFixed(2),
        concentration: concentration.toFixed(2)
      };
    },

    analyzeTrends(data) {
      return data.map(item => {
        const vals = [item.gunluk, item.haftalik, item.aylik].map(v => v || 0);
        const trend = vals.reduce((a, b) => a + b, 0) > 0 ? 'Yükseliş' : 'Düşüş';
        const momentum = Math.abs(vals[0]) > Math.abs(vals[1]) ? 'Hızlanıyor' : 'Yavaşlıyor';
        const kz = item.guncelDeger - item.toplamYatirim;
        const kzPct = item.toplamYatirim ? ((kz / item.toplamYatirim) * 100) : 0;
        let suggestion = 'İzlemeye devam';
        if (kzPct > 20 && trend === 'Yükseliş') suggestion = 'Kar realizasyonu düşünülebilir';
        else if (kzPct < -15 && trend === 'Düşüş') suggestion = 'Stop-loss değerlendirilebilir';
        else if (momentum === 'Hızlanıyor' && trend === 'Yükseliş') suggestion = 'Pozisyon korunabilir';
        return { urun: item.urun, trend, momentum, suggestion, kzPct };
      });
    },

    getPersonality(data) {
      const byType = {};
      data.forEach(d => byType[d.tur] = (byType[d.tur] || 0) + d.guncelDeger);
      const maxType = Object.entries(byType).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Karışık';
      const profiles = {
        'Hisse': { name: 'Aktif', desc: 'Yüksek risk', advice: 'Tek hisse riskine dikkat' },
        'Fon': { name: 'Dengeli', desc: 'Orta risk', advice: 'Fon maliyetlerini kontrol edin' },
        'Tahvil': { name: 'Korumacı', desc: 'Düşük risk', advice: 'Enflasyona karşı korunma' },
        'Kripto': { name: 'Spekülatif', desc: 'Yüksek volatilite', advice: 'Kripto oranını %10da tut' }
      };
      return profiles[maxType] || { name: 'Karışık', desc: 'Çeşitlendirilmiş', advice: 'Dağılım dengeli' };
    },

    generateReport(data) {
      const totalValue = sum(data, 'guncelDeger');
      const totalCost = sum(data, 'toplamYatirim');
      const totalKz = totalValue - totalCost;
      const risk = this.calculateRisk(data);
      const trends = this.analyzeTrends(data);
      const personality = this.getPersonality(data);
      const winners = data.filter(d => d.guncelDeger > d.toplamYatirim).length;
      const performance = totalCost ? (totalKz / totalCost) * 100 : 0;
      const seasonIdx = Math.floor(new Date().getMonth() / 3);
      const seasons = [
        { name: 'Kış', advice: 'Yılbaşı rallisi bekleyin' },
        { name: 'İlkbahar', advice: 'Sell in May yaklaşır' },
        { name: 'Yaz', advice: 'Yaz durgunluğu fırsatı' },
        { name: 'Sonbahar', advice: 'Eylül volatilitesine hazırlıklı olun' }
      ];

      return {
        summary: {
          totalValue: formatTRY(totalValue),
          totalKz: formatTRY(totalKz),
          kzPercent: performance.toFixed(1),
          riskLevel: risk.level,
          diversification: risk.concentration > 0.3 ? 'Zayıf' : risk.concentration > 0.2 ? 'Orta' : 'İyi'
        },
        insights: [
          `${winners} kazançlı, ${data.length - winners} zararlı pozisyon`,
          `Risk: ${risk.level} (Vol: %${risk.volatility})`,
          `Çeşitlendirme: ${risk.concentration > 0.3 ? 'Zayıf' : 'Kabul edilebilir'}`,
          ...trends.filter(t => t.suggestion !== 'İzlemeye devam').map(t => `${t.urun}: ${t.suggestion}`)
        ],
        recommendations: this.getRecommendations(data, risk, trends, totalKz, totalCost),
        personality,
        season: seasons[seasonIdx],
        performance,
        narrative: this.generateNarrative(data, personality, seasons[seasonIdx], performance)
      };
    },

    getRecommendations(data, risk, trends, totalKz, totalCost) {
      const recs = [];
      if (risk.concentration > 0.3) recs.push('En büyük pozisyonu %15 altına düşürün');
      const bigLosers = trends.filter(t => t.kzPct < -20);
      if (bigLosers.length > 0) recs.push(`${bigLosers.length} üründe derin zarar`);
      if (totalKz > totalCost * 0.3) recs.push('Kar realizasyonu fırsatı');
      return recs;
    },

    generateNarrative(data, personality, season, performance) {
      let text = `${personality.name} profili: ${personality.desc}. ${season.name}: ${season.advice}. `;
      if (performance > 15) text += `%${performance.toFixed(1)} getiri. ${personality.advice}`;
      else if (performance > 0) text += `%${performance.toFixed(1)} pozitif. Sabırlı olun.`;
      else text += `%${performance.toFixed(1)} gerileme. Panik yapmayın.`;
      const types = [...new Set(data.map(d => d.tur))].length;
      if (types < 3) text += ` ${types} tür, çeşitlendirme artırılabilir.`;
      return text;
    }
  };

  // === MOBIL ===
  const Mobile = {
    init() {
      this.addSwipeSupport();
      this.addTouchFeedback();
    },
    addSwipeSupport() {
      let touchStartX = 0;
      const typesContainer = $('#types');
      if (!typesContainer) return;
      typesContainer.addEventListener('touchstart', e => touchStartX = e.changedTouches[0].screenX, { passive: true });
      typesContainer.addEventListener('touchend', e => {
        const diff = touchStartX - e.changedTouches[0].screenX;
        if (Math.abs(diff) < 50) return;
        const typeList = ['ALL', ...new Set(state.data.map(x => x.tur))];
        const currentIdx = typeList.indexOf(state.activeFilter);
        if (diff > 0 && currentIdx < typeList.length - 1) state.activeFilter = typeList[currentIdx + 1];
        else if (diff < 0 && currentIdx > 0) state.activeFilter = typeList[currentIdx - 1];
        renderAll();
      }, { passive: true });
    },
    addTouchFeedback() {
      const addFeedback = (e) => {
        const el = e.target.closest('.detail-item, .type-card, .btn');
        if (el) { el.style.transition = 'transform 0.1s ease'; el.style.transform = 'scale(0.98)'; }
      };
      const removeFeedback = (e) => {
        const el = e.target.closest('.detail-item, .type-card, .btn');
        if (el) { el.style.transform = ''; setTimeout(() => el.style.transition = '', 100); }
      };
      document.addEventListener('touchstart', addFeedback, { passive: true });
      document.addEventListener('touchend', removeFeedback, { passive: true });
      document.addEventListener('touchcancel', removeFeedback, { passive: true });
    }
  };

  // === UI RENDER ===
  const UI = {
    showToast(msg, duration = 2500) {
      const t = $('#toast');
      if (!t) return;
      t.textContent = msg;
      t.hidden = false;
      setTimeout(() => t.hidden = true, duration);
    },

    updateTicker() {
      const ticker = $('#ticker-content');
      if (!ticker || !state.data.length) return;
      const items = state.data.map(item => {
        const change = item.gunluk || 0;
        const changePct = item.guncelDeger ? ((change / (item.guncelDeger - change)) * 100).toFixed(2) : 0;
        const isPositive = change >= 0;
        return `<div class="ticker-item"><span>${item.urun}</span><span class="change ${isPositive ? 'pos' : 'neg'}">${isPositive ? '▲' : '▼'} ${formatCompact(change)} (${isPositive ? '+' : ''}${changePct}%)</span></div>`;
      }).join('');
      const totalChange = sum(state.data, 'gunluk');
      const totalCurrent = sum(state.data, 'guncelDeger');
      const totalPrev = totalCurrent - totalChange;
      const totalChangePct = totalPrev ? ((totalChange / totalPrev) * 100).toFixed(2) : 0;
      const totalPositive = totalChange >= 0;
      const totalItem = `<div class="ticker-item highlight"><span>📊 PORTFÖY</span><span class="change ${totalPositive ? 'pos' : 'neg'}">${totalPositive ? '▲' : '▼'} ${formatCompact(totalChange)} (${totalPositive ? '+' : ''}${totalChangePct}%)</span></div>`;
      ticker.innerHTML = items + totalItem + items + totalItem;
    },

    renderSummary(data) {
      const t = sum(data, 'toplamYatirim'), g = sum(data, 'guncelDeger'), kz = g - t;
      const p = t ? ((kz / t) * 100).toFixed(1) : 0;
      $('#summary').innerHTML = `
        <div class="card"><div class="small">Maliyet</div><div class="big">${formatTRY(t)}</div></div>
        <div class="card"><div class="small">Güncel</div><div class="big">${formatTRY(g)}</div></div>
        <div class="card ${kz >= 0 ? 'pos' : 'neg'}"><div class="small">K/Z</div><div class="big">${kz >= 0 ? '+' : ''}${p}%</div><div class="small" style="font-size: 10px; margin-top: 4px;">${formatTRY(kz)}</div></div>
      `;
    },

    renderTypes() {
      const types = [...new Set(state.data.map(x => x.tur))];
      let html = `<div class="card type-card ${state.activeFilter === 'ALL' ? 'active' : ''}" data-type="ALL"><div class="small">GENEL</div><div class="big">HEPSİ</div></div>`;
      types.forEach(type => {
        const subset = state.data.filter(x => x.tur === type);
        const kz = sum(subset, 'guncelDeger') - sum(subset, 'toplamYatirim');
        html += `<div class="card type-card ${state.activeFilter === type ? 'active' : ''}" data-type="${type}"><div class="small">${type.toUpperCase()}</div><div class="big ${kz >= 0 ? 'pos' : 'neg'}" style="font-size: 11px">${formatCompact(kz)}</div></div>`;
      });
      $('#types').innerHTML = html;
      $$('.type-card').forEach(el => el.onclick = () => { state.activeFilter = el.dataset.type; renderAll(); });
    },

    renderPeriods(data) {
      const current = sum(data, 'guncelDeger');
      $('#periods').innerHTML = CONFIG.PERIODS.map(({ key, label }) => {
        const change = sum(data, key);
        const prev = current - change;
        const pct = prev ? ((change / prev) * 100).toFixed(1) : 0;
        return `<div class="card ${change >= 0 ? 'pos' : 'neg'}"><div class="small">${label}</div><div class="big">${formatCompact(change)} <span style="font-size: 10px; opacity: 0.8;">(${change >= 0 ? '+' : ''}${pct}%)</span></div></div>`;
      }).join('');
    },

    renderDetails(data) {
      const list = $('#detail-list');
      const portSum = sum(state.data, 'guncelDeger');
      const isMobile = window.innerWidth <= 640;
      const sorted = [...data].sort((a, b) => {
        const cmp = {
          'kzDesc': (x, y) => (y.guncelDeger - y.toplamYatirim) - (x.guncelDeger - x.toplamYatirim),
          'kzAsc': (x, y) => (x.guncelDeger - x.toplamYatirim) - (y.guncelDeger - y.toplamYatirim),
          'maliyetDesc': (x, y) => y.toplamYatirim - x.toplamYatirim,
          'guncelDesc': (x, y) => y.guncelDeger - x.guncelDeger,
          'nameAZ': (x, y) => x.urun.localeCompare(y.urun, 'tr'),
          'nameZA': (x, y) => y.urun.localeCompare(x.urun, 'tr')
        }[state.sortKey];
        return cmp ? cmp(a, b) : 0;
      });

      $('#detail-title').textContent = state.activeFilter === 'ALL' ? '📦 TÜM ÜRÜNLER' : `📦 ${state.activeFilter.toUpperCase()}`;

      list.innerHTML = sorted.map(item => {
        const kz = item.guncelDeger - item.toplamYatirim;
        const weight = portSum ? ((item.guncelDeger / portSum) * 100).toFixed(1) : 0;
        const pct = item.toplamYatirim ? ((kz / item.toplamYatirim) * 100).toFixed(1) : 0;
        const adet = item.adet || 1;
        const unitPrice = item.guncelDeger / adet;
        const holdTime = getHoldTime(item.tarih);
        const dailyChange = item.gunluk || 0;

        if (isMobile) {
          return `<div class="detail-item" data-urun="${item.urun}"><div class="detail-info"><div title="${item.urun}">${item.urun.length > 18 ? item.urun.substring(0, 18) + '...' : item.urun} <span class="weight-badge">%${weight}</span></div><div><span>💰 ${formatCompact(item.toplamYatirim)}</span><span>📦 ${adet.toLocaleString('tr-TR')}</span>${holdTime ? `<span>⏱ ${holdTime}</span>` : ''}</div><div style="font-size: 10px; opacity: 0.6;">Birim: ${formatCompact(unitPrice)} | <span class="${dailyChange >= 0 ? 'pos' : 'neg'}">Günlük: ${dailyChange >= 0 ? '+' : ''}${formatCompact(dailyChange)}</span></div></div><div class="detail-values"><div class="detail-val">${formatCompact(item.guncelDeger)}</div><div class="detail-perc ${kz >= 0 ? 'pos' : 'neg'}"><span>${kz >= 0 ? '+' : ''}${formatCompact(kz)}</span><span class="percent-badge ${kz >= 0 ? 'pos' : 'neg'}">%${pct}</span></div></div></div>`;
        }
        
        return `<div class="detail-item" data-urun="${item.urun}"><div class="detail-info"><div>${item.urun} <span class="weight-badge">· %${weight}</span></div><div>Maliyet: ${formatCompact(item.toplamYatirim)} · Adet: ${adet.toLocaleString('tr-TR')}</div><div style="font-size: 10px; opacity: 0.7; margin-top: 2px;">Birim: ${formatCompact(unitPrice)} · <span class="${dailyChange >= 0 ? 'pos' : 'neg'}">Gün: ${dailyChange >= 0 ? '+' : ''}${formatCompact(dailyChange)}</span>${holdTime ? ` · <span class="hold-badge">⏱ ${holdTime}</span>` : ''}</div></div><div class="detail-values"><div class="detail-val">${formatCompact(item.guncelDeger)}</div><div class="detail-perc ${kz >= 0 ? 'pos' : 'neg'}">${formatCompact(kz)}<span class="percent-badge ${kz >= 0 ? 'pos' : 'neg'}">${pct}%</span></div></div></div>`;
      }).join('');

      $$('.detail-item', list).forEach(el => {
        el.onclick = () => {
          const item = sorted.find(x => x.urun === el.dataset.urun);
          if (item) Modal.open(item);
        };
      });
    },

    renderAIAnalysis() {
      const existing = $('.ai-panel');
      if (existing) existing.remove();
      const report = Analyzer.generateReport(state.data);
      const div = document.createElement('div');
      div.className = 'ai-panel';
      div.innerHTML = `<div class="ai-header"><div style="display: flex; align-items: center; gap: 10px;"><span style="font-size: 24px;">🧠</span><div><div style="font-weight: 800; font-size: 15px;">AI Analiz</div><div style="font-size: 11px; opacity: 0.7;">${new Date().toLocaleTimeString('tr-TR')}</div></div></div><button onclick="this.closest('.ai-panel').remove()" style="background: none; border: none; color: var(--text); font-size: 20px; cursor: pointer; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 8px;">×</button></div><div class="ai-content"><div class="ai-summary-grid"><div class="ai-metric"><div style="font-size: 10px; opacity: 0.7;">Getiri</div><div style="font-size: 18px; font-weight: 700; color: ${report.summary.kzPercent >= 0 ? 'var(--pos)' : 'var(--neg)'};">%${report.summary.kzPercent}</div><div style="font-size: 11px;">${report.summary.totalKz}</div></div><div class="ai-metric"><div style="font-size: 10px; opacity: 0.7;">Risk</div><div style="font-size: 16px; font-weight: 700; color: ${report.summary.riskLevel === 'Yüksek' ? '#ef4444' : report.summary.riskLevel === 'Orta' ? '#f59e0b' : '#22c55e'};">${report.summary.riskLevel}</div></div><div class="ai-metric"><div style="font-size: 10px; opacity: 0.7;">Çeşit.</div><div style="font-size: 16px; font-weight: 700; color: ${report.summary.diversification === 'Zayıf' ? '#ef4444' : report.summary.diversification === 'Orta' ? '#f59e0b' : '#22c55e'};">${report.summary.diversification}</div></div></div><div style="background: linear-gradient(135deg, rgba(59,130,246,.2), rgba(147,51,234,.2)); padding: 16px; border-radius: 12px; margin-bottom: 16px;"><div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;"><div style="font-size: 12px; opacity: 0.8;">Profil</div><div style="font-size: 11px; background: rgba(255,255,255,.1); padding: 4px 8px; border-radius: 4px;">${report.personality.name}</div></div><div style="font-size: 13px; line-height: 1.5;">${report.personality.desc}</div><div style="margin-top: 8px; font-size: 11px; color: var(--accent-2);">💡 ${report.personality.advice}</div></div><div style="background: rgba(245,158,11,.1); border: 1px solid rgba(245,158,11,.3); padding: 12px; border-radius: 8px; margin-bottom: 16px; display: flex; align-items: center; gap: 10px;"><span style="font-size: 20px;">🗓️</span><div><div style="font-weight: 600; font-size: 12px; color: #fbbf24;">${report.season.name}</div><div style="font-size: 11px; margin-top: 2px;">${report.season.advice}</div></div></div><div style="background: rgba(17,24,39,.8); padding: 16px; border-radius: 12px; margin-bottom: 16px; border-left: 3px solid ${report.performance > 0 ? '#22c55e' : '#ef4444'};"><div style="font-size: 13px; line-height: 1.6; font-style: italic;">"${report.narrative}"</div></div><div class="ai-insights"><div style="font-size: 12px; font-weight: 600; margin-bottom: 8px;">📊 Değerlendirmeler</div>${report.insights.map(i => `<div class="insight-item"><span style="color: var(--accent);">▸</span> ${i}</div>`).join('')}</div>${report.recommendations.length ? `<div class="ai-recommendations"><div style="font-size: 12px; font-weight: 600; margin-bottom: 8px;">💡 Öneriler</div>${report.recommendations.map(r => `<div class="rec-item"><span>💡</span><span>${r}</span></div>`).join('')}</div>` : ''}</div>`;
      const toolbar = $('.toolbar');
      if (toolbar?.parentNode) toolbar.parentNode.insertBefore(div, toolbar.nextSibling);
    },

    checkAlerts() {
      $$('.detail-item').forEach(el => el.classList.remove('alert-pulse'));
      state.data.forEach(item => {
        const alert = state.alerts[item.urun];
        if (!alert) return;
        const kz = item.guncelDeger - item.toplamYatirim;
        const prevValue = item.guncelDeger - (item.gunluk || 0);
        const dailyPct = prevValue ? ((item.gunluk || 0) / prevValue) * 100 : 0;
        const hit = (alert.guncel && item.guncelDeger >= alert.guncel) || (alert.kz && kz >= alert.kz) || (alert.dailyPerc && Math.abs(dailyPct) >= alert.dailyPerc);
        if (hit) {
          const el = Array.from($$('.detail-item')).find(n => n.dataset.urun === item.urun);
          if (el) el.classList.add('alert-pulse');
        }
      });
    },

    updateLastUpdate() {
      const el = $('#last-update');
      if (el && state.autoRefresh.lastUpdate) {
        el.textContent = `Son: ${new Date(state.autoRefresh.lastUpdate).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`;
      }
    }
  };

  // === MODAL (Çalışan 6 Dönem Grafiği) ===
  const Modal = {
    open(item) {
      const modal = $('#modal');
      const body = $('.modal-body', modal);
      const portSum = sum(state.data, 'guncelDeger');
      const kz = item.guncelDeger - item.toplamYatirim;
      const weight = portSum ? ((item.guncelDeger / portSum) * 100).toFixed(1) : 0;
      const alerts = state.alerts[item.urun] || {};
      const holdTime = getHoldTime(item.tarih);
      const adet = item.adet || Math.floor(item.toplamYatirim / (item.alisFiyati || item.guncelDeger)) || 1;
      const unitCost = item.toplamYatirim / adet;
      const unitCurrent = item.guncelDeger / adet;

      // Tablo satırları
      const kzRows = CONFIG.PERIODS.map(({ key, label, short }) => {
        const change = item[key] || 0;
        const returnPct = item.toplamYatirim ? ((change / item.toplamYatirim) * 100) : 0;
        return `<tr class="${change >= 0 ? 'pos-row' : 'neg-row'}">
          <td class="period-cell"><span class="period-short">${short}</span><span class="period-full">${label}</span></td>
          <td class="change-cell ${change >= 0 ? 'pos' : 'neg'}">${change >= 0 ? '+' : ''}${formatCompact(change)}</td>
          <td class="kz-cell ${change >= 0 ? 'pos' : 'neg'}">${change >= 0 ? '+' : ''}${formatCompact(change)}</td>
          <td class="return-cell ${returnPct >= 0 ? 'pos' : 'neg'}">${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(1)}%</td>
        </tr>`;
      }).join('');

      body.innerHTML = `
        <div class="modal-grid compact">
          <div class="stat product-stat">
            <div class="small">Ürün</div>
            <div class="product-name">${item.urun}</div>
            <div class="product-meta">${item.tur} · %${weight}${holdTime ? ` · ⏱${holdTime}` : ''}</div>
          </div>
          <div class="stat value-stat">
            <div class="small">Değerler</div>
            <div class="value-row"><span>Güncel:</span><strong>${formatTRY(item.guncelDeger)}</strong></div>
            <div class="value-row"><span>Maliyet:</span><strong>${formatTRY(item.toplamYatirim)}</strong></div>
            <div class="value-row ${kz >= 0 ? 'pos' : 'neg'}"><span>K/Z:</span><strong>${formatTRY(kz)}</strong></div>
          </div>
          <div class="stat unit-stat" style="grid-column: 1 / -1">
            <div class="small">Birim Bilgileri</div>
            <div class="unit-grid">
              <div class="unit-box"><div class="unit-label">Adet</div><div class="unit-value">${adet.toLocaleString('tr-TR')}</div></div>
              <div class="unit-box"><div class="unit-label">Ort. Maliyet</div><div class="unit-value">${formatTRY(unitCost)}</div></div>
              <div class="unit-box"><div class="unit-label">Güncel Fiyat</div><div class="unit-value ${unitCurrent >= unitCost ? 'pos' : 'neg'}">${formatTRY(unitCurrent)}</div></div>
              <div class="unit-box"><div class="unit-label">Birim K/Z</div><div class="unit-value ${unitCurrent >= unitCost ? 'pos' : 'neg'}">${formatTRY(unitCurrent - unitCost)}</div></div>
            </div>
          </div>
          <div class="stat table-stat" style="grid-column: 1 / -1">
            <div class="small">Dönemsel Performans</div>
            <div class="compact-table-wrapper">
              <table class="compact-table">
                <thead><tr><th>Dönem</th><th>Değişim</th><th>K/Z</th><th>Getiri</th></tr></thead>
                <tbody>${kzRows}</tbody>
              </table>
            </div>
          </div>
          <div class="stat chart-stat" style="grid-column: 1 / -1">
            <div class="small">📈 Performans Görselleştirme (Gerçek Veriler)</div>
            <div class="chart-container" id="price-chart-container">
              <canvas id="price-chart"></canvas>
              <div class="chart-overlay" id="chart-overlay">Grafik yükleniyor...</div>
            </div>
            <div class="chart-info">
              <span class="chart-badge">6 Dönem</span>
              <span class="chart-badge">CSV Verisi</span>
            </div>
          </div>
          <div class="stat alert-stat" style="grid-column: 1 / -1">
            <div class="small">🔔 Fiyat Uyarıları</div>
            <div class="alert-form compact">
              <div><label>Değer ≥</label><input id="al-guncel" type="number" placeholder="100000" value="${alerts.guncel || ''}"></div>
              <div><label>K/Z ≥</label><input id="al-kz" type="number" placeholder="5000" value="${alerts.kz || ''}"></div>
              <div><label>Günlük% ≥</label><input id="al-dp" type="number" step="0.1" placeholder="2.5" value="${alerts.dailyPerc || ''}"></div>
            </div>
            <div class="modal-actions compact">
              <button class="btn" id="al-remove">Sil</button>
              <button class="btn primary" id="al-save">Kaydet</button>
            </div>
          </div>
        </div>
      `;

      // Modal açıldıktan sonra grafiği çiz (animasyon bitince)
      requestAnimationFrame(() => {
        setTimeout(() => this.drawPeriodChart(item), 100);
      });

      this.setupAlertButtons(item);
      modal.classList.add('active');
      modal.hidden = false;
    },

    drawPeriodChart(item) {
      const canvas = $('#price-chart');
      const overlay = $('#chart-overlay');
      
      if (!canvas) {
        console.error('Canvas bulunamadı');
        return;
      }

      // CSV'den gelen 6 dönem verisi
      const periodData = CONFIG.PERIODS.map(({ key, label }) => ({
        label: label.replace(' ', '\n'), // 2 satır için
        shortLabel: label,
        value: item[key] || 0
      }));

      console.log('Grafik verileri:', periodData);

      // Container boyutlarını al
      const container = canvas.parentElement;
      const rect = container.getBoundingClientRect();
      
      if (rect.width === 0 || rect.height === 0) {
        console.error('Container boyutları sıfır:', rect);
        overlay.textContent = 'Boyut hatası';
        overlay.classList.add('error');
        return;
      }

      // Canvas ayarları (High DPI)
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';

      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      const w = rect.width;
      const h = rect.height;
      const pad = { top: 40, right: 20, bottom: 60, left: 60 };
      const cw = w - pad.left - pad.right;
      const ch = h - pad.top - pad.bottom;

      // Maksimum değer (pozitif ve negatif ayrı ayrı)
      const maxPositive = Math.max(...periodData.map(d => Math.max(0, d.value)), 1);
      const maxNegative = Math.max(...periodData.map(d => Math.max(0, -d.value)), 1);
      const maxVal = Math.max(maxPositive, maxNegative);

      // Temizle
      ctx.clearRect(0, 0, w, h);
      overlay.style.display = 'none';

      // Başlık
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`${item.urun} - Dönemsel Değişim Analizi`, w / 2, 25);

      // Grid çizgileri (yatay)
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = pad.top + (ch / 4) * i;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(w - pad.right, y);
        ctx.stroke();
      }

      // Sıfır çizgisi (orta, kalın)
      const zeroY = pad.top + (ch / 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pad.left, zeroY);
      ctx.lineTo(w - pad.right, zeroY);
      ctx.stroke();

      // Bar ayarları
      const barCount = periodData.length;
      const barWidth = (cw / barCount) * 0.65;
      const barGap = (cw / barCount) * 0.35;

      // Barları çiz
      periodData.forEach((d, i) => {
        const x = pad.left + (i * (barWidth + barGap)) + barGap / 2;
        const barHeight = (Math.abs(d.value) / maxVal) * (ch / 2);
        const y = d.value >= 0 ? zeroY - barHeight : zeroY;
        const isPositive = d.value >= 0;
        
        // Gradient oluştur
        const grad = ctx.createLinearGradient(0, y, 0, isPositive ? y + barHeight : y + barHeight);
        if (isPositive) {
          grad.addColorStop(0, '#22c55e');
          grad.addColorStop(0.7, 'rgba(34,197,94,0.6)');
          grad.addColorStop(1, 'rgba(34,197,94,0.2)');
        } else {
          grad.addColorStop(0, '#ef4444');
          grad.addColorStop(0.7, 'rgba(239,68,68,0.6)');
          grad.addColorStop(1, 'rgba(239,68,68,0.2)');
        }
        
        // Bar gölgesi
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(x + 3, y + 3, barWidth, barHeight);

        // Bar
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barWidth, barHeight);
        
        // Bar kenarı
        ctx.strokeStyle = isPositive ? '#22c55e' : '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, barWidth, barHeight);

        // Değer etiketi (barın üzerinde)
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const labelY = isPositive ? y - 6 : y + barHeight + 16;
        ctx.fillText(formatCompact(d.value), x + barWidth / 2, labelY);

        // X ekseni etiketi (dönem adı)
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '10px system-ui';
        ctx.textBaseline = 'top';
        const lines = d.shortLabel.split(' ');
        lines.forEach((line, lineIdx) => {
          ctx.fillText(line, x + barWidth / 2, h - pad.bottom + 10 + (lineIdx * 14));
        });
      });

      // Y ekseni etiketleri
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let i = 0; i <= 4; i++) {
        const val = maxVal * (1 - i / 2);
        const y = pad.top + (ch / 4) * i;
        ctx.fillText(formatCompact(val), pad.left - 8, y);
      }

      // Pozitif/Negatif göstergesi
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(w - 30, 20, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText('Pozitif', w - 20, 20);

      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(w - 30, 35, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('Negatif', w - 20, 35);
    },

    setupAlertButtons(item) {
      $('#al-save').onclick = () => {
        state.alerts[item.urun] = {
          guncel: toNumber($('#al-guncel')?.value) || null,
          kz: toNumber($('#al-kz')?.value) || null,
          dailyPerc: parseFloat($('#al-dp')?.value) || null
        };
        storage.set('alerts', state.alerts);
        UI.showToast('Uyarılar kaydedildi');
      };
      $('#al-remove').onclick = () => {
        delete state.alerts[item.urun];
        storage.set('alerts', state.alerts);
        UI.showToast('Uyarılar silindi');
        $('#al-guncel').value = '';
        $('#al-kz').value = '';
        $('#al-dp').value = '';
      };
    },

    close() {
      const modal = $('#modal');
      if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.hidden = true, 300);
      }
    }
  };

  // === TOOLBAR ===
  const Toolbar = {
    init() {
      const container = $('#toolbar-container');
      if (!container || $('.toolbar')) return;
      const toolbar = document.createElement('div');
      toolbar.className = 'toolbar';
      toolbar.innerHTML = `<div class="card"><div class="toolbar-group"><label>Sıralama</label><select id="sort-select"><option value="default">Varsayılan</option><option value="kzDesc">K/Z (yüksek→düşük)</option><option value="kzAsc">K/Z (düşük→yüksek)</option><option value="maliyetDesc">Maliyet</option><option value="guncelDesc">Güncel</option><option value="nameAZ">A→Z</option><option value="nameZA">Z→A</option></select></div><div class="toolbar-group"><label>Oto Yenile</label><input id="autoref" type="checkbox"><select id="arate"><option value="30000">30s</option><option value="60000" selected>1dk</option><option value="300000">5dk</option></select></div><div class="toolbar-group"><button class="btn primary" id="ai-analyze-btn">🤖 AI</button><span class="last-update" id="last-update">Son: -</span></div></div>`;
      container.appendChild(toolbar);

      $('#sort-select').onchange = e => { state.sortKey = e.target.value; renderAll(); };
      $('#autoref').onchange = e => {
        state.autoRefresh.enabled = e.target.checked;
        state.autoRefresh.enabled ? this.startAutoRefresh() : this.stopAutoRefresh();
      };
      $('#arate').onchange = e => {
        state.autoRefresh.ms = +e.target.value;
        if (state.autoRefresh.enabled) this.startAutoRefresh();
      };
      $('#ai-analyze-btn').onclick = () => UI.renderAIAnalysis();

      const modal = $('#modal');
      if (modal) {
        modal.addEventListener('click', e => {
          if (e.target.classList.contains('modal-backdrop') || e.target.classList.contains('modal-close')) Modal.close();
        });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.classList.contains('active')) Modal.close(); });
      }
    },

    startAutoRefresh() {
      this.stopAutoRefresh();
      state.autoRefresh.timer = setInterval(async () => {
        try {
          const resp = await fetch(`${CONFIG.CSV_URL}&t=${Date.now()}`);
          const text = await resp.text();
          const parsed = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
          state.data = parsed.data.map(r => ({
            urun: cleanStr(r['urun']), tur: cleanStr(r['tur']) || 'Hisse', tarih: cleanStr(r['tarih']),
            toplamYatirim: toNumber(r['toplamYatirim']), guncelDeger: toNumber(r['guncelDeger']),
            gunluk: toNumber(r['gunluk']), haftalik: toNumber(r['haftalik']), aylik: toNumber(r['aylik']),
            ucAylik: toNumber(r['ucAylik']), altiAylik: toNumber(r['altiAylik']), birYillik: toNumber(r['birYillik']),
            adet: toNumber(r['adet']), alisFiyati: toNumber(r['alisFiyati'])
          })).filter(x => x.urun && x.toplamYatirim > 0);
          state.cache = {};
          state.autoRefresh.lastUpdate = new Date();
          renderAll();
          UI.showToast('Veriler yenilendi');
        } catch (e) { console.error('Yenileme hatası', e); }
      }, state.autoRefresh.ms);
    },

    stopAutoRefresh() {
      if (state.autoRefresh.timer) { clearInterval(state.autoRefresh.timer); state.autoRefresh.timer = null; }
    }
  };

  // === ANA RENDER ===
  function renderAll() {
    const cacheKey = `filter:${state.activeFilter}`;
    let filtered = state.cache[cacheKey];
    if (!filtered) {
      filtered = state.activeFilter === 'ALL' ? state.data : state.data.filter(x => x.tur === state.activeFilter);
      state.cache[cacheKey] = filtered;
    }
    UI.renderSummary(filtered);
    UI.renderTypes();
    UI.renderPeriods(filtered);
    UI.renderDetails(filtered);
    UI.updateTicker();
    UI.checkAlerts();
    UI.updateLastUpdate();
  }

  // === BASLATMA ===
  async function init() {
    const loader = $('#loader');
    if (loader) loader.removeAttribute('hidden');
    try {
      const resp = await fetch(`${CONFIG.CSV_URL}&t=${Date.now()}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      if (!text || text.includes('<!DOCTYPE')) throw new Error("Geçersiz yanıt");
      if (typeof Papa === 'undefined') throw new Error("Papa Parse yüklenmemiş");
      const parsed = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
      if (parsed.data.length === 0) throw new Error("CSV boş");
      state.data = parsed.data.map(r => ({
        urun: cleanStr(r['urun']), tur: cleanStr(r['tur']) || 'Hisse', tarih: cleanStr(r['tarih']),
        toplamYatirim: toNumber(r['toplamYatirim']), guncelDeger: toNumber(r['guncelDeger']),
        gunluk: toNumber(r['gunluk']), haftalik: toNumber(r['haftalik']), aylik: toNumber(r['aylik']),
        ucAylik: toNumber(r['ucAylik']), altiAylik: toNumber(r['altiAylik']), birYillik: toNumber(r['birYillik']),
        adet: toNumber(r['adet']), alisFiyati: toNumber(r['alisFiyati'])
      })).filter(x => x.urun && x.toplamYatirim > 0);
      if (state.data.length === 0) throw new Error("Geçerli veri bulunamadı");
      state.alerts = storage.get('alerts', {});
      state.autoRefresh.lastUpdate = new Date();
      Toolbar.init();
      if (loader) loader.setAttribute('hidden', '');
      renderAll();
      Mobile.init();
      UI.showToast(`${state.data.length} ürün yüklendi`);
    } catch (err) {
      console.error("Hata:", err);
      if (loader) loader.innerHTML = `<div style="color:#ef4444; padding:20px; text-align:center;"><div style="font-size:18px; margin-bottom:10px;">⚠️ ${err.message}</div><button onclick="location.reload()" style="padding:10px 20px; background:#3b82f6; border:none; border-radius:6px; color:white; cursor:pointer;">Yenile</button></div>`;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const searchInput = $('#search');
    if (searchInput) {
      searchInput.addEventListener('input', e => {
        const q = e.target.value.toLowerCase().trim();
        requestAnimationFrame(() => { $$('.detail-item').forEach(it => { it.style.display = !q || it.textContent.toLowerCase().includes(q) ? '' : 'none'; }); });
      });
    }
    init();
  });

  return { init, renderAll, state };
})();
