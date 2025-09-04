// Popup script: global Scale and Spacing controls

function debounce(fn, wait = 150) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

async function init() {
  const SCALE_MIN = 1.0;
  const SCALE_MAX = 1.6;
  const toSlider = (scale) => Math.round(((scale - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100);
  const fromSlider = (v) => SCALE_MIN + (parseFloat(v) / 100) * (SCALE_MAX - SCALE_MIN);

  const scaleInput = document.getElementById('scaleGlobal');
  const spacingInput = document.getElementById('spacingGlobal');
  const scaleValue = document.getElementById('scaleValue');
  const spacingValue = document.getElementById('spacingValue');
  const resetBtn = document.getElementById('resetAllBtn');

  // Load current values (defaults scale=1, spacing=0)
  const { globalOptions = { scale: 1, spacing: 0, opacity: 1 } } = await chrome.storage.sync.get(['globalOptions']);
  const currentScale = (typeof globalOptions.scale === 'number') ? globalOptions.scale : 1;
  const currentSpacing = (typeof globalOptions.spacing === 'number') ? globalOptions.spacing : 0;
  let currentOpacity = (typeof globalOptions.opacity === 'number') ? globalOptions.opacity : 1; // preserved

  scaleInput.value = String(toSlider(currentScale));
  spacingInput.value = String(currentSpacing);
  scaleValue.textContent = `${currentScale.toFixed(2)}×`;
  spacingValue.textContent = `${Number(currentSpacing).toFixed(1)}px`;

  const commit = debounce(async (nextScale, nextSpacing) => {
    await chrome.storage.sync.set({ globalOptions: { scale: nextScale, spacing: nextSpacing, opacity: currentOpacity } });
  }, 120);

  scaleInput.addEventListener('input', () => {
    const s = fromSlider(scaleInput.value);
    scaleValue.textContent = `${s.toFixed(2)}×`;
    commit(s, parseFloat(spacingInput.value));
  });

  spacingInput.addEventListener('input', () => {
    const sp = parseFloat(spacingInput.value);
    spacingValue.textContent = `${sp.toFixed(1)}px`;
    commit(parseFloat((fromSlider(scaleInput.value)).toFixed(4)), sp);
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      scaleInput.value = '0'; // far left
      spacingInput.value = '0';
      scaleValue.textContent = '1.00×';
      spacingValue.textContent = '0.0px';
      await chrome.storage.sync.set({ globalOptions: { scale: 1, spacing: 0, opacity: currentOpacity } });
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
