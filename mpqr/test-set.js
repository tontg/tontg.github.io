// Copyright 2026 Gilles Reant. SPDX-License-Identifier: Apache-2.0
(function () {
  const element = id => document.getElementById(id);
  const select = element('testCodeSelect');
  const previous = element('previousTestCode');
  const next = element('nextTestCode');
  const checked = element('testCodeTested');
  const qr = element('testQr');
  const status = element('testSetStatus');
  const tested = new Set();
  let codes = [], index = 0, loading = false;

  function updateProgress() {
    element('testProgress').max = codes.length;
    element('testProgress').value = tested.size;
    element('testProgressLabel').textContent = `${tested.size} of ${codes.length} tested${tested.size === codes.length ? ' - complete' : ''}`;
    element('resetTestProgress').disabled = tested.size === 0;
    Array.from(select.options).forEach((option, position) => {
      const code = codes[position];
      option.textContent = `${position + 1}. ${code.title}${tested.has(code.id) ? ' [tested]' : ''}`;
    });
  }

  function showCode(position) {
    if (loading || !Number.isInteger(position) || position < 0 || position >= codes.length) return;
    index = position;
    const code = codes[index];
    select.value = String(index);
    previous.disabled = index === 0;
    next.disabled = index === codes.length - 1;
    checked.checked = tested.has(code.id);
    checked.disabled = true;
    element('testCodeTitle').textContent = code.title;
    element('testCodeDescription').textContent = code.description;
    element('testCodePosition').textContent = `${index + 1} / ${codes.length}`;
    qr.replaceChildren();
    qr.hidden = false;
    for (const id of ['testPayload', 'testYaml', 'testHex', 'testQrMetadata']) element(id).textContent = '';
    element('testPayloadTitle').textContent = 'Expected text';
    element('testHexTitle').textContent = 'Hexadecimal data';
    const validation = element('testValidation');
    try {
      const result = window.MerchantPresentedQrCode.render(qr, code.fields, {
        errorCorrection: code.errorCorrection,
        altText: code.title,
      });
      const analysis = window.emvAnalyzer.analyzePayload(result.payload);
      element('testPayload').textContent = result.payload;
      element('testPayloadTitle').textContent = `Expected text (${result.characters} characters)`;
      element('testHex').textContent = result.hex;
      element('testHexTitle').textContent = `Hexadecimal data (${result.bytes} bytes)`;
      element('testYaml').textContent = 'fields:\n' + window.emvFormat.nodesYaml(analysis.tree).join('\n');
      element('testQrMetadata').textContent = `Version ${result.version}/${code.errorCorrection} | ${result.bytes} bytes | CRC ${result.crc}`;
      validation.classList.toggle('error', !analysis.validation.valid);
      validation.textContent = [analysis.validation.valid ? 'EMV checks passed.' : 'EMV checks failed.', ...analysis.validation.errors, ...analysis.validation.warnings].join('\n');
      checked.disabled = false;
    } catch (error) {
      qr.replaceChildren();
      qr.hidden = true;
      validation.classList.add('error');
      validation.textContent = `Cannot generate this code: ${error.message || error}`;
    }
  }

  async function loadTestSet() {
    if (loading) return;
    loading = true;
    element('reloadTestSet').disabled = true;
    element('testSetDeck').hidden = true;
    status.hidden = false;
    status.classList.remove('error');
    status.textContent = 'Loading test set...';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('samples/qr-test-set.yaml', { cache: 'no-cache', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status} while loading samples/qr-test-set.yaml.`);
      const set = window.emvYaml.parseTestSet(await response.text());
      codes = set.codes;
      tested.clear();
      index = 0;
      element('testSetTitle').textContent = set.title;
      element('testSetDescription').textContent = set.description;
      select.replaceChildren(...codes.map((code, position) => new Option(code.title, String(position))));
      updateProgress();
      status.hidden = true;
      element('testSetDeck').hidden = false;
      loading = false;
      showCode(0);
    } catch (error) {
      status.classList.add('error');
      status.textContent = `Cannot load the test set. ${error.name === 'AbortError' ? 'The request timed out.' : error.message} Check samples/qr-test-set.yaml, then reload the test set.`;
    } finally {
      clearTimeout(timeout);
      loading = false;
      element('reloadTestSet').disabled = false;
    }
  }

  previous.addEventListener('click', () => showCode(index - 1));
  next.addEventListener('click', () => showCode(index + 1));
  select.addEventListener('change', () => showCode(Number(select.value)));
  checked.addEventListener('change', () => {
    if (checked.checked) tested.add(codes[index].id);
    else tested.delete(codes[index].id);
    updateProgress();
  });
  element('resetTestProgress').addEventListener('click', () => {
    tested.clear();
    checked.checked = false;
    updateProgress();
  });
  element('reloadTestSet').addEventListener('click', loadTestSet);
  loadTestSet();
}());
