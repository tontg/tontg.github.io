export function byId(id) {
    const element = document.getElementById(id);
    if (!element)
        throw new Error(`Missing required element: ${id}`);
    return element;
}
export function setText(element, text) {
    if (element.textContent !== text)
        element.textContent = text;
}
//# sourceMappingURL=dom.js.map