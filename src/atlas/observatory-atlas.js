import { PLATFORM_TAXONOMY } from '../config/platform-taxonomy.js?v=taxonomyV4';
import { OBSERVATORY_REGISTRY } from '../config/observatory-registry.js?v=taxonomyV4';
import { observatoryRuntime } from '../core/observatory-runtime-store.js';

let platformFilters = { family: 'all', scale: 'all', status: 'all' };

const familyById = new Map(PLATFORM_TAXONOMY.families.map(item => [item.id,item]));
    const scaleById = new Map(PLATFORM_TAXONOMY.scales.map(item => [item.id,item]));
    const scaleAxisById = new Map(PLATFORM_TAXONOMY.scaleAxes.map(item => [item.id,item]));
    const conceptualScaleById = new Map(PLATFORM_TAXONOMY.conceptualScales.map(item => [item.id,item]));
    const statusById = new Map(PLATFORM_TAXONOMY.statuses.map(item => [item.id,item]));
    const representationById = new Map(PLATFORM_TAXONOMY.representations.map(item => [item.id,item]));

    function createElement(tag, className, textContent) {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (textContent !== undefined) element.textContent = textContent;
      return element;
    }

    function getScopeLabel(item) {
      const scale = scaleById.get(item.scale)?.label || item.scale;
      const axis = scaleAxisById.get(item.scaleAxis || 'physical');
      const conceptual = item.conceptualScale
        ? conceptualScaleById.get(item.conceptualScale)?.label || item.conceptualScale
        : null;
      return item.scaleAxis && item.scaleAxis !== 'physical'
        ? `${axis?.label || item.scaleAxis}: ${conceptual || scale}`
        : scale;
    }

    function getScopeCoordinate(item) {
      const family = familyById.get(item.family)?.short || item.family;
      return `${family} / ${getScopeLabel(item)}`;
    }

    function renderFeaturedObservatories() {
      const grid = document.getElementById('observatoryAtlasGrid');
      if (!grid) return;
      const filters = platformFilters || {family:'all',scale:'all',status:'all'};
      const items = OBSERVATORY_REGISTRY.filter(item =>
        (filters.family === 'all' || item.family === filters.family) &&
        (filters.scale === 'all' || item.scale === filters.scale) &&
        (filters.status === 'all' || item.status === filters.status)
      );
      grid.dataset.count = String(items.length);
      grid.classList.toggle('is-dual', items.length === 2);
      if (!items.length) {
        const empty = createElement('div','observatory-empty');
        empty.innerHTML = '<strong>No mapped observatory in this intersection.</strong><p>The taxonomy remains available for future registry entries; no placeholder observatory is presented as an active project.</p>';
        grid.replaceChildren(empty);
        return;
      }
      grid.replaceChildren(...items.map((item) => {
        const article = createElement('article','obs-card reveal is-visible');
        article.dataset.observatoryId = item.id;
        article.style.setProperty('--obs-accent-rgb', item.accent);
        article.style.setProperty('--obs-secondary-rgb', item.secondaryAccent);

        const head = createElement('div','obs-card-meta');
        const status = createElement('span',`obs-status ${item.status === 'live' ? 'live' : item.status === 'development' ? 'soon' : ''}`,statusById.get(item.status)?.label || item.status);
        const coordinate = createElement('span','obs-coordinate',`${familyById.get(item.family)?.short || item.family} · ${scaleById.get(item.scale)?.label || item.scale}`);
        coordinate.textContent = getScopeCoordinate(item);
        const hasPublicRoute = Boolean(item.route);
        const runtime = hasPublicRoute ? observatoryRuntime.get(item.id) : null;
        const runtimeStatus = createElement('span','obs-runtime-status',runtime?.value || (hasPublicRoute ? 'FALLBACK' : 'ROADMAP'));
        runtimeStatus.dataset.observatoryRuntime = item.id;
        runtimeStatus.dataset.state = runtime?.state || (hasPublicRoute ? 'fallback' : 'declared');
        head.append(status,runtimeStatus,coordinate);

        const title = createElement('h3');
        title.append(document.createTextNode(item.title + ' '));
        const em = createElement('em',null,item.subtitle);
        title.append(em);
        const description = createElement('p',null,item.description);
        const features = createElement('ul','obs-features');
        features.append(...item.features.map(feature => createElement('li',null,feature)));
        const semantics = createElement('div','obs-semantics');
        semantics.append(...item.representations.map(id => {
          const chip = createElement('span',`representation representation-${id}`,representationById.get(id)?.label || id);
          return chip;
        }));
        article.append(head,title,description,features,semantics);
        if (item.id === 'living-earth') {
          const spark = createElement('div','obs-spark');
          spark.id = 'obsSpark'; spark.hidden = true;
          const label = createElement('span','obs-spark-label','Open events by category, right now');
          const list = createElement('div'); list.id = 'obsSparkList';
          spark.append(label,list); article.append(spark);
        }
        if (item.route) {
          const link = createElement('a','obs-cta',`Enter ${item.title} →`);
          link.href = item.route; article.append(link);
        } else {
          const availabilityLabel = item.status === 'research'
            ? 'Research mapped'
            : item.status === 'planned'
              ? 'Planned'
              : 'In development';
          article.append(createElement('span','obs-cta disabled',availabilityLabel));
        }
        return article;
      }));
    }

    function renderTaxonomy() {
      const familyGrid = document.getElementById('observatoryFamilyGrid');
      const scaleTrack = document.getElementById('observatoryScaleTrack');
      const familySelect = document.getElementById('observatoryFamilyFilter');
      const scaleSelect = document.getElementById('observatoryScaleFilter');
      const statusSelect = document.getElementById('observatoryStatusFilter');
      const summary = document.getElementById('observatoryRegistrySummary');
      if (!familyGrid || !scaleTrack || !familySelect || !scaleSelect || !statusSelect) return;

      const familyCounts = new Map(PLATFORM_TAXONOMY.families.map(item => [item.id,0]));
      const scaleCounts = new Map(PLATFORM_TAXONOMY.scales.map(item => [item.id,0]));
      const statusCounts = new Map(PLATFORM_TAXONOMY.statuses.map(item => [item.id,0]));
      OBSERVATORY_REGISTRY.forEach(item => {
        familyCounts.set(item.family,(familyCounts.get(item.family)||0)+1);
        scaleCounts.set(item.scale,(scaleCounts.get(item.scale)||0)+1);
        statusCounts.set(item.status,(statusCounts.get(item.status)||0)+1);
      });

      familyGrid.replaceChildren(...PLATFORM_TAXONOMY.families.map((family) => {
        const count = familyCounts.get(family.id) || 0;
        const button = createElement('button','observatory-family');
        button.type = 'button'; button.dataset.family = family.id;
        button.style.setProperty('--family-accent-rgb',family.accent);
        button.disabled = count === 0;
        button.innerHTML = `<span>${family.label}</span><strong>${count ? `${count} mapped` : 'registry ready'}</strong><p>${family.description}</p>`;
        return button;
      }));

      scaleTrack.replaceChildren(...PLATFORM_TAXONOMY.scales.map((scale) => {
        const count = scaleCounts.get(scale.id) || 0;
        const button = createElement('button','observatory-scale');
        button.type = 'button'; button.dataset.scale = scale.id; button.disabled = count === 0;
        button.innerHTML = `<i></i><span>${scale.label}</span><small>${count || '—'}</small>`;
        return button;
      }));

      const addOptions = (select, collection, counts) => {
        const first = select.querySelector('option[value="all"]');
        select.replaceChildren(first || new Option('All','all'));
        collection.forEach(item => {
          const count = counts.get(item.id) || 0;
          const option = new Option(`${item.label} · ${count}`,item.id);
          option.disabled = count === 0;
          select.add(option);
        });
      };
      addOptions(familySelect,PLATFORM_TAXONOMY.families,familyCounts);
      addOptions(scaleSelect,PLATFORM_TAXONOMY.scales,scaleCounts);
      addOptions(statusSelect,PLATFORM_TAXONOMY.statuses,statusCounts);
      if (summary) {
        const live = statusCounts.get('live') || 0;
        const development = statusCounts.get('development') || 0;
        summary.textContent = `${OBSERVATORY_REGISTRY.length} mapped · ${live} live · ${development} in development · ${PLATFORM_TAXONOMY.families.length} families available`;
      }

      platformFilters = {family:'all',scale:'all',status:'all'};
      const syncFilters = () => {
        platformFilters = {family:familySelect.value,scale:scaleSelect.value,status:statusSelect.value};
        familyGrid.querySelectorAll('[data-family]').forEach(button => button.classList.toggle('is-active',button.dataset.family === familySelect.value));
        scaleTrack.querySelectorAll('[data-scale]').forEach(button => button.classList.toggle('is-active',button.dataset.scale === scaleSelect.value));
        renderFeaturedObservatories();
      };
      [familySelect,scaleSelect,statusSelect].forEach(select => select.addEventListener('change',syncFilters));
      familyGrid.addEventListener('click',(event) => {
        const button = event.target.closest('[data-family]'); if (!button || button.disabled) return;
        familySelect.value = familySelect.value === button.dataset.family ? 'all' : button.dataset.family; syncFilters();
      });
      scaleTrack.addEventListener('click',(event) => {
        const button = event.target.closest('[data-scale]'); if (!button || button.disabled) return;
        scaleSelect.value = scaleSelect.value === button.dataset.scale ? 'all' : button.dataset.scale; syncFilters();
      });
      document.getElementById('observatoryFiltersReset')?.addEventListener('click',() => {
        familySelect.value = 'all'; scaleSelect.value = 'all'; statusSelect.value = 'all'; syncFilters();
      });
      syncFilters();
    }


    function renderProvenanceFilters() {
      const host = document.getElementById('provenanceFilterButtons');
      if (!host) return;
      const entries = [
        {id:'all',label:'All'},
        {id:'gateway',label:'Gateway'},
        ...OBSERVATORY_REGISTRY
          .filter(item => item.route)
          .map(item => ({id:item.provenanceTag,label:item.title.replace(/^Living\s+/,'')}))
      ];
      host.replaceChildren(...entries.map((entry,index) => {
        const button = createElement('button',`provenance-filter${index===0?' is-active':''}`,entry.label);
        button.type='button'; button.dataset.provenanceFilter=entry.id; button.setAttribute('aria-pressed',String(index===0));
        return button;
      }));
    }

    function renderRoadmapPortfolio() {
      const host = document.getElementById('roadmapModuleBoard');
      const summary = document.getElementById('roadmapPortfolioSummary');
      if (!host) return;

      const counts = OBSERVATORY_REGISTRY.reduce((result, item) => {
        result[item.status] = (result[item.status] || 0) + 1;
        return result;
      }, {});
      if (summary) {
        summary.textContent = `${counts.live || 0} live / ${counts.development || 0} in development / ${(counts.research || 0) + (counts.planned || 0)} research-planned`;
      }

      host.replaceChildren(...OBSERVATORY_REGISTRY.map((item) => {
        const roadmap = item.roadmap || { progress: 0, stage: 'Mapped', next: 'Define the first evidence-backed milestone' };
        const card = createElement('article', 'roadmap-module');
        card.dataset.state = item.status;
        card.style.setProperty('--module-progress', `${roadmap.progress}%`);

        const head = createElement('div', 'roadmap-module-head');
        const status = createElement('span', 'roadmap-module-status', statusById.get(item.status)?.label || item.status);
        const progressLabel = roadmap.progress > 0 ? `${roadmap.progress}%` : 'Not started';
        const progress = createElement('strong', 'roadmap-module-progress-label', progressLabel);
        head.append(status, progress);

        const title = createElement('h3', null, item.title);
        const subtitle = createElement('p', 'roadmap-module-scope', `${familyById.get(item.family)?.label || item.family} / ${scaleById.get(item.scale)?.label || item.scale}`);
        subtitle.textContent = `${familyById.get(item.family)?.label || item.family} / ${getScopeLabel(item)}`;
        const stage = createElement('p', 'roadmap-module-stage', roadmap.stage);
        const rail = createElement('div', 'roadmap-module-rail');
        rail.setAttribute('aria-label', roadmap.progress > 0
          ? `${item.title} platform integration progress: ${roadmap.progress}%`
          : `${item.title} has no shipped implementation yet`);
        rail.append(createElement('span'));
        const next = createElement('p', 'roadmap-module-next');
        next.append(document.createTextNode('Next threshold: '), createElement('strong', null, roadmap.next));
        card.append(head, title, subtitle, stage, rail, next);
        return card;
      }));
    }

export function initObservatoryAtlas() {
  renderTaxonomy();
  renderProvenanceFilters();
  renderRoadmapPortfolio();
  observatoryRuntime.broadcastInitial();
}
