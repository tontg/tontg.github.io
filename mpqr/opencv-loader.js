// Copyright 2026 Gilles Reant. SPDX-License-Identifier: Apache-2.0
(function (global) {
  let pending;
  const integrity = 'sha256-8MN0SC5bm+i3eoCSvLsWHT5qP28/nBuXwidRknc3quk=';
  global.loadEmvOpenCv = function () {
    if (typeof importScripts !== 'function') return Promise.reject(new Error('OpenCV requires worker support; using JavaScript image preprocessing.'));
    if (pending) return pending;
    pending = new Promise((resolve, reject) => {
      let timer;
      const finish = () => { clearTimeout(timer); resolve(); };
      const fail = error => { clearTimeout(timer); reject(error); };
      timer = setTimeout(() => fail(new Error('OpenCV initialization timed out.')), 20000);
      global.Module = { onRuntimeInitialized: finish, onAbort: reason => fail(new Error(String(reason))) };
      if (typeof importScripts === 'function') {
        fetch('vendor/opencv.js', { integrity }).then(response => {
          if (!response.ok) throw new Error('OpenCV is unavailable.');
          return response.blob();
        }).then(blob => {
          const url = URL.createObjectURL(blob);
          try { importScripts(url); } finally { URL.revokeObjectURL(url); }
        }).catch(fail);
      } else {
        const script = document.createElement('script');
        script.src = 'vendor/opencv.js';
        script.integrity = integrity;
        script.onerror = () => { script.remove(); fail(new Error('OpenCV is unavailable.')); };
        document.head.appendChild(script);
      }
    });
    return pending;
  };
}(globalThis));
