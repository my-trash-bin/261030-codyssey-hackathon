export function scenes(count = null, kinds = []) {
 const plan = [
  { id: 'purpose', chapter: 1, title: '공유 목적', selector: '#title',
   meaning: '누구에게 무엇을 물을지 정해야 필요한 정보의 범위도 정할 수 있습니다. 자료를 올리는 것만으로 공개가 허용되지는 않습니다.' },
  { id: 'upload', chapter: 2, title: '자료 분석', selector: '#files',
   meaning: '로그·요청량 표·지원 메모에서 관찰 사실과 미확인 사항을 찾습니다. 원자료는 내부 분석에 사용하며 그대로 외부에 보내지 않습니다.' },
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
    meaning: '공개될 문장·값·표를 먼저 확인합니다. 적용한 미리보기만 작성기에 전달합니다. (가상 시연)' },
  );
 }
 plan.push(
  { id: 'compose', chapter: 4, title: '새 문서 작성', selector: '#compose',
   meaning: '선택한 정보로 문의문과 첨부를 새로 작성하고 검토합니다. 공개 선택이 바뀌면 이전 결과를 재사용하지 않고 다시 작성해야 합니다.' },
  { id: 'draft', chapter: 5, title: '결과 검토', selector: '.draft',
   meaning: '문의문에 필요한 관찰과 미확인 사항이 남아 있는지 확인합니다. 검사 완료는 실제 모델의 품질이나 정보유출 방지를 보장한다는 뜻이 아닙니다.' },
  { id: 'final', chapter: 6, title: '실제 파일 확인', selector: '.file',
   meaning: '최종 파일의 내용과 해시를 직접 확인하는 단계입니다. 화면에서 확인한 파일을 확정하도록 연결하며, 이 연출은 확정·다운로드 전에 멈춥니다.' },
 );
 for (const scene of plan) {
  scene.seconds = scene.id.startsWith('choice-') ? 2.7
   : scene.id.startsWith('projection-') ? 2.3
   : { purpose: 5, upload: 5, compose: 4, draft: 6, final: 6 }[scene.id];
 }
 return plan;
}
