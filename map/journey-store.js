import { parseRoute } from './navigation.js';
export function routeDocument(targets, journey) {
    return {
        points: targets.map(({ id, latitude, longitude, radiusMeters }) => ({ id, latitude, longitude, radiusMeters })),
        journey: { name: journey.name, sequence: [...journey.sequence] }
    };
}
export function routeSignature(targets, journey) {
    return JSON.stringify(routeDocument(targets, journey));
}
// Storage is optional. A blocked/quota-limited store must not stop navigation.
export function createJourneyStore(storage, scope) {
    const prefix = `geo-map:${scope}:`;
    const failures = new Set();
    function read(key) {
        try {
            return JSON.parse(storage.getItem(prefix + key) || 'null');
        }
        catch {
            failures.add(key);
            return null;
        }
    }
    function write(key, value) {
        try {
            storage.setItem(prefix + key, JSON.stringify(value));
            failures.delete(key);
            return true;
        }
        catch {
            failures.add(key);
            return false;
        }
    }
    return {
        get available() { return failures.size === 0; },
        saveProgress(targets, journey) {
            return write('progress', { version: 1, signature: routeSignature(targets, journey),
                activeStepIndex: journey.activeStepIndex, awaitingExit: journey.awaitingExit });
        },
        restoreProgress(targets, journey) {
            const saved = read('progress');
            if (saved?.version !== 1 || saved.signature !== routeSignature(targets, journey) ||
                saved.activeStepIndex == null || !Number.isInteger(saved.activeStepIndex) || saved.activeStepIndex < 0 || saved.activeStepIndex > journey.sequence.length ||
                typeof saved.awaitingExit !== 'boolean')
                return false;
            journey.activeStepIndex = saved.activeStepIndex;
            journey.awaitingExit = saved.awaitingExit;
            journey.paused = true;
            return true;
        },
        loadRoute() {
            const data = read('route');
            if (!data)
                return null;
            try {
                const route = parseRoute(data);
                return routeDocument(route.targets, route.journey);
            }
            catch {
                return null;
            }
        },
        saveRoute(data) { parseRoute(data); return write('route', data); },
        clearRoute() {
            try {
                storage.removeItem(prefix + 'route');
                failures.delete('route');
                return true;
            }
            catch {
                failures.add('route');
                return false;
            }
        },
        loadPreferences() {
            const data = read('preferences');
            return { sound: data?.sound === true, haptics: data?.haptics === true };
        },
        savePreferences(preferences) { return write('preferences', preferences); }
    };
}
//# sourceMappingURL=journey-store.js.map