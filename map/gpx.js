import { parseRoute } from './navigation.js';
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_ROUTE_POINTS = 500;
// Return separate routes/track segments instead of silently joining disjoint journeys.
export function parseGpx(text, Parser = globalThis.DOMParser) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_IMPORT_BYTES)
        throw new Error('gpx.tooLarge');
    if (/<!DOCTYPE|<!ENTITY/i.test(text))
        throw new Error('gpx.unsafeXml');
    const doc = new Parser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagNameNS('*', 'parsererror').length || doc.documentElement?.localName !== 'gpx')
        throw new Error('gpx.invalid');
    const root = doc.documentElement;
    const ns = root.namespaceURI;
    if (ns && !['http://www.topografix.com/GPX/1/1', 'http://www.topografix.com/GPX/1/0'].includes(ns))
        throw new Error('gpx.invalid');
    const children = (parent, name) => [...parent.children].filter((node) => node.localName === name && node.namespaceURI === ns);
    const nameOf = (node) => children(node, 'name')[0]?.textContent?.trim().slice(0, 120);
    const candidates = [];
    function add(nodes, name) {
        if (!nodes.length)
            return;
        if (nodes.length > MAX_ROUTE_POINTS)
            throw new Error('gpx.tooManyPoints');
        const ids = new Set();
        const points = nodes.map((node, index) => {
            if (!node.getAttribute('lat')?.trim() || !node.getAttribute('lon')?.trim())
                throw new Error('gpx.invalid');
            const base = nameOf(node) || `P${index + 1}`;
            let id = base, suffix = 2;
            while (ids.has(id))
                id = `${base}-${suffix++}`;
            ids.add(id);
            return { id, latitude: Number(node.getAttribute('lat')), longitude: Number(node.getAttribute('lon')), radiusMeters: 5 };
        });
        const data = { points, journey: { name, sequence: points.map((point) => point.id) } };
        try {
            parseRoute(data);
        }
        catch {
            throw new Error('gpx.invalid');
        }
        candidates.push(data);
    }
    children(root, 'rte').forEach((route, index) => add(children(route, 'rtept'), nameOf(route) || `Route ${index + 1}`));
    children(root, 'trk').forEach((track, index) => {
        const segments = children(track, 'trkseg');
        segments.forEach((segment, segmentIndex) => add(children(segment, 'trkpt'), `${nameOf(track) || `Track ${index + 1}`}${segments.length > 1 ? ` / ${segmentIndex + 1}` : ''}`));
    });
    add(children(root, 'wpt'), 'Waypoints');
    if (!candidates.length)
        throw new Error('gpx.empty');
    return candidates;
}
//# sourceMappingURL=gpx.js.map