// @ts-check
// 전용 UI clone 없이 현재 실제 client 상태만 보여 준다.
export function scenes() {
 return [
  { id: 'status', chapter: 1, title: '가짜 코어 연결', selector: '#mode-label', seconds: 3,
   meaning: '실제 제품 client와 REST 서버 계약을 사용하되, 외부 모델 대신 연출용 FakeCore가 고정 응답을 만듭니다.' },
  { id: 'intake', chapter: 1, title: '작업과 원자료 입력', selector: '#task-form', seconds: 4,
   meaning: '가상 업무 메모를 올리고 목적·수신처·공개 범위를 정합니다.' },
  { id: 'analysis', chapter: 2, title: '원자료 분석', selector: '#task-analysis', seconds: 4,
   meaning: 'FakeCore가 같은 Engine 계약으로 근거와 공개 후보를 반환합니다.' },
  { id: 'decision', chapter: 3, title: '공개 범위 결정', selector: '.candidate', seconds: 5,
   meaning: '사용자가 후보를 허용하고 서버가 계산한 공개 미리보기를 확인한 뒤 결정을 저장합니다.' },
  { id: 'draft', chapter: 4, title: '공유 초안 작성', selector: '#draft-workspace', seconds: 4,
   meaning: '승인된 fact pack만 FakeCore에 전달해 초안과 자동 검토 결과를 만듭니다.' },
  { id: 'review', chapter: 5, title: '검토 결과 확인', selector: '#draft-review', seconds: 4,
   meaning: '검토 통과 상태와 승인 근거를 실제 제품 화면에서 확인합니다.' },
  { id: 'files', chapter: 6, title: '파일 확인과 확정', selector: '#draft-files', seconds: 4,
   meaning: '생성 파일을 확인하고 불변 내보내기로 확정합니다.' },
  { id: 'complete', chapter: 6, title: '사용자 흐름 완주', selector: '#flow-progress', seconds: 4,
   meaning: '작업 생성부터 최종 확정까지 여섯 단계가 모두 완료됐습니다.' },
 ];
}
