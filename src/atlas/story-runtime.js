import { dataBroker } from '../core/data-broker.js';
import { atlasStatus } from '../core/status-store.js';

export function initStoryRuntime() {
  'use strict';
  const runtimeController = new AbortController();
  const revealEls = document.querySelectorAll('.reveal');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    revealEls.forEach(el => el.classList.add('is-visible'));
  } else {
    let staggerIndex = 0;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.style.setProperty('--reveal-delay', `${(staggerIndex % 5) * 70}ms`);
        staggerIndex++;
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      });
    }, { threshold: 0.16, rootMargin: '0px 0px -8% 0px' });
    revealEls.forEach(el => io.observe(el));
  }
  document.querySelectorAll('.craft-row').forEach(row => {
    const toggle = row.querySelector('.craft-toggle');
    const openLabel = toggle ? toggle.textContent : null;
    function setOpen(open) {
      row.classList.toggle('is-open', open);
      row.setAttribute('aria-expanded', String(open));
      if (toggle) toggle.textContent = open ? 'Hide' : openLabel;
    }
    row.addEventListener('click', () => setOpen(!row.classList.contains('is-open')));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setOpen(!row.classList.contains('is-open'));
      }
    });
  });
  const clockEl = document.getElementById('footerClock');
  if (clockEl) {
    function tickClock() {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      clockEl.textContent = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
    }
    tickClock();
    setInterval(tickClock, 1000);
  }
  const EONET_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=100';

  function renderSpark(counts) {
    const list = document.getElementById('obsSparkList');
    const wrap = document.getElementById('obsSpark');
    if (!list || !wrap || !counts.length) return;
    const max = Math.max(...counts.map(c => c.count), 1);
    list.replaceChildren(...counts.map((c) => {
      const row = document.createElement('div');
      row.className = 'obs-spark-row';

      const name = document.createElement('span');
      name.className = 'obs-spark-name';
      name.textContent = c.label;

      const track = document.createElement('span');
      track.className = 'obs-spark-track';
      const fill = document.createElement('span');
      fill.className = 'obs-spark-fill';
      fill.style.width = `${Math.max(3, Math.round((c.count / max) * 100))}%`;
      track.appendChild(fill);

      const count = document.createElement('span');
      count.className = 'obs-spark-count';
      count.textContent = String(c.count);

      row.append(name, track, count);
      return row;
    }));
    wrap.hidden = false;
  }
  let lastEventCoords = [];
  const dataSourcesSection = document.getElementById('data-sources');
  if (dataSourcesSection && 'ResizeObserver' in window) {
    let redrawScheduled = false;
    const ro = new ResizeObserver(() => {
      if (redrawScheduled) return;
      redrawScheduled = true;
      requestAnimationFrame(() => {
        redrawScheduled = false;
        if (lastEventCoords.length) renderDataSourcesMap(lastEventCoords);
      });
    });
    ro.observe(dataSourcesSection);
  }

  let dataSourcesMapFrame = 0;
  let dataSourcesMapVisible = true;
  let dataSourcesMapSize = { w: 0, h: 0, dpr: 1 };

  function projectEventCoord(e, w, h) {
    return {
      x: ((e.lon + 180) / 360) * w,
      y: ((90 - e.lat) / 180) * h,
    };
  }

  function sizeDataSourcesMap(canvas, section) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = section.clientWidth;
    const h = section.clientHeight;
    if (!w || !h) return null;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      dataSourcesMapSize = { w, h, dpr };
    }
    return dataSourcesMapSize;
  }

  function drawDataSourcesMap(time = 0) {
    const canvas = document.getElementById('dataSourcesMap');
    const section = document.getElementById('data-sources');
    if (!canvas || !section || !lastEventCoords.length) {
      dataSourcesMapFrame = 0;
      return;
    }
    const size = sizeDataSourcesMap(canvas, section);
    if (!size) return;
    const { w, h, dpr } = size;
    const ctx = canvas.getContext('2d');
    const t = time * 0.001;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const wash = ctx.createRadialGradient(w * 0.52, h * 0.44, 0, w * 0.52, h * 0.44, Math.max(w, h) * 0.72);
    wash.addColorStop(0, 'rgba(34,211,238,0.055)');
    wash.addColorStop(0.42, 'rgba(139,92,246,0.035)');
    wash.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(230,238,255,0.045)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const x = (w / 8) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let i = 1; i < 4; i++) {
      const y = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const points = lastEventCoords.map(e => projectEventCoord(e, w, h));
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const pulse = (Math.sin(t * 1.35 + i * 0.71) + 1) * 0.5;
      const alpha = 0.18 + pulse * 0.28;
      ctx.beginPath();
      ctx.fillStyle = `rgba(196,181,253,${alpha})`;
      ctx.shadowBlur = 10 + pulse * 8;
      ctx.shadowColor = 'rgba(139,92,246,0.55)';
      ctx.arc(p.x, p.y, 1.4 + pulse * 1.3, 0, Math.PI * 2);
      ctx.fill();

      if (i < 18) {
        const ring = 5 + ((t * 16 + i * 9) % 28);
        const ringAlpha = Math.max(0, 0.16 - ring / 190);
        ctx.beginPath();
        ctx.strokeStyle = `rgba(34,211,238,${ringAlpha})`;
        ctx.lineWidth = 1;
        ctx.arc(p.x, p.y, ring, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.restore();
    if (dataSourcesMapVisible && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      dataSourcesMapFrame = requestAnimationFrame(drawDataSourcesMap);
    } else {
      dataSourcesMapFrame = 0;
    }
  }

  function renderDataSourcesMap(eventCoords) {
    lastEventCoords = eventCoords;
    if (dataSourcesMapFrame) cancelAnimationFrame(dataSourcesMapFrame);
    dataSourcesMapFrame = requestAnimationFrame(drawDataSourcesMap);
  }

  if (dataSourcesSection && 'IntersectionObserver' in window) {
    const mapObserver = new IntersectionObserver((entries) => {
      dataSourcesMapVisible = entries.some(entry => entry.isIntersecting);
      if (dataSourcesMapVisible && lastEventCoords.length && !dataSourcesMapFrame) {
        dataSourcesMapFrame = requestAnimationFrame(drawDataSourcesMap);
      }
    }, { threshold: 0.08 });
    mapObserver.observe(dataSourcesSection);
  }

  async function loadEonetSnapshot() {
    try {
      const json = await dataBroker.fetchEonet(EONET_URL, { signal: runtimeController.signal });
      const events = Array.isArray(json.events) ? json.events : [];
      if (!events.length) throw new Error('empty');

      let latest = null;
      const categoryCounts = new Map();
      const eventCoords = [];
      for (const ev of events) {
        const geom = Array.isArray(ev.geometry) ? ev.geometry[ev.geometry.length - 1] : null;
        const date = geom && geom.date;
        if (date && (!latest || new Date(date) > new Date(latest))) latest = date;
        const cats = Array.isArray(ev.categories) ? ev.categories : [];
        const label = cats[0] && cats[0].title ? cats[0].title : 'Other';
        categoryCounts.set(label, (categoryCounts.get(label) || 0) + 1);
        const coords = geom && Array.isArray(geom.coordinates) ? geom.coordinates : null;
        if (coords && coords.length >= 2) {
          const lon = Number(coords[0]);
          const lat = Number(coords[1]);
          if (Number.isFinite(lon) && Number.isFinite(lat)) eventCoords.push({ lon, lat });
        }
      }
      renderDataSourcesMap(eventCoords);
      atlasStatus.setSourceTimestamp('eonet', latest);

      const sorted = [...categoryCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([label, count]) => ({ label, count }));
      renderSpark(sorted);
    } catch (err) {
      console.warn('EONET snapshot unavailable — retaining the explicit fallback state.', err);
    }
  }

  loadEonetSnapshot();
  return Object.freeze({
    dispose() {
      runtimeController.abort(new DOMException('Story runtime disposed', 'AbortError'));
      if (dataSourcesMapFrame) cancelAnimationFrame(dataSourcesMapFrame);
    },
  });
}
