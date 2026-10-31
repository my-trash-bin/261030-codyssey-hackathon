// @ts-check
export function scenes(count = null, kinds = []) {
 const plan = [
  { id: 'purpose', chapter: 1, title: '공유 목적', selector: '#title',
   meaning: '누구에게 무엇을 물을지 정해야 필요한 정보의 범위도 정할 수 있습니다. 자료를 올리는 것만으로 공개가 허용되지는 않습니다.' },
  { id: 'upload', chapter: 2, title: '자료 분석', selector: '#files',
   meaning: '로그·요청량 표·지원 메모에서 관찰 사실과 미확인 사항을 찾습니다. 현재 앱의 분석 기능은 미구현이며 이 장면은 고정 가상 후보를 보여줍니다.' },
 ];
 const meanings = {
  observation: '관찰 사실과 원인 추정을 구분합니다. 상대가 조사할 수 있는 단서를 남깁니다.',
  unknown: '확인하지 못한 부분을 명시합니다. 요청의 완료 여부와 오류 원인을 단정하지 않습니다.',
  identifier: '조사에 필요한 추적 ID를 공개합니다. 허용은 현재 자료와 수신자 범위에만 적용됩니다.',
  series: '실제 요청량 대신 증가·감소 추이만 공개합니다. 규모는 숨기고 변화 방향은 남깁니다.',
  timeline: '사건이 발생한 순서와 실제 시간 간격을 구분해 공개 범위를 정합니다. 필요한 조사 단서를 유지할 표현을 선택합니다.',
  config_example: '원래 접속 로그 대신 새 설정 예시를 공개 후보로 확인합니다. 예시의 맥락에서 허용한 값이 원자료 전체의 공개 허용을 뜻하지는 않습니다.',
 };
 for (let i = 0; i < (count ?? 1); i++) {
  plan.push(
   { id: `choice-${i}`, chapter: 3, title: `공개 방법 선택 ${i + 1}${count ? ' / ' + count : ''}`,
    selector: `#choice-${i}`,
    meaning: meanings[kinds[i]] || '각 후보를 어느 수준으로 공개할지 정합니다. 사람의 공개 판단과 모델의 제안은 별도이며, 이 실행은 가상 시연용 선택을 적용합니다.' },
   { id: `projection-${i}`, chapter: 3, title: `공개 미리보기 ${i + 1}${count ? ' / ' + count : ''}`,
    selector: `#projection-${i}`,
    meaning: '공개될 문장·값·표를 먼저 확인합니다. 시연에서 선택한 가상 facts만 fake core에 전달합니다. 실제 승인 상태는 만들지 않습니다.' },
  );
 }
 plan.push(
  { id: 'compose', chapter: 4, title: '새 문서 작성', selector: '#compose',
   meaning: '최신 공통 API로 가짜 코어의 문서를 생성·저장합니다. 실제 모델 검토나 첨부·승인 API를 실행한 것은 아닙니다.' },
  { id: 'draft', chapter: 5, title: '결과 검토', selector: '.draft',
   meaning: '문의문에 필요한 관찰과 미확인 사항이 남아 있는지 확인합니다. 검사 완료는 실제 모델의 품질이나 정보유출 방지를 보장한다는 뜻이 아닙니다.' },
  { id: 'final', chapter: 6, title: '실제 파일 확인', selector: '.file',
   meaning: '생성·저장한 문서와 해시를 확인합니다. 현재 앱의 확정·내보내기는 미구현이며 외부 제출을 수행하지 않습니다.' },
 );
 for (const scene of plan) {
  scene.seconds = scene.id.startsWith('choice-') ? 2.7
   : scene.id.startsWith('projection-') ? 2.3
   : { purpose: 5, upload: 5, compose: 4, draft: 6, final: 6 }[scene.id];
 }
 return plan;
}
