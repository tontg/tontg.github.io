import { byId, setText } from './dom.js';
import { errorMessage } from './errors.js';
import { parseRoute } from './navigation.js';
import { routeDocument } from './journey-store.js';
import { parseGpx, MAX_IMPORT_BYTES, MAX_ROUTE_POINTS } from './gpx.js';
export class RouteEditor {
    constructor({ t, getRoute, onApply }) {
        this.t = t;
        this.getRoute = getRoute;
        this.onApply = onApply;
        this.dialog = byId('editorDialog');
        this.draft = null;
        this.map = null;
        this.selected = null;
        this.imports = [];
        this.importToken = Symbol();
        this.currentMessage = null;
        this.dialog.addEventListener('close', () => this.resetImports());
        byId('editorClose').onclick = () => this.dialog.close();
        byId('editorPointSelect').onchange = () => this.select(byId('editorPointSelect').value);
        byId('editorPointForm').onsubmit = (event) => { event.preventDefault(); this.savePoint(); };
        byId('editorDeletePoint').onclick = () => this.deletePoint();
        byId('editorAddStep').onclick = () => {
            if (!this.selected || this.draft.journey.sequence.length >= 1000)
                return;
            this.draft.journey.sequence.push(this.selected);
            this.render();
        };
        byId('editorApply').onclick = () => this.apply();
        byId('editorExport').onclick = () => this.export();
        byId('editorFile').onchange = () => void this.importFile(byId('editorFile').files?.[0]);
        byId('editorLoadImport').onclick = () => {
            const data = this.imports[Number(byId('editorImportChoice').value)];
            if (data)
                this.setDraft(data);
        };
        byId('editorName').oninput = () => { this.draft.journey.name = byId('editorName').value; };
    }
    open() {
        this.resetImports();
        this.setDraft(this.getRoute());
        this.dialog.showModal();
        if (!this.map) {
            this.map = L.map('editorMap').setView([33.56, -7.65], 15);
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 20, maxNativeZoom: 19,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
            }).addTo(this.map);
            this.markers = L.layerGroup().addTo(this.map);
            this.line = L.polyline([], { color: '#ffbd59', weight: 3 }).addTo(this.map);
            this.map.on('click', ({ latlng }) => this.addPoint(latlng.lat, latlng.lng));
        }
        requestAnimationFrame(() => { this.map?.invalidateSize(); this.render(true); });
    }
    setDraft(data) {
        const parsed = parseRoute(data);
        this.draft = routeDocument(parsed.targets, parsed.journey);
        this.selected = this.draft.points[0]?.id || null;
        byId('editorName').value = this.draft.journey.name;
        this.currentMessage = null;
        byId('editorMessage').textContent = '';
        this.render(true);
    }
    addPoint(latitude, longitude) {
        if (this.draft.points.length >= MAX_ROUTE_POINTS || this.draft.journey.sequence.length >= 1000) {
            this.message('gpx.tooManyPoints');
            return;
        }
        let index = this.draft.points.length + 1;
        while (this.draft.points.some((point) => point.id === `P${index}`))
            index++;
        const point = { id: `P${index}`, latitude: Math.max(-90, Math.min(90, latitude)),
            longitude: ((longitude + 180) % 360 + 360) % 360 - 180, radiusMeters: 5 };
        this.draft.points.push(point);
        this.draft.journey.sequence.push(point.id);
        this.selected = point.id;
        this.render();
    }
    select(id) {
        this.selected = id || null;
        const point = this.draft.points.find((value) => value.id === id);
        const form = byId('editorPointForm');
        form.querySelector('fieldset').disabled = !point;
        if (!point) {
            form.reset();
            return;
        }
        for (const [key, element] of [['id', 'editorPointId'], ['latitude', 'editorLatitude'], ['longitude', 'editorLongitude'], ['radiusMeters', 'editorRadius']]) {
            byId(element).value = String(point[key]);
        }
    }
    savePoint() {
        const oldId = this.selected;
        const index = this.draft.points.findIndex((point) => point.id === oldId);
        if (index < 0)
            return;
        const point = { id: byId('editorPointId').value.trim(), latitude: Number(byId('editorLatitude').value),
            longitude: Number(byId('editorLongitude').value), radiusMeters: Number(byId('editorRadius').value) };
        const candidate = structuredClone(this.draft);
        candidate.points[index] = point;
        candidate.journey.sequence = candidate.journey.sequence.map((id) => id === oldId ? point.id : id);
        try {
            parseRoute(candidate);
            this.draft = candidate;
            this.selected = point.id;
            this.render();
            this.message('editor.pointSaved');
        }
        catch (error) {
            this.message('editor.error', { error: errorMessage(error) });
        }
    }
    deletePoint() {
        if (!this.selected || !confirm(this.t('editor.confirmDelete', { id: this.selected })))
            return;
        this.draft.points = this.draft.points.filter((point) => point.id !== this.selected);
        this.draft.journey.sequence = this.draft.journey.sequence.filter((id) => id !== this.selected);
        this.selected = this.draft.points[0]?.id || null;
        this.render();
    }
    render(fit = false) {
        if (!this.draft)
            return;
        const select = byId('editorPointSelect');
        select.replaceChildren(...this.draft.points.map((point) => new Option(point.id, point.id)));
        select.value = this.selected || '';
        this.select(this.selected);
        const list = byId('editorSteps');
        list.replaceChildren(...this.draft.journey.sequence.map((id, index) => {
            const item = document.createElement('li');
            const label = document.createElement('span');
            label.textContent = `${index + 1}. ${id}`;
            item.append(label);
            for (const [action, offset] of [['editor.up', -1], ['editor.down', 1], ['editor.remove', 0]]) {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = this.t(action);
                button.setAttribute('aria-label', `${this.t(action)} ${index + 1}: ${id}`);
                button.disabled = !!offset && (index + offset < 0 || index + offset >= this.draft.journey.sequence.length);
                button.onclick = () => {
                    const sequence = this.draft.journey.sequence;
                    if (!offset)
                        sequence.splice(index, 1);
                    else
                        [sequence[index], sequence[index + offset]] = [sequence[index + offset], sequence[index]];
                    this.render();
                    byId('editorSteps').children[Math.min(index, sequence.length - 1)]?.querySelector('button:not(:disabled)')?.focus();
                };
                item.append(button);
            }
            return item;
        }));
        byId('editorAddStep').disabled = !this.selected;
        const parsed = parseRoute(this.draft);
        byId('editorLength').textContent = this.t('editor.length', { count: parsed.journey.sequence.length,
            distance: Math.round(parsed.journey.totalPlannedDistanceMeters) });
        if (!this.map)
            return;
        this.markers.clearLayers();
        this.draft.points.forEach((point) => {
            const label = document.createElement('span');
            label.textContent = point.id;
            const marker = L.marker([point.latitude, point.longitude], {
                draggable: true, icon: L.divIcon({ className: 'editor-marker', html: '', iconSize: [20, 20] })
            }).bindTooltip(label).addTo(this.markers);
            marker.on('click', () => { this.selected = point.id; select.value = point.id; this.select(point.id); });
            marker.on('dragend', () => {
                const position = marker.getLatLng();
                point.latitude = Math.max(-90, Math.min(90, position.lat));
                point.longitude = ((position.lng + 180) % 360 + 360) % 360 - 180;
                this.selected = point.id;
                this.render();
            });
            L.circle([point.latitude, point.longitude], { radius: point.radiusMeters, color: '#4fd5ff', weight: 1 }).addTo(this.markers);
        });
        this.line.setLatLngs(this.draft.journey.sequence.map((id) => {
            const point = parsed.byId.get(id);
            return [point.latitude, point.longitude];
        }));
        if (fit && this.draft.points.length)
            this.map.fitBounds(this.draft.points.map((point) => [point.latitude, point.longitude]), { maxZoom: 18, padding: [24, 24] });
    }
    async importFile(file) {
        if (!file)
            return;
        const token = this.importToken = Symbol();
        this.imports = [];
        byId('editorImportOptions').hidden = true;
        try {
            if (file.size > MAX_IMPORT_BYTES)
                throw new Error('gpx.tooLarge');
            const text = await file.text();
            if (token !== this.importToken || !this.dialog.open)
                return;
            const imported = file.name.toLowerCase().endsWith('.json') ? [JSON.parse(text)] : parseGpx(text);
            const candidates = imported.map((data) => { const route = parseRoute(data); return routeDocument(route.targets, route.journey); });
            for (const data of candidates) {
                const parsed = parseRoute(data);
                if (parsed.targets.length > MAX_ROUTE_POINTS || parsed.journey.sequence.length > 1000)
                    throw new Error('gpx.tooManyPoints');
            }
            this.imports = candidates;
            byId('editorImportChoice').replaceChildren(...candidates.map((data, i) => new Option(`${data.journey.name || this.t('journey.defaultName')} (${data.points.length})`, String(i))));
            byId('editorImportOptions').hidden = false;
            this.message('editor.importReady');
        }
        catch (error) {
            if (token === this.importToken && this.dialog.open)
                this.message('editor.error', { error: errorMessage(error) });
        }
        finally {
            if (token === this.importToken)
                byId('editorFile').value = '';
        }
    }
    resetImports() {
        this.importToken = Symbol();
        this.imports = [];
        byId('editorImportOptions').hidden = true;
        byId('editorImportChoice').replaceChildren();
        byId('editorFile').value = '';
    }
    refreshLanguage() {
        if (!this.draft)
            return;
        // Do not rerender the draft: a language change must preserve unsaved fields and focus.
        [...byId('editorSteps').children].forEach((item, index) => {
            [...item.querySelectorAll('button')].forEach((button, action) => {
                const label = this.t(['editor.up', 'editor.down', 'editor.remove'][action]);
                setText(button, label);
                button.setAttribute('aria-label', `${label} ${index + 1}: ${this.draft.journey.sequence[index]}`);
            });
        });
        [...byId('editorImportChoice').options].forEach((option, index) => {
            const data = this.imports[index];
            if (data)
                option.textContent = `${data.journey.name || this.t('journey.defaultName')} (${data.points.length})`;
        });
        const route = parseRoute(this.draft);
        setText(byId('editorLength'), this.t('editor.length', { count: route.journey.sequence.length,
            distance: Math.round(route.journey.totalPlannedDistanceMeters) }));
        if (this.currentMessage)
            this.message(this.currentMessage.key, this.currentMessage.values);
    }
    apply() {
        if (!confirm(this.t('editor.confirmApply')))
            return;
        try {
            parseRoute(this.draft);
            this.onApply(structuredClone(this.draft));
            this.dialog.close();
        }
        catch (error) {
            this.message('editor.error', { error: errorMessage(error) });
        }
    }
    export() {
        const url = URL.createObjectURL(new Blob([JSON.stringify(this.draft, null, 2) + '\n'], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'targets.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    message(key, values) {
        this.currentMessage = { key, values };
        const translated = { ...values };
        if (typeof translated.error === 'string' && translated.error.startsWith('gpx.'))
            translated.error = this.t(translated.error);
        setText(byId('editorMessage'), this.t(key, translated));
    }
}
//# sourceMappingURL=route-editor.js.map