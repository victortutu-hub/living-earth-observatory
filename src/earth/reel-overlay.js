import { roundRect, fitText, colorToRgba } from './reel-drawing.js';
import { getVerticalCaptionLayout } from './vertical-director.js';
import { createCaptionSystem } from './caption-system.js?v=issReelBeat1';

function clippedCard(ctx, x, y, width, height, radius) {
    ctx.save();
    roundRect(ctx, x, y, width, height, radius);
    ctx.clip();
}

function ellipsizeText(ctx, text, maxWidth) {
    const value = String(text || '');
    if (ctx.measureText(value).width <= maxWidth) return value;
    const suffix = '...';
    let low = 0;
    let high = value.length;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (ctx.measureText(value.slice(0, mid) + suffix).width <= maxWidth) low = mid;
        else high = mid - 1;
    }
    return value.slice(0, Math.max(0, low)).trimEnd() + suffix;
}

function drawFittedText(ctx, text, x, y, maxWidth, options = {}) {
    const {
        weight = 800,
        maxSize = 48,
        minSize = 24,
        color = '#f8fbff',
        family = 'Trebuchet MS, Verdana, sans-serif'
    } = options;
    const value = String(text || '');
    const fittedSize = fitText(ctx, value, maxWidth, maxSize, minSize);
    ctx.font = `${weight} ${fittedSize}px ${family}`;
    ctx.fillStyle = color;
    ctx.fillText(ellipsizeText(ctx, value, maxWidth), x, y);
    return fittedSize;
}

function wrapText(ctx, text, maxWidth, maxLines) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';
    for (const word of words) {
        const next = current ? `${current} ${word}` : word;
        if (ctx.measureText(next).width <= maxWidth || !current) {
            current = next;
        } else {
            lines.push(current);
            current = word;
            if (lines.length >= maxLines) break;
        }
    }
    if (current && lines.length < maxLines) lines.push(current);
    if (lines.length === maxLines) {
        lines[lines.length - 1] = ellipsizeText(ctx, lines[lines.length - 1], maxWidth);
    }
    return lines;
}

function drawWrappedFittedText(ctx, text, x, y, maxWidth, options = {}) {
    const {
        weight = 800,
        maxSize = 48,
        minSize = 24,
        maxLines = 2,
        lineHeight = 1.08,
        color = '#f8fbff',
        family = 'Trebuchet MS, Verdana, sans-serif'
    } = options;
    const value = String(text || '');
    let fontSize = maxSize;
    let lines = [];
    do {
        ctx.font = `${weight} ${fontSize}px ${family}`;
        lines = wrapText(ctx, value, maxWidth, maxLines);
        const tooWide = lines.some(line => ctx.measureText(line).width > maxWidth);
        if (!tooWide && lines.length <= maxLines) break;
        fontSize -= 2;
    } while (fontSize >= minSize);
    ctx.font = `${weight} ${fontSize}px ${family}`;
    ctx.fillStyle = color;
    lines.slice(0, maxLines).forEach((line, index) => {
        ctx.fillText(ellipsizeText(ctx, line, maxWidth), x, y + index * fontSize * lineHeight);
    });
    return { fontSize, lines };
}

