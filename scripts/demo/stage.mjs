// @ts-check
// Runs inside the dedicated fixture tab; production assets are unchanged.
export function installStage() {
 if (document.querySelector('#demo-stage')) return;
 const style = document.createElement('style');
 style.textContent = `
 body { padding-bottom:300px !important; }
 [data-demo-focus] { outline:4px solid #00bfa5 !important;
 outline-offset:7px; scroll-margin:60px 0 310px; }
 #demo-stage { position:fixed; bottom:14px; left:3%; width:94%; z-index:2147483646;
 box-sizing:border-box; padding:16px 24px; border:1px solid #428779;
 border-radius:20px; background:#102a2df5; color:white;
 box-shadow:0 12px 50px #0005; font:16px/1.5 sans-serif; max-height:46vh; overflow:auto; }
 #demo-stage small { color:#7ce7cd; font-size:12px; letter-spacing:1px; }
 #demo-stage h2 { margin:4px 0; color:white; font-size:clamp(19px,2vw,28px); }
 #demo-stage p { margin:0 0 10px; color:#d2e6e3; max-width:1000px; }
 #demo-stage .controls { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
 #demo-stage button, #demo-stage select { background:#e3fff5; color:#102a2d;
 border:0; border-radius:8px; padding:7px 12px; cursor:pointer; font:inherit; }
 #demo-stage button:disabled { opacity:.4; cursor:default; }
 #demo-stage :focus-visible { outline:3px solid #ffd77d; outline-offset:2px; }
 #demo-stage nav { display:flex; gap:6px; margin:10px 0 6px; }
 #demo-stage nav button { flex:1; padding:5px; font-size:13px; background:#244447; color:#d2e6e3; }
 #demo-stage nav button[aria-current="step"] { background:#7ce7cd; color:#102a2d; font-weight:bold; }
 #demo-stage nav button.done { box-shadow:inset 0 -3px #7ce7cd; }
 #demo-stage input[type=range] { width:100%; accent-color:#7ce7cd; margin:3px 0; }
 #demo-stage select { max-width:280px; }
 #demo-position { color:#7ce7cd; margin-left:auto; font-size:14px; }
 #demo-cursor { position:fixed; left:0; top:0; width:22px; height:22px;
 border:3px solid #fff; border-radius:50%; background:#00bfa5;
 box-shadow:0 0 0 7px #00bfa544; pointer-events:none; z-index:2147483647;
 transition:transform .5s cubic-bezier(.4,0,.2,1); }
 `;
 document.head.append(style);
 const panel = document.createElement('aside');
 panel.id = 'demo-stage';
 panel.setAttribute('aria-label', '시연 해설과 재생 제어');
 panel.innerHTML = '<small>SAFEHANDOFF / 실제 CLIENT · FAKE BACKEND · WORKFLOW 미구현</small>'
  + '<h2></h2><p id="demo-meaning"></p><nav aria-label="전체 시연 단계"></nav>'
  + '<input id="demo-timeline" type="range" min="0" max="0" value="0" aria-label="이동할 장면">'
  + '<div class="controls"><button id="demo-prev">이전</button>'
  + '<button id="demo-pause">일시정지</button><button id="demo-next">다음</button>'
  + '<select id="demo-scenes" aria-label="장면 선택"></select>'
  + '<button id="demo-stop">종료</button><span id="demo-position" role="status"></span></div>';
 document.body.append(panel);
 const cursor = document.createElement('div');
 cursor.id = 'demo-cursor';
 document.body.append(cursor);
 // Fade only newly rendered workspace content; retain the subtitle controls.
 const app = document.querySelector('#app');
 const panelOffsets = new Map();
 document.addEventListener('scroll', (event) => {
  const panels = [...document.querySelectorAll('.grid > .panel')];
  const index = panels.indexOf(event.target);
  if (index >= 0) panelOffsets.set(index, event.target.scrollTop);
 }, true);
 if (app) new MutationObserver(() => {
  document.querySelectorAll('.grid > .panel').forEach((panel, index) => {
   panel.scrollTop = panelOffsets.get(index) || 0;
  });
  app.animate([{ opacity: .65 }, { opacity: 1 }], { duration: 450, easing: 'ease-out' });
 }).observe(app, { childList: true });
 window.demoFocus = async (selector, duration, settlePaused = false) => {
  window.demoMotionCancelled = false;
  document.querySelectorAll('[data-demo-focus]').forEach((el) => el.removeAttribute('data-demo-focus'));
  const el = document.querySelector(selector);
  if (!el) throw Error('연출 대상 없음: ' + selector);
  // Native layout computes all nested scroll destinations before the next paint.
  const tracks = [];
  for (let node = el.parentElement; node; node = node.parentElement) {
   if (node.scrollHeight > node.clientHeight) tracks.push({ node, start: node.scrollTop });
  }
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  for (const track of tracks) track.end = track.node.scrollTop;
  for (const track of tracks) track.node.scrollTop = track.start;
  let elapsed = 0, previous;
  const samples = [];
  await new Promise((resolve) => {
   function frame(now) {
    if (window.demoMotionCancelled) { resolve(); return; }
    if (previous !== undefined && (settlePaused || !window.demoMotionPaused)) elapsed += Math.min(now - previous, 50);
    previous = now;
    const t = Math.min(1, elapsed / Math.max(1, duration));
    const eased = t * t * (3 - 2 * t);
    for (const track of tracks) track.node.scrollTop = track.start + (track.end - track.start) * eased;
    samples.push({ t: Math.round(now), y: Math.round(tracks.reduce((sum, track) => sum + track.node.scrollTop, 0)) });
    if (t < 1) requestAnimationFrame(frame); else resolve();
   }
   requestAnimationFrame(frame);
  });
  el.setAttribute('data-demo-focus', '');
  return { selector, distance: Math.round(tracks.reduce((sum, track) => sum + Math.abs(track.end - track.start), 0)), samples };
 };
 let state = { plan: [], current: null, paused: false };
 let planKey = '';
 const send = (command) => {
  if (command.type === 'pause') window.demoMotionPaused = true;
  if (command.type === 'play') window.demoMotionPaused = false;
  if (['seek', 'stop'].includes(command.type)) window.demoMotionCancelled = true;
  window.demoCommand(JSON.stringify(command));
 };
 const seek = (index) => {
  const scene = state.plan[index];
  if (scene) send({ type: 'seek', id: scene.id });
 };
 const chapters = ['목적', '분석', '공개 선택', '작성', '검토', '파일 확인'];
 const nav = panel.querySelector('nav');
 chapters.forEach((label, i) => {
  const button = document.createElement('button');
  button.textContent = `${i + 1} ${label}`;
  button.onclick = () => seek(state.plan.findIndex((s) => s.chapter === i + 1));
  nav.append(button);
 });
 panel.querySelector('#demo-pause').onclick = () => {
  if (state.completed) seek(0);
  else send({ type: state.paused ? 'play' : 'pause' });
 };
 panel.querySelector('#demo-stop').onclick = () => send({ type: 'stop' });
 panel.querySelector('#demo-prev').onclick = () => seek(state.plan.findIndex((s) => s.id === state.current) - 1);
 panel.querySelector('#demo-next').onclick = () => seek(state.plan.findIndex((s) => s.id === state.current) + 1);
 panel.querySelector('#demo-scenes').onchange = (e) => send({ type: 'seek', id: e.target.value });
 const range = panel.querySelector('#demo-timeline');
 let dragging = false;
 range.oninput = () => {
  dragging = true;
  const scene = state.plan[Number(range.value)];
  range.setAttribute('aria-valuetext', scene?.title || '');
  panel.querySelector('#demo-position').textContent = `이동할 장면: ${scene?.title}`;
 };
 range.onchange = () => { dragging = false; seek(Number(range.value)); };
 window.renderDemo = (next) => {
  state = next;
  window.demoMotionPaused = next.paused && !next.seeking;
  const { plan, current, paused, seeking, stopped, completed } = state;
  const index = plan.findIndex((s) => s.id === current);
  const scene = plan[index];
  const key = plan.map((s) => s.id).join(',');
  const select = panel.querySelector('#demo-scenes');
  if (key !== planKey) {
   select.replaceChildren(...plan.map((s, i) => new Option(`${i + 1}. ${s.title}`, s.id)));
   range.max = String(plan.length - 1);
   planKey = key;
  }
  if (!dragging) { range.value = String(Math.max(0, index)); select.value = current || plan[0]?.id; }
  range.setAttribute('aria-valuetext', scene?.title || '준비 중');
  panel.querySelector('h2').textContent = stopped ? '시연을 종료했습니다'
   : seeking ? '선택한 장면으로 이동 중…' : scene ? `${String(scene.chapter).padStart(2, '0')} / ${scene.title}` : '시연 준비 중';
  panel.querySelector('#demo-meaning').textContent = stopped ? '창을 닫으면 전용 서버도 종료됩니다.'
   : seeking ? '실제 client의 현재 연결 상태를 다시 확인합니다.' : scene?.meaning || '';
  panel.querySelector('#demo-pause').textContent = completed ? '처음으로' : paused ? '재생' : '일시정지';
  panel.querySelector('#demo-prev').disabled = index <= 0 || seeking || stopped;
  panel.querySelector('#demo-next').disabled = index >= plan.length - 1 || seeking || stopped;
  panel.querySelector('#demo-pause').disabled = seeking || stopped;
  for (const [i, button] of [...nav.children].entries()) {
   button.setAttribute('aria-current', scene?.chapter === i + 1 ? 'step' : 'false');
   button.classList.toggle('done', scene?.chapter > i + 1);
  }
  if (!dragging) panel.querySelector('#demo-position').textContent = seeking ? '이동 준비 중'
   : `${Math.max(0, index + 1)} / ${plan.length} 장면 · ${Math.round(Math.max(0, index + 1) / plan.length * 100)}% · ${completed ? '시연 완료' : paused ? '일시정지' : '재생 중'}`;
 };
}
