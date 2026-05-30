(function () {
  function toHex(text) {
    return Array.from(new TextEncoder().encode(text))
      .map(byte => byte.toString(16).toUpperCase().padStart(2, '0'))
      .join(' ');
  }

  function renderSvg(container, svgText) {
    container.innerHTML = svgText;
    if (window.emvQrResizer) window.emvQrResizer.refresh(container);
  }

  function downloadSvg(svgText, filename) {
    if (!svgText) return;
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function downloadPngFromContainer(container, svgText, filename, onError) {
    if (!svgText) return;
    const svgElement = container.querySelector('svg');
    if (!svgElement) return;
    const viewBox = svgElement.getAttribute('viewBox').split(/\s+/).map(Number);
    const width = viewBox[2];
    const height = viewBox[3];
    const image = new Image();
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0);
      URL.revokeObjectURL(svgUrl);
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    };

    image.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      if (onError) onError();
    };

    image.src = svgUrl;
  }

  function initResizable(container) {
    if (window.emvQrResizer) window.emvQrResizer.initQrResizers();
    return container;
  }

  window.emvQrOutput = {
    downloadPngFromContainer,
    downloadSvg,
    initResizable,
    renderSvg,
    toHex,
  };
}());
