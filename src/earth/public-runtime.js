export function isLocalRuntime() {
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '';
}

export function hasExplicitProxyBase() {
    const params = new URLSearchParams(window.location.search);
    return Boolean(params.get('proxyBase') || window.NASA_PROXY_BASE);
}

export function isStaticPublicRuntime() {
    return !isLocalRuntime() && !hasExplicitProxyBase();
}

export function isPublicProxyDisabledRuntime() {
    const params = new URLSearchParams(window.location.search);
    return isStaticPublicRuntime() || params.has('publicFallbackTest');
}

export function proxyRequiredMessage(sourceName) {
    return `${sourceName}: public demo proxy-disabled; live supplemental data needs local proxy`;
}

export function createProxyRequiredError(sourceName) {
    return new Error(proxyRequiredMessage(sourceName));
}
