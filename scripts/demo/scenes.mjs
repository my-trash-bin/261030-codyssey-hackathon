// @ts-check
// 전용 UI clone 없이 현재 실제 client 상태만 보여 준다.
export function scenes() {
 return [{
  id: 'status', chapter: 1, title: '현재 실제 UI', selector: '#session-status', seconds: 6,
  meaning: '실제 client를 fake-app에 연결했습니다. fake-app에는 아직 workflow API가 없어 연결 실패 상태를 그대로 표시하며, 미구현 흐름을 성공처럼 연출하지 않습니다.',
 }];
}
