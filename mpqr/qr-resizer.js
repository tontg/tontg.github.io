(function () {
  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function parentWidth(element) {
    const parent = element.parentElement;
    return parent ? parent.clientWidth : window.innerWidth;
  }

  function applySize(element, size) {
    const minSize = Number(element.dataset.resizeMin || 180);
    const maxSize = Math.max(minSize, parentWidth(element));
    const nextSize = clamp(Math.round(size), minSize, maxSize);
    element.style.width = `${nextSize}px`;
    element.style.height = `${nextSize}px`;
    element.dataset.currentSize = String(nextSize);
  }

  function currentSize(element) {
    return Number(element.dataset.currentSize || element.getBoundingClientRect().width || 320);
  }

  function install(element) {
    if (!element || element.dataset.qrResizableReady === 'true') return;
    element.dataset.qrResizableReady = 'true';
    element.classList.add('qr-resizable');

    const handle = document.createElement('div');
    handle.className = 'qr-resize-handle';
    handle.setAttribute('aria-hidden', 'true');
    element.appendChild(handle);

    const defaultSize = Number(element.dataset.resizeDefault || 320);
    applySize(element, defaultSize);

    let dragState = null;

    handle.addEventListener('pointerdown', event => {
      const rect = element.getBoundingClientRect();
      dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startSize: rect.width,
      };
      handle.setPointerCapture(event.pointerId);
      element.classList.add('is-resizing');
      event.preventDefault();
    });

    handle.addEventListener('pointermove', event => {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      const delta = Math.max(event.clientX - dragState.startX, event.clientY - dragState.startY);
      applySize(element, dragState.startSize + delta);
    });

    function stopDrag(event) {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      dragState = null;
      element.classList.remove('is-resizing');
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    }

    handle.addEventListener('pointerup', stopDrag);
    handle.addEventListener('pointercancel', stopDrag);

    window.addEventListener('resize', () => {
      applySize(element, currentSize(element));
    });
  }

  function refresh(element) {
    if (!element) return;
    element.dataset.qrResizableReady = 'false';
    const handle = element.querySelector('.qr-resize-handle');
    if (handle) handle.remove();
    install(element);
  }

  function initQrResizers() {
    document.querySelectorAll('.qr-output[data-resizable="true"]').forEach(install);
  }

  window.emvQrResizer = { initQrResizers, install, refresh };
}());
