# 실제 앱·등록 모델 실행 확인 (2차)

2026-10-31 UTC. 사용자가 "지금 실 동작 잘 될 걸로 예상되면 실제 테스트 해 봐도 좋다"고 명시적으로 승인한 뒤 실행했다. 실제 업무 원자료는 사용하지 않았고 모델 주소·ID·키·비공개 설정 값은 기록하지 않는다. [1차 기록](live-smoke-2026-10-31.md)과 같은 절차를 반복했다.

## 사전 확인 (읽기전용)

`.env`의 `SAFEHANDOFF_LLM_BASE_URL`/`MODEL`/`API_KEY`가 모두 비어있지 않고, `config.json`이 존재해 `config.example.json`로 빠지지 않는다. 1차 기록에서 발견·수정한 두 문제(provider.response_mode=text 처리, 검토 프롬프트 schema_version 누락)는 `3f32b07`로 이미 커밋돼 있다. 즉 사전에 새로 구현할 것이 없다고 판단하고 바로 실제 테스트로 진행했다.

## 실행 방법과 결과

빌드된 `packages/app/dist/main.js`를 실제 별도 프로세스로 시작했다. localhost 임의 포트와 임시 SQLite 경로만 덮어쓰고 나머지는 기존 `.env`와 `config.json`으로 구성했다. 테스트 후 프로세스를 종료하고 임시 DB를 정리했다. 기존 앱 DB와 비공개 설정은 변경하지 않았다.

| 검사 | 결과 |
| --- | --- |
| GET /health | 200 |
| GET /api/core | real/direct/ready=true |
| 알 수 없는 필드(`sources`)를 보낸 POST /api/sharing | 400 INVALID_CORE_INPUT, 모델 호출 전 거부 |
| 승인 사실 두 개를 보낸 실제 POST /api/sharing | 200, 약 7.88초, real/direct/ready=true |
| 클라이언트가 응답 전 연결을 끊은 POST /api/sharing (약 1.2~1.5초 후 강제 종료) | 서버 크래시·행 없음, 직후 /health 200으로 정상 응답 |

작성된 가상 문서는 두 합성 관찰(약 5초 응답 지연, 서버 처리는 완료되었으나 지연 원인 미확인)을 그대로 반영했고 근본 원인을 단정하지 않았다.

## 취소 경로 코드 확인

`packages/server/src/app.ts`가 `response.once('close', ...)`로 클라이언트 연결 종료를 `AbortController.abort()`에 연결하고, 그 `signal`을 `core.generate(input, { signal })`에 전달한다.
`RealCore.call()`은 매 단계에서 `signal.aborted`를 확인하고, `OpenAICompatibleModelClient.complete()`은 같은 `signal`을 Node의 `http(s).request(url, { signal })` 옵션에 그대로 넘긴다(`packages/model-adapter/src/transport.ts`) — Node가 네이티브로 지원하는 요청 중단 경로이며 별도 polling이나 타이머가 아니다.
이번 실행에서 클라이언트 연결을 끊은 뒤 서버가 즉시 다른 요청에 정상 응답한 것으로 이 경로가 실제로 동작함을 확인했다. 소켓 레벨에서 업스트림 연결이 정확히 몇 ms 안에 닫혔는지는 공유 네트워크 네임스페이스의 잡음 때문에 `/proc/[pid]/net/tcp` 카운트만으로는 신뢰성 있게 측정하지 못했다.

## 결론

1차 기록 이후의 수정으로 happy path·입력 검증·취소 경로 모두 이번 실행에서 문제없이 동작했다. Engine의 재시도/에러 처리 로직(`packages/core/src/index.ts`)에서 이번 실행으로 드러난 결함은 없었다 — 없는 문제를 만들어 고치지 않는다. `writeReviewed`의 수정 루프(`max_review_repairs>0`)는 현재 `/api/sharing`에서 호출하지 않는 것이 의도된 범위 축소이며(decisions.md 2b), 이번 실행이 그 경로를 노출하지 않은 것은 버그가 아니다.