export function createReelOverlay({
    THREE,
    scene,
    getTime,
    currentReelMood,
    officialCategoryLabels,
    latestGeometry,
    eventCategory,
    eventColor,
    eventLonLat,
    lonLatToVec3,
    state
}) {
    const captionSystem = createCaptionSystem({
        state,
        latestGeometry,
        eventCategory,
        officialCategoryLabels,
        eventLonLat
    });
    const reelCaptionCanvas = document.createElement('canvas');
    reelCaptionCanvas.width = 1024;
    reelCaptionCanvas.height = 320;
    const reelCaptionCtx = reelCaptionCanvas.getContext('2d');
    const reelCaptionTexture = new THREE.CanvasTexture(reelCaptionCanvas);
    reelCaptionTexture.colorSpace = THREE.SRGBColorSpace;
    const reelCaption = new THREE.Sprite(
        new THREE.SpriteMaterial({
            map: reelCaptionTexture,
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false
        })
    );
    reelCaption.visible = false;
    reelCaption.renderOrder = 999;
    scene.add(reelCaption);

    // Fade in/out pentru caption: fara asta, schimbarea intre evenimente era o
    // taiere instanta (opacity 0->1 direct), ceea ce dadea senzatia de "flash"
    // intre evenimente si nu lasa privitorului timp sa perceapa tranzitia.
    const captionFade = { start: 0, duration: 0.4, hiding: false, hideStart: 0, hideDuration: 0.32 };

    function showReelCaption() {
        reelCaptionTexture.needsUpdate = true;
        captionFade.hiding = false;
        captionFade.start = getTime();
        reelCaption.visible = true;
    }

    const reelLocatorGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const reelLocatorLine = new THREE.Line(
        reelLocatorGeometry,
        new THREE.LineBasicMaterial({
            color: 0xffd2a0,
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false
        })
    );
    reelLocatorLine.visible = false;
    reelLocatorLine.renderOrder = 997;
    scene.add(reelLocatorLine);
    const reelLocatorState = {
        active: false,
        anchor: new THREE.Vector3(),
        color: new THREE.Color(0xffd2a0)
    };

    const signalPulseCanvas = document.createElement('canvas');
    signalPulseCanvas.width = 512;
    signalPulseCanvas.height = 512;
    const signalPulseCtx = signalPulseCanvas.getContext('2d');
    const signalPulseTexture = new THREE.CanvasTexture(signalPulseCanvas);
    signalPulseTexture.colorSpace = THREE.SRGBColorSpace;
    const signalPulse = new THREE.Sprite(
        new THREE.SpriteMaterial({
            map: signalPulseTexture,
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        })
    );
    signalPulse.visible = false;
    signalPulse.renderOrder = 998;
    scene.add(signalPulse);
    const signalPulseState = {
        active: false,
        start: 0,
        duration: 0.72,
        color: new THREE.Color(0xffb347),
        anchor: new THREE.Vector3()
    };

    const _captionDir = new THREE.Vector3();
    const _captionRight = new THREE.Vector3();
    const _captionUp = new THREE.Vector3();
    const _surfaceNormal = new THREE.Vector3();
    const _cameraNormal = new THREE.Vector3();
    const _captionStart = new THREE.Vector3();
    const _end = new THREE.Vector3();
    const _endOffset = new THREE.Vector3();

    function setReelLocator(event) {
        const ll = eventLonLat(event);
        if (!ll) return clearReelLocator();
        reelLocatorState.active = true;
        reelLocatorState.anchor.copy(lonLatToVec3(ll.lon, ll.lat, 2.16));
        reelLocatorState.color.set(eventColor(event));
        reelLocatorLine.material.color.copy(reelLocatorState.color);
        reelLocatorLine.visible = true;
    }

    function clearReelLocator() {
        reelLocatorState.active = false;
        reelLocatorLine.visible = false;
        reelLocatorLine.material.opacity = 0;
    }

    function updateReelCaption(event, snap = false, index = 1, total = 3) {
        const ll = eventLonLat(event);
        if (!event || !ll) return hideReelCaption();
        setReelLocator(event);
        const ctx = reelCaptionCtx;
        const w = reelCaptionCanvas.width;
        const h = reelCaptionCanvas.height;
        const category = eventCategory(event);
        const caption = captionSystem.buildEventCaption(event, { snap, index, total });
        const style = caption.style;
        const mood = currentReelMood();
        const eventColorValue = eventColor(event);
        const eventStroke = colorToRgba(THREE, eventColorValue, style.strokeAlpha, 0.12);
        const eventAccent = colorToRgba(THREE, eventColorValue, 1, 0.18);

        ctx.clearRect(0, 0, w, h);
        const gradient = ctx.createLinearGradient(0, 0, w, h);
        gradient.addColorStop(0, mood.captionWarmth);
        gradient.addColorStop(1, mood.captionFillEnd);
        ctx.globalAlpha = style.cardAlpha;
        ctx.fillStyle = gradient;
        roundRect(ctx, 34, 34, w - 68, h - 68, 34);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = eventStroke;
        ctx.lineWidth = style.lineWidth;
        ctx.stroke();

        clippedCard(ctx, 58, 52, w - 116, h - 86, 18);
        drawFittedText(ctx, caption.header, 78, 96, w - 156, {
            weight: style.headerWeight,
            maxSize: style.tone === 'minimal' ? 26 : 32,
            minSize: 22,
            color: snap ? eventAccent : colorToRgba(THREE, eventColorValue, 1, 0.28)
        });
        const titleLayout = drawWrappedFittedText(ctx, caption.title, 78, 158, w - 156, {
            weight: style.titleWeight,
            maxSize: style.titleMaxSize,
            minSize: 24,
            maxLines: 2,
            lineHeight: 1.05,
            color: '#f4f8ff'
        });
        const metaY = titleLayout.lines.length > 1 ? 242 : 220;
        drawFittedText(ctx, caption.poetic || caption.meta, 78, metaY, w - 156, {
            weight: 500,
            maxSize: caption.poetic ? Math.min(24, style.metaMaxSize) : style.metaMaxSize,
            minSize: caption.poetic ? 18 : 22,
            color: 'rgba(220, 232, 255, 0.82)'
        });
        drawFittedText(ctx, caption.footer, 78, 276, w - 156, {
            weight: 600,
            maxSize: style.footerMaxSize,
            minSize: 18,
            color: 'rgba(255, 255, 255, 0.5)'
        });
        ctx.restore();

        showReelCaption();
    }

    function updateReelTransitionCard(event, index = 1, total = 3) {
        setReelLocator(event);
        const ctx = reelCaptionCtx;
        const w = reelCaptionCanvas.width;
        const h = reelCaptionCanvas.height;
        const caption = captionSystem.buildTransitionCaption(event, { index, total });
        const style = caption.style;
        const mood = currentReelMood();
        const eventColorValue = eventColor(event);
        const eventStroke = colorToRgba(THREE, eventColorValue, style.strokeAlpha, 0.12);
        const eventAccent = colorToRgba(THREE, eventColorValue, 1, 0.18);
        ctx.clearRect(0, 0, w, h);
        const gradient = ctx.createLinearGradient(0, 0, w, h);
        gradient.addColorStop(0, 'rgba(9, 12, 24, 0.88)');
        gradient.addColorStop(1, mood.captionWarmth);
        ctx.globalAlpha = style.cardAlpha;
        ctx.fillStyle = gradient;
        roundRect(ctx, 34, 34, w - 68, h - 68, 34);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = eventStroke;
        ctx.lineWidth = style.lineWidth;
        ctx.stroke();

        clippedCard(ctx, 58, 52, w - 116, h - 86, 18);
        drawFittedText(ctx, caption.header, 78, 94, w - 156, {
            weight: style.headerWeight,
            maxSize: 30,
            minSize: 22,
            color: eventAccent
        });
        drawFittedText(ctx, caption.title, 78, 172, w - 156, {
            weight: style.titleWeight,
            maxSize: style.tone === 'impact' ? 58 : 52,
            minSize: 26,
            color: '#f8fbff'
        });
        drawFittedText(ctx, caption.meta, 78, 230, w - 156, {
            weight: 600,
            maxSize: 30,
            minSize: 20,
            color: 'rgba(220, 232, 255, 0.84)'
        });
        drawFittedText(ctx, `source: ${caption.footer}`, 78, 270, w - 156, {
            weight: 600,
            maxSize: style.footerMaxSize,
            minSize: 18,
            color: 'rgba(255, 255, 255, 0.5)'
        });
        ctx.restore();

        showReelCaption();
    }

    // Card de detalii "tip click" pentru reel-ul video: campuri simple
    // etichetate (Categorie, Data, Coordonate, Sursa), NU stilul cinematic
    // "SIGNAL 01/03" de mai sus - exact continutul pe care l-ai vedea daca
    // ai da click manual pe eveniment (#details), dar randat in scena 3D
    // (acelasi sprite/textura reelCaption), ca sa apara efectiv in videoul
    // exportat (captureStream() de pe canvas WebGL nu prinde niciodata
    // elemente HTML suprapuse ca #details).
    function updateReelDetailsCard(event) {
        const ll = eventLonLat(event);
        if (!event || !ll) return hideReelCaption();
        setReelLocator(event);
        const ctx = reelCaptionCtx;
        const w = reelCaptionCanvas.width;
        const h = reelCaptionCanvas.height;
        const category = eventCategory(event);
        const categoryLabel = officialCategoryLabels.get(category) || category;
        const eventColorValue = eventColor(event);
        const mood = currentReelMood();
        const eventStroke = colorToRgba(THREE, eventColorValue, 0.55, 0.12);

        ctx.clearRect(0, 0, w, h);
        const gradient = ctx.createLinearGradient(0, 0, w, h);
        gradient.addColorStop(0, mood.captionWarmth);
        gradient.addColorStop(1, mood.captionFillEnd);
        ctx.fillStyle = gradient;
        roundRect(ctx, 34, 34, w - 68, h - 68, 34);
        ctx.fill();
        ctx.strokeStyle = eventStroke;
        ctx.lineWidth = 3;
        ctx.stroke();

        clippedCard(ctx, 58, 52, w - 116, h - 86, 18);
        drawFittedText(ctx, event.title, 78, 96, w - 156, {
            weight: 820,
            maxSize: 38,
            minSize: 24,
            color: '#f8fbff'
        });

        const geom = latestGeometry(event);
        const date = (geom?.date || 'unknown').slice(0, 10);
        const source = event.sourceProvider || (event.sources || []).map(s => s.id).join(', ') || 'unknown source';
        const infoLines = [
            `Category: ${categoryLabel}`,
            `Date: ${date}`,
            `Coordinates: ${ll.lat.toFixed(2)} lat, ${ll.lon.toFixed(2)} lon`,
            `Source: ${source}`
        ];
        let y = 148;
        infoLines.forEach(line => {
            drawFittedText(ctx, line, 78, y, w - 156, {
                weight: 560,
                maxSize: 24,
                minSize: 18,
                color: 'rgba(220, 232, 255, 0.86)'
            });
            y += 34;
        });
        ctx.restore();

        showReelCaption();
    }

    function updateReelTitleCard(mode, count = 3) {
        clearReelLocator();
        const ctx = reelCaptionCtx;
        const w = reelCaptionCanvas.width;
        const h = reelCaptionCanvas.height;
        const caption = captionSystem.buildTitleCaption(mode, count);
        const style = caption.style;
        ctx.clearRect(0, 0, w, h);
        const gradient = ctx.createLinearGradient(0, 0, w, h);
        gradient.addColorStop(0, mode === 'intro' ? 'rgba(11, 16, 30, 0.9)' : 'rgba(6, 10, 20, 0.86)');
        gradient.addColorStop(1, mode === 'intro' ? 'rgba(32, 18, 8, 0.62)' : 'rgba(10, 20, 34, 0.62)');
        ctx.globalAlpha = style.cardAlpha;
        ctx.fillStyle = gradient;
        roundRect(ctx, 34, 34, w - 68, h - 68, 34);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = mode === 'intro' ? 'rgba(255, 190, 120, 0.62)' : 'rgba(130, 210, 255, 0.42)';
        ctx.lineWidth = style.lineWidth;
        ctx.stroke();

        clippedCard(ctx, 58, 52, w - 116, h - 58, 18);
        if (mode === 'intro') {
            drawFittedText(ctx, caption.header, 78, 94, w - 156, {
                weight: style.headerWeight,
                maxSize: 30,
                minSize: 20,
                color: '#ffd2a0'
            });
            drawFittedText(ctx, caption.title, 78, 168, w - 156, {
                weight: style.titleWeight,
                maxSize: 66,
                minSize: 34,
                color: '#f8fbff'
            });
            drawFittedText(ctx, caption.subtitle, 78, 234, w - 156, {
                weight: style.titleWeight,
                maxSize: 66,
                minSize: 34,
                color: '#f8fbff'
            });
        } else {
            drawFittedText(ctx, caption.header, 78, 94, w - 156, {
                weight: style.headerWeight,
                maxSize: 30,
                minSize: 20,
                color: '#ffd2a0'
            });
            drawFittedText(ctx, caption.title, 78, 154, w - 156, {
                weight: style.titleWeight,
                maxSize: 50,
                minSize: 28,
                color: '#f8fbff'
            });
            drawFittedText(ctx, caption.subtitle, 78, 206, w - 156, {
                weight: style.titleWeight,
                maxSize: 50,
                minSize: 28,
                color: '#f8fbff'
            });
            drawFittedText(ctx, caption.meta, 78, 252, w - 156, {
                weight: 600,
                maxSize: 24,
                minSize: 20,
                color: 'rgba(220, 232, 255, 0.84)'
            });
        }
        if (mode !== 'intro') {
            drawFittedText(ctx, caption.footer, 78, 282, w - 156, {
                weight: 600,
                maxSize: 16,
                minSize: 14,
                color: 'rgba(255, 255, 255, 0.5)'
            });
        } else if (caption.footer) {
            drawFittedText(ctx, caption.footer, 78, 282, w - 156, {
                weight: 600,
                maxSize: 16,
                minSize: 14,
                color: 'rgba(255, 255, 255, 0.5)'
            });
        }
        ctx.restore();

        showReelCaption();
    }

    function hideReelCaption() {
        // Nu ascundem instant - lasam positionReelCaptionForCamera sa ruleze
        // fade-out-ul pe cateva cadre, apoi ascunde efectiv sprite-ul.
        if (!reelCaption.visible) return;
        captionFade.hiding = true;
        captionFade.hideStart = getTime();
    }

    function positionReelCaptionForCamera(activeCamera, options = {}) {
        if (!reelCaption.visible) return;
        const t = getTime();
        let fadeOpacity = 1;
        if (captionFade.hiding) {
            const k = Math.min(1, Math.max(0, (t - captionFade.hideStart) / captionFade.hideDuration));
            fadeOpacity = 1 - k;
            if (k >= 1) {
                reelCaption.visible = false;
                reelCaption.material.opacity = 0;
                clearReelLocator();
                captionFade.hiding = false;
                return;
            }
        } else {
            const k = Math.min(1, Math.max(0, (t - captionFade.start) / captionFade.duration));
            fadeOpacity = k * k * (3 - 2 * k);
        }
        reelCaption.material.opacity = fadeOpacity;
        const distance = 3.1;
        activeCamera.getWorldDirection(_captionDir);
        _captionRight.setFromMatrixColumn(activeCamera.matrixWorld, 0);
        _captionUp.setFromMatrixColumn(activeCamera.matrixWorld, 1);
        const aspect = activeCamera.aspect || innerWidth / innerHeight;
        const verticalLayout = getVerticalCaptionLayout(state, aspect);
        const verticalOffset = verticalLayout?.verticalOffset ?? (aspect < 1 ? -0.66 : -0.88);
        reelCaption.position.copy(activeCamera.position)
            .add(_captionDir.clone().multiplyScalar(distance))
            .add(_captionUp.clone().multiplyScalar(verticalOffset));
        const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(activeCamera.fov) / 2) * distance;
        const captionHeight = visibleHeight * (verticalLayout?.heightRatio ?? (aspect < 1 ? 0.145 : 0.18));
        reelCaption.scale.set(captionHeight * (reelCaptionCanvas.width / reelCaptionCanvas.height), captionHeight, 1);
        updateReelLocatorForCamera(activeCamera, _captionUp, _captionRight, captionHeight, verticalLayout, options, fadeOpacity);
    }

    function updateReelLocatorForCamera(activeCamera, up, right, captionHeight, verticalLayout = null, options = {}, fadeOpacity = 1) {
        if (!reelLocatorState.active || !reelCaption.visible) return;
        _surfaceNormal.copy(reelLocatorState.anchor).normalize();
        _cameraNormal.copy(activeCamera.position).normalize();
        const facing = _surfaceNormal.dot(_cameraNormal);
        const facingFade = options.exportMode
            ? THREE.MathUtils.smoothstep(facing, -0.08, 0.24)
            : THREE.MathUtils.smoothstep(facing, 0.04, 0.34);
        _captionStart.copy(reelCaption.position)
            .add(_endOffset.copy(up).multiplyScalar(captionHeight * (verticalLayout?.locatorStartY ?? 0.3)))
            .add(_end.copy(right).multiplyScalar(captionHeight * (verticalLayout?.locatorStartX ?? -1.15)));
        _endOffset.copy(_captionStart).sub(reelLocatorState.anchor).normalize().multiplyScalar(0.08);
        _end.copy(reelLocatorState.anchor).add(_endOffset);
        reelLocatorGeometry.setFromPoints([_captionStart, _end]);
        reelLocatorGeometry.attributes.position.needsUpdate = true;
        const opacityBoost = options.exportMode ? 1.45 : 1;
        reelLocatorLine.material.opacity = Math.min(0.62, facingFade * currentReelMood().locatorOpacity * opacityBoost) * fadeOpacity;
        reelLocatorLine.visible = facingFade > (options.exportMode ? 0.006 : 0.02);
    }

    function drawSignalPulseTexture(color) {
        const ctx = signalPulseCtx;
        const size = signalPulseCanvas.width;
        const rgb = `${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}`;
        ctx.clearRect(0, 0, size, size);
        const center = size / 2;
        const glow = ctx.createRadialGradient(center, center, 0, center, center, center);
        glow.addColorStop(0, `rgba(${rgb}, 0.34)`);
        glow.addColorStop(0.28, `rgba(${rgb}, 0.16)`);
        glow.addColorStop(0.58, `rgba(${rgb}, 0.05)`);
        glow.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = `rgba(${rgb}, 0.72)`;
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.arc(center, center, 154, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(center, center, 92, 0, Math.PI * 2);
        ctx.stroke();
        signalPulseTexture.needsUpdate = true;
    }

    function triggerSignalPulse(event) {
        const ll = eventLonLat(event);
        if (!ll) return;
        signalPulseState.active = true;
        signalPulseState.start = getTime();
        signalPulseState.color.set(eventColor(event));
        signalPulseState.anchor.copy(lonLatToVec3(ll.lon, ll.lat, 2.14));
        drawSignalPulseTexture(signalPulseState.color);
        signalPulse.visible = true;
    }

    function updateSignalPulseForCamera(activeCamera, t) {
        if (!signalPulseState.active) return;
        const progress = THREE.MathUtils.clamp((t - signalPulseState.start) / signalPulseState.duration, 0, 1);
        const fade = Math.pow(1 - progress, 1.75);
        const facing = signalPulseState.anchor.clone().normalize().dot(activeCamera.position.clone().normalize());
        const facingFade = THREE.MathUtils.smoothstep(facing, -0.08, 0.22);
        const scale = 0.2 + progress * 0.34;
        signalPulse.position.copy(signalPulseState.anchor);
        signalPulse.scale.set(scale, scale, 1);
        signalPulse.material.opacity = fade * facingFade * 0.74;
        if (progress >= 1) {
            signalPulseState.active = false;
            signalPulse.visible = false;
            signalPulse.material.opacity = 0;
        }
    }

    return {
        updateReelCaption,
        updateReelDetailsCard,
        updateReelTransitionCard,
        updateReelTitleCard,
        hideReelCaption,
        positionReelCaptionForCamera,
        triggerSignalPulse,
        updateSignalPulseForCamera,
        clearReelLocator
    };
}
