interface DocumentRecord { id: string; text: string; createdAt: string }
const form = document.querySelector<HTMLFormElement>('#save-form')!;
const text = document.querySelector<HTMLTextAreaElement>('#text')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const documents = document.querySelector<HTMLDivElement>('#documents')!;
const save = document.querySelector<HTMLButtonElement>('#save')!;

async function load(): Promise<void> {
  const response = await fetch('/api/documents');
  if (!response.ok) throw new Error('문서 목록을 읽지 못했습니다.');
  const result = await response.json() as { documents: DocumentRecord[] };
  documents.replaceChildren();
  for (const record of result.documents) {
    const article = document.createElement('article');
    const time = document.createElement('time');
    time.dateTime = record.createdAt;
    time.textContent = new Date(record.createdAt).toLocaleString('ko-KR');
    const content = document.createElement('pre');
    content.textContent = record.text;
    article.append(time, content);
    documents.append(article);
  }
  if (!result.documents.length) documents.textContent = '아직 저장된 문서가 없습니다.';
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (save.disabled) return;
  save.disabled = true;
  try {
    const response = await fetch('/api/documents', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.value }),
    });
    if (!response.ok) throw new Error('저장하지 못했습니다. 입력과 서버 상태를 확인하세요.');
    text.value = '';
    status.textContent = '저장했습니다.';
    await load();
  } catch (error) { status.textContent = error instanceof Error ? error.message : '요청에 실패했습니다.'; }
  finally { save.disabled = false; }
});
document.querySelector('#refresh')!.addEventListener('click', () => {
  void load().catch(() => { status.textContent = '문서 목록을 읽지 못했습니다.'; });
});
void load().catch(() => { status.textContent = '서버에 연결하지 못했습니다.'; });
