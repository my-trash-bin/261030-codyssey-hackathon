# CDP 시연 통합 검증 · 2026-10-31

## 통합 범위

`feat/cdp-demo-presentation`의 진행 중이던 `3aaf0a4` 병합을 `fbcfe02`로 완료하고,
원격을 다시 조회해 확인한 최신 main `1aed9c8`까지 `4312e2b`로 병합했다.
6개 unmerged 파일을 검토해 해결하고 fake-app 전용 presentation 파일 3개를 추가했다.
후속 main의 클라이언트 UI·팩 등록·문서 변경을 함께 반영했다.

과거 evaluation 기록은 사용자 지시에 따라 main의 삭제 변경에서 제외해 보존했다.
기존 영상·미리보기·cdp-submission-run.json의 작업 트리 변경은 보존하고 커밋하지 않았다.
`intent.md`·비공개 설정·기존 로컬 DB는 변경하지 않았다.

## 현재 검증

- 공식 `mise exec -- just check`: 통과. 타입·빌드·Node 테스트와 QG 정책을 실행했다.
- main에서 추가한 `packages/client/public/style.css` 파일 길이 경고 1개가 남는다.
- macOS에서 Linux 전용 파일시스템 시험 10개와 팩 등록 시험 3개는 skip이다.
  대신 지원하지 않는 플랫폼의 로딩·등록 거부 계약을 확인했다. Linux 검증 완료를 뜻하지 않는다.
- `mise exec -- pnpm demo:cdp --headless --fast --verify-playback`: 통과.
  21개 장면·8개 가상 후보·이전/다음·타임라인·이동 후 정지·재생을 확인했다.
  실행 기록은 `var/cdp-demo-s5jbub/run.json`이며 가속 실행이므로 제출 시간 근거가 아니다.

정상 속도 `--headless --record`도 통과했다. 실행 기록은
`var/cdp-demo-SqJBJv/run.json`, 새 영상은 같은 폴더의 `submission.mp4`다.
재생 시간은 99973ms, 인코딩 영상은 99975ms로 110초 이내다.
6구간 영상 프레임 추출 검사를 통과했다. 기존 제출 영상은 덮어쓰지 않았다.

## 구현 경계

분석·공개 선택·미리보기·최종 확인은 fake-app 브라우저 연출이다.
문서 생성·저장·조회만 `/api/sharing`·`/api/documents`로 수행하고 fake provenance와 저장 바이트를 확인한다.
실제 분석·승인·확정·내보내기나 외부 제출을 구현·검증한 것으로 해석하지 않는다.
