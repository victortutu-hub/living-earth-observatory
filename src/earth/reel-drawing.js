export function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

export function fitText(ctx, text, maxWidth, size, minSize = 32) {
    let fontSize = size;
    do {
        ctx.font = `800 ${fontSize}px Trebuchet MS, Verdana, sans-serif`;
        if (ctx.measureText(text).width <= maxWidth) return fontSize;
        fontSize -= 3;
    } while (fontSize >= minSize);
    return minSize;
}

export function colorToRgba(THREE, colorValue, alpha = 1, mixWhite = 0) {
    const color = new THREE.Color(colorValue).lerp(new THREE.Color(0xffffff), mixWhite);
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
