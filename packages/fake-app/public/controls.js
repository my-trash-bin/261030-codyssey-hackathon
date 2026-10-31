// @ts-check
/** @param {string} id */
function field(id) { return /** @type {HTMLInputElement | HTMLTextAreaElement} */ (document.getElementById(id)); }
/** @param {string} path @param {unknown} [body] @param {string} [method] */
async function api(path, body, method = 'POST') {
  const response = await fetch(path, body === undefined ? {} : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'REQUEST_FAILED');
  return value;
}
/** @param {string} message */
function status(message) { document.getElementById('status').textContent = message; }
async function load() {
  const value = await api('/api/demo/settings');
  field('title').value = value.script.title; field('opening').value = value.script.opening; field('closing').value = value.script.closing;
  field('delay').value = value.connection.delayMs; field('failures').value = value.connection.failuresRemaining;
}
document.getElementById('settings').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await api('/api/demo/settings', {
      script: { title: field('title').value, opening: field('opening').value, closing: field('closing').value },
      connection: { delayMs: Number(field('delay').value), failuresRemaining: Number(field('failures').value) },
    }, 'PUT');
    status('다음 시연 요청에 적용했습니다.');
  } catch (error) { status(String(error)); }
});
document.getElementById('generate').addEventListener('submit', async event => {
  event.preventDefault(); status('가짜 연결부를 통해 생성 중입니다…'); document.getElementById('output').textContent = '';
  try {
    const result = await api('/api/sharing', {
      purpose: field('purpose').value, recipient: field('recipient').value,
      facts: field('facts').value.split('\n').filter(line => line.trim()).map((text, i) => ({ id: `fact-${i}`, text })),
    });
    document.getElementById('output').textContent = `${result.document.title}\n\n${result.document.body}`;
    status(`${result.provenance.implementation} 코어 · ${result.provenance.connection} 연결 · 완료`);
  } catch (error) { status(String(error)); }
  finally { await load(); }
});
load().catch(error => status(String(error)));
