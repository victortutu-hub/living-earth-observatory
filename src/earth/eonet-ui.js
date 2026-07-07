function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function createEonetUi({
    state,
    officialCategories,
    officialCategoryLabels,
    latestGeometry,
    eventCategory,
    eventColor,
    eventDate,
    eventRecency,
    eventSortAge,
    recentBadge,
    editorialSelection,
    onSelectEvent
}) {
    const byId = id => document.getElementById(id);

    function renderDetails(titleText, lines) {
        const panel = byId('details');
        const title = document.createElement('h2');
        const body = document.createElement('p');
        title.textContent = titleText;
        lines.forEach((line, index) => {
            if (index > 0) body.append(document.createElement('br'));
            if (line.label) {
                const label = document.createElement('b');
                label.textContent = `${line.label}:`;
                body.append(label, ' ');
            }
            body.append(line.value);
        });
        panel.replaceChildren(title, body);
    }

    function createChip(color) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.style.color = color;
        chip.style.background = color;
        return chip;
    }

    function appendRecentBadge(parent, event) {
        const badgeMarkup = recentBadge(event);
        if (!badgeMarkup) return;
        const label = badgeMarkup.match(/>([^<]+)</)?.[1];
        if (!label) return;
        const badge = document.createElement('span');
        badge.className = badgeMarkup.includes('badge live') ? 'badge live' : 'badge recent';
        badge.textContent = label;
        parent.append(badge);
    }

    function renderList(events) {
        const list = byId('eventList');
        list.replaceChildren();
        if (!events.length) {
            const empty = document.createElement('div');
            empty.className = 'event';
            const title = document.createElement('div');
            title.className = 'event-title';
            title.textContent = 'No active events found for this filter.';
            empty.append(title);
            list.append(empty);
            return;
        }
        events.slice(0, 120).forEach(event => {
            const category = eventCategory(event);
            const date = latestGeometry(event)?.date || event.geometry?.[0]?.date || 'unknown date';
            const color = eventColor(event);
            const item = document.createElement('div');
            const title = document.createElement('div');
            const meta = document.createElement('div');
            item.className = `event ${event.id === state.selectedId ? 'active' : ''}`;
            item.dataset.id = event.id;
            title.className = 'event-title';
            meta.className = 'event-meta';
            title.append(createChip(color), event.title);
            meta.append(`${category} - ${date.slice(0, 10)}`);
            appendRecentBadge(meta, event);
            item.append(title, meta);
            item.addEventListener('click', () => onSelectEvent(event.id));
            list.append(item);
        });
    }

    function renderTodayOnEarth(events) {
        const panel = byId('todayPanel');
        panel.replaceChildren();
        if (!events.length) {
            state.todayLeadId = null;
            state.todayHighlightIds = [];
            const kicker = document.createElement('div');
            const headline = document.createElement('div');
            const subtitle = document.createElement('div');
            kicker.className = 'editorial-kicker';
            headline.className = 'editorial-headline';
            subtitle.className = 'editorial-subtitle';
            kicker.textContent = 'Today on Earth';
            headline.textContent = 'No fresh signals in this filter';
            subtitle.textContent = 'Try a wider date window or switch back to all categories.';
            panel.append(kicker, headline, subtitle);
            return;
        }
        const highlights = editorialSelection(events, 3, { eventSortAge, eventRecency, eventCategory });
        const freshest = highlights[0];
        state.todayLeadId = freshest?.id || null;
        state.todayHighlightIds = highlights.map(event => event.id);
        const freshDate = eventDate(freshest);
        const statusFilter = byId('statusFilter')?.value || 'open';
        const dataSourceMode = byId('dataSourceFilter')?.value || 'eonet';
        const dataSourceLabel = dataSourceMode === 'gdacs'
            ? 'GDACS alert'
            : dataSourceMode === 'smart'
                ? 'smart fallback signal'
                : 'NASA EONET signal';
        const sourceScope = statusFilter === 'open' ? `open ${dataSourceLabel}` : dataSourceLabel;
        const subtitle = freshDate
            ? `Latest ${sourceScope}: ${freshDate.toISOString().slice(0, 10)} at ${freshDate.toISOString().slice(11, 16)} UTC.`
            : 'Latest real Earth signals, curated into a quick read.';
        const kicker = document.createElement('div');
        const headline = document.createElement('div');
        const subtitleEl = document.createElement('div');
        const feed = document.createElement('div');
        kicker.className = 'editorial-kicker';
        headline.className = 'editorial-headline';
        subtitleEl.className = 'editorial-subtitle';
        feed.className = 'today-feed';
        kicker.textContent = 'Today on Earth';
        headline.textContent = `${highlights.length} active stories shaping the current window`;
        subtitleEl.textContent = subtitle;
        highlights.forEach(event => {
            const category = eventCategory(event);
            const geom = latestGeometry(event);
            const date = geom?.date || 'unknown';
            const color = eventColor(event);
            const item = document.createElement('article');
            const meta = document.createElement('div');
            const title = document.createElement('div');
            item.className = `today-item ${event.id === state.selectedId ? 'active' : ''}`;
            item.dataset.id = event.id;
            meta.className = 'today-meta';
            title.className = 'today-title';
            meta.textContent = `${category} - ${date.slice(0, 10)}`;
            title.append(createChip(color), event.title);
            item.append(meta, title);
            item.addEventListener('click', () => onSelectEvent(event.id));
            feed.append(item);
        });
        panel.append(kicker, headline, subtitleEl, feed);
    }

    function updateStats(events) {
        byId('totalEvents').textContent = events.length;
        byId('activeCategories').textContent = new Set(events.map(eventCategory)).size;
        byId('daysWindow').textContent = byId('daysFilter').value;
    }

    function renderMissingGeometry(event) {
        renderDetails(event.title, [
            { value: 'No valid geometry available for this event.' }
        ]);
    }

    function renderEventDetails(event, geom) {
        const [lon, lat] = geom.coordinates;
        const category = eventCategory(event);
        const source = event.sources?.map(s => s.id).join(', ') || 'unknown source';
        const primarySource = event.sources?.[0] || {};
        const magnitude = Number(geom?.magnitudeValue);
        const depthKm = Number(geom?.depthKm);
        const lines = [
            { label: 'Category', value: category },
            { label: 'Date', value: (geom?.date || 'unknown').replace('T', ' ').replace('Z', ' UTC') },
            { label: 'Coordinates', value: `${Number(lat).toFixed(2)} lat, ${Number(lon).toFixed(2)} lon` },
            { label: 'Source', value: event.sourceProvider || source },
            { label: 'Mode', value: event.sourceMode || 'primary' }
        ];
        if (event.gdacs?.provider) {
            lines.push({ label: 'Provider', value: event.gdacs.provider });
        }
        if (primarySource.url || event.sourceUrl) {
            lines.push({ label: 'Original link', value: primarySource.url || event.sourceUrl });
        }
        if (event.sourceUpdatedAt) {
            lines.push({ label: 'Source updated', value: event.sourceUpdatedAt.replace('T', ' ').replace('Z', ' UTC') });
        }
        if (event.sourceConfidence) {
            lines.push({ label: 'Signal type', value: event.sourceConfidence });
        }
        if (Number.isFinite(magnitude)) {
            lines.push({ label: 'Magnitude', value: `${magnitude.toFixed(1)} ${geom.magnitudeUnit || ''}`.trim() });
        }
        if (Number.isFinite(depthKm)) {
            lines.push({ label: 'Depth', value: `${depthKm.toFixed(1)} km` });
        }
        if (event.usgs) {
            lines.push({
                label: 'USGS',
                value: [event.usgs.status, event.usgs.alert ? `alert ${event.usgs.alert}` : ''].filter(Boolean).join(', ') || event.usgs.code || 'active report'
            });
        }
        if (event.gdacs) {
            lines.push({
                label: 'GDACS',
                value: [event.gdacs.eventType, event.gdacs.alertLevel, event.gdacs.country].filter(Boolean).join(', ')
            });
        }
        if (event.firms) {
            lines.push({
                label: 'FIRMS',
                value: [
                    event.firms.instrument,
                    event.firms.satellite,
                    event.firms.dayNight ? `${event.firms.dayNight} pass` : '',
                    event.firms.frp ? `${event.firms.frp.toFixed(1)} MW FRP` : ''
                ].filter(Boolean).join(', ')
            });
        }
        renderDetails(event.title, lines);
    }

    function renderClusterDetails(cluster) {
        const category = cluster.category;
        const sample = cluster.events.slice(0, 5).map(event => `- ${event.title}`).join('\n');
        const sourceProviders = [...new Set(cluster.events.map(event => event.sourceProvider || event.sources?.[0]?.id || 'NASA EONET'))];
        const representativeSource = cluster.primary.sources?.[0]?.url || cluster.primary.sourceUrl || '';
        const lines = [
            { label: 'Cluster center', value: `${cluster.lat.toFixed(2)} lat, ${cluster.lon.toFixed(2)} lon` },
            { label: 'Newest signal', value: cluster.newestDate ? cluster.newestDate.toISOString().replace('T', ' ').replace('Z', ' UTC') : 'unknown' },
            { label: 'Recent events', value: `${cluster.recentCount} in the last 7 days` },
            { label: 'Sources', value: sourceProviders.join(', ') },
            { label: 'Representative event', value: `${cluster.primary.title}${sample ? `\n${sample}` : ''}` }
        ];
        if (cluster.primary.gdacs?.provider) {
            lines.push({ label: 'Provider', value: cluster.primary.gdacs.provider });
        }
        if (representativeSource) {
            lines.push({ label: 'Original link', value: representativeSource });
        }
        renderDetails(`${cluster.count} nearby ${category} events`, [
            ...lines
        ]);
    }

    function populateCategoryFilter(events) {
        const filter = byId('categoryFilter');
        const current = filter.value;
        const fetchedCategories = [...new Set(events.map(eventCategory))].sort();
        const officialIds = officialCategories.map(category => category.id);
        const extraFetched = fetchedCategories.filter(category => !officialCategoryLabels.has(category));
        state.categoryCatalog = [...new Set([...officialIds, ...extraFetched, current].filter(category => category && category !== 'all'))];
        filter.replaceChildren();
        const allOption = document.createElement('option');
        allOption.value = 'all';
        allOption.textContent = 'All categories';
        filter.append(allOption);
        state.categoryCatalog.forEach(category => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = officialCategoryLabels.get(category) || category;
            filter.append(option);
        });
        filter.value = (current === 'all' || state.categoryCatalog.includes(current)) ? current : 'all';
    }

    return {
        renderList,
        renderTodayOnEarth,
        updateStats,
        renderMissingGeometry,
        renderEventDetails,
        renderClusterDetails,
        populateCategoryFilter,
        renderDetails
    };
}
