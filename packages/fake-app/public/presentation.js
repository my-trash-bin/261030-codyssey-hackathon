// @ts-check
// Only fake-app serves this page. These choices are presentation state, not grants.
const root = document.querySelector('#app');
const facts = [
 ['observation', '첫 요청에서 클라이언트 응답 대기 시간이 초과됐습니다.'],
 ['observation', '재시도에는 성공 응답을 받았습니다.'],
 ['unknown', '최초 요청의 서버 완료·중복 처리 여부와 요청량 변화의 인과관계는 확인하지 못했습니다.'],
 ['identifier', 'operation_id: op_demo_007'],
 ['identifier', 'attempt_id: try_demo_001, try_demo_002'],
 ['series', '요청량 추이: 첫 관찰 → 증가 → 증가. 실제 건수와 비율은 공개하지 않습니다.'],
 ['timeline', '사건 순서: 요청 전송 → 대기 시간 초과 → 재시도 → 응답 수신.'],
 ['config_example', '새 설정 예시를 첨부할 수 있습니다. 실제 접속 로그의 주소 공개를 허용하는 것은 아닙니다.'],
];
window.presentationKinds = facts.map(([kind]) => kind);
const kindNames = { observation:'관찰', unknown:'미확인', identifier:'추적 ID', series:'요청량', timeline:'사건 순서', config_example:'새 설정 예시' };
let choices = new Map(), previews = new Set(), output = '', hash = '', savedId = null;
function escape(value) { return String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function on(id, action) {
 document.getElementById(id).onclick = async () => {
  try { document.querySelector('#error').textContent = ''; await action(); }
  catch (error) { document.querySelector('#error').textContent = error.message; }
 };
}
async function request(path, body) {
 const response = await fetch(path, body ? { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) } : {});
 const value = await response.json();
 if (!response.ok) throw Error(value.error || '요청 실패');
 return value;
}
function intake() {
 root.innerHTML = `<div class="narrow"><span class="badge">01 · 목적과 자료</span><h1>무엇을 공유하시나요?</h1>
 <p>가상 자료로 준비 흐름을 설명합니다. 분석·선택·미리보기는 연출 전용입니다.</p><section class="panel">
 <label for="title">작업 이름</label><input id="title" value="공급사 문의 준비">
 <label for="purpose">공유 목적</label><input id="purpose" value="공급사 기술지원 문의">
 <label for="recipient">수신자</label><input id="recipient" value="지정 가상 공급사">
 <label for="files">가상 자료 파일</label><input id="files" type="file" multiple>
 <p>선택한 파일은 브라우저 안에서만 읽습니다. 서버의 원자료 분석 API는 아직 없습니다.</p>
 <button class="primary" id="create">가상 분석 장면으로</button></section></div>`;
 on('create', async () => {
  const files = [...document.querySelector('#files').files];
  if (files.length !== 3) throw Error('지정 가상 자료 3개를 선택하세요.');
  await Promise.all(files.map((file) => file.text()));
  choices = new Map(); previews = new Set(); output = ''; hash = ''; savedId = null;
  workspace();
 });
}
function workspace() {
 root.innerHTML = `<h1>공급사 문의 준비</h1><p class="status">${output ? '가짜 초안 작성 완료' : '연출용 공개 선택'} · 실제 서버 승인 아님</p>
 <div class="grid"><section class="panel"><h2>공개 선택 · 연출</h2><p>고정된 가상 후보입니다. 실제 분석 결과가 아닙니다.</p>
 ${facts.map(([kind,text],i)=>`<article class="card"><span class="badge">${escape(kindNames[kind])}</span><h3>${escape(text)}</h3>
 <label for="choice-${i}">공개 방법</label><select id="choice-${i}">
 ${kind==='series'?'<option value="direction">추이만 공개</option>':'<option value="summary">이 표현으로 시연</option>'}</select>
 <button id="preview-${i}">공개 미리보기</button><button id="apply-${i}" ${previews.has(i)?'':'disabled'}>이 선택 적용 · 연출</button>
 ${choices.has(i)?`<span id="revoke-${i}">시연 선택 적용됨</span>`:''}
 <pre id="projection-${i}" ${previews.has(i)?'':'hidden'}>${escape(text)}</pre></article>`).join('')}
 </section><section class="panel"><h2>현재 초안</h2><p>선택한 가상 표현으로 시연 문서를 작성합니다. 실제 모델은 호출하지 않습니다.</p>
 ${output?`<pre class="draft">${escape(output)}</pre><a class="button" id="demo-final-link" href="#__final">최종 파일 확인 →</a>`:'<p>모든 가상 후보의 미리보기를 확인하고 시연 선택을 적용하세요.</p>'}
 <button class="primary" id="compose">현재 선택으로 작성</button></section></div>`;
 facts.forEach(([,text],i)=>{
  on('preview-'+i, async ()=>{
   previews.add(i); document.querySelector('#projection-'+i).hidden=false;
   document.querySelector('#apply-'+i).disabled=false;
  });
  on('apply-'+i, async ()=>{
   if (!previews.has(i)) throw Error('미리보기를 먼저 확인하세요.');
   choices.set(i,text); output=''; workspace();
  });
 });
 on('compose',async()=>{
  if (choices.size!==facts.length) throw Error('모든 시연 선택을 적용하세요.');
  const result=await request('/api/sharing',{purpose:'공급사 기술지원 문의',recipient:'지정 가상 공급사',
   facts:[...choices].map(([i,text])=>({id:'demo-'+i,text}))});
  if (result.provenance.implementation!=='fake') throw Error('가짜 앱에서만 시연할 수 있습니다.');
  output=result.document.title+'\n\n'+result.document.body;
  const saved=await request('/api/documents',{text:output});
  savedId=saved.document.id;
  const records=await request('/api/documents');
  if (!records.documents.some((doc)=>doc.id===savedId && doc.text===output)) throw Error('저장 결과 확인 실패');
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(output));
  hash=[...new Uint8Array(bytes)].map((n)=>n.toString(16).padStart(2,'0')).join('');
  workspace();
 });
 if(output) on('demo-final-link',async()=>finalPage());
}
function finalPage() {
 root.innerHTML=`<div class="narrow"><h1>실제 생성·저장된 가짜 초안</h1><p>생성한 문서의 저장 결과입니다. 실제 공개 승인·확정·내보내기 구현을 뜻하지 않습니다.</p>
 <section class="panel"><article class="file"><strong>support-request.md</strong><details open><summary>생성 내용과 SHA-256</summary>
 <pre>${escape(hash)}\n\n${escape(output)}</pre></details></article><label><input type="checkbox" id="confirmed">내용 확인 · 연출 전용</label>
 <p>문서 ID: ${escape(savedId)}. 실제 공개·외부 제출은 수행하지 않습니다.</p></section></div>`;
}
intake();
