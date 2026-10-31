# 웹과 공유본 재생성 엔진의 독립 실행

사용자 요청에 따라 기존 SQLite·workflow 일체형 시제품과 별도로 웹 게이트웨이와 stateless 엔진을 구성했다. 기존 내부 로직·작업 DB·API를 새 경로의 선행 조건으로 삼지 않는다. 제품 의도는 그대로이며 이 경로는 분석·공개 표현 선택·재작성·검토·사람 확인이라는 기본 흐름부터 시험한다.

## 실행

```bash
mise exec -- just demo-start
mise exec -- just live-start
```

| 구분 | 웹 화면 | 엔진 HTTP | 실제 모델 |
| --- | --- | --- | --- |
| 임시 시연 | http://127.0.0.1:8081 | http://127.0.0.1:8091 | 호출하지 않음 |
| 실제 엔진 | http://127.0.0.1:8082 | http://127.0.0.1:8092 | 기존 config.json의 provider 사용 |

웹은 0.0.0.0에 바인딩하므로 해당 머신의 사내 IP·Tailscale IP에서도 같은 포트로 접속한다. 엔진은 loopback에만 바인딩하며 웹은 시작 시 지정한 엔진으로만 프록시한다. 엔진 URL을 요청이나 업로드로 바꿀 수 없다. 웹은 모델 키나 원자료 DB를 읽지 않는다. 실제 엔진만 .env를 자동으로 읽는다. 같은 명령을 반복해도 서버를 중복 시작하지 않는다.

```bash
just demo-status
just demo-restart
just demo-stop
just demo-logs engine
just live-status
just live-restart
just live-stop
just live-logs engine
```

PID·프로세스 시작 식별자·로그는 `.local/run/{demo,live}/{engine,web}/`에 각각 `server_pid`, `server.json`, `server.log`로 보관한다. 모드별로 시작·중지·재시작을 직렬화하고 다른 모드·기존 8080 서버·관리 밖 프로세스는 종료하지 않는다. 웹 시작 실패 시 이번에 시작한 엔진을 정리한다.

각 프로세스를 따로 실행할 수도 있다. 아래 예시는 두 터미널에서 실행한다.

```bash
just build-lab
./bin/safehandoff-engine --mode demo --listen 127.0.0.1:8091
./bin/safehandoff-web --listen 0.0.0.0:8081 --engine http://127.0.0.1:8091
```

## 시연 화면

1. 가상 사례를 불러온 뒤 원자료를 펼쳐 보고 분석한다. 운영 자문·기존 공급사 timeout·스트리밍 CSV·배송 웹훅 사례를 제공한다.
2. 후보마다 근거와 표현을 확인한다. 처음에는 모두 미승인이다. 표현을 수정하면 해당 후보의 승인이 해제된다. 직접 후보를 추가할 수도 있다.
3. 공개할 후보를 승인하고 새 문서 작성을 실행한다. 선택하지 않은 내용과 원자료는 작성 요청에 포함하지 않는다.
4. 공개 선택을 바꾸면 기존 결과와 다운로드가 무효화된다. 다시 작성하면 새 승인 정보로 전체 문서를 생성한다. 늦게 도착한 과거 응답은 적용하지 않는다.
5. 결과를 편집하면 재검토가 필요하다. 현재 판본의 검토 통과 후 사람이 내용을 확인해야 다운로드할 수 있다. 다운로드는 확인한 제목·본문의 Markdown 바이트다.

시연 분석은 준비된 자료에 대응하는 사전 작성 후보이며 작성 결과는 승인 문장을 조립하는 템플릿이다. 시연 검토는 승인 문장의 포함 여부만 검사한다. 새로운 정보 유출·의미 정확성을 검증한 것처럼 표시하지 않는다. 원자료를 변경하거나 새로 업로드한 자료의 자동 분석은 실제 엔진에서 시험한다. 시연 화면에서도 직접 만든 후보를 승인해 작성 흐름은 시험할 수 있다.

## 실제 엔진의 처리 경계

분석기는 선택된 원자료를 읽고 근거 source ID가 붙은 공개 후보를 제안한다. 사용자는 후보를 고치거나 새 표현을 추가하고 명시적으로 승인한다. 실제 작성기는 원자료 대신 승인된 표현·목적·수신자만 읽어 공유본 전체를 새로 작성한다. 검토기는 같은 승인 정보와 문서를 비교한다. 미승인 사실·근거 없는 원인 단정·누락된 제약·불확실성 왜곡 등을 지적하면 화면에서 수정하거나 공개 선택으로 돌아간다.

모델의 분석·작성·검토 실패는 그대로 오류로 표시한다. demo로 자동 전환하지 않는다. 모델 검토는 보안 보장이 아니며 승인 범위의 의미와 실제 내용은 사람이 확인한다. 직접 API·CLI를 쓰는 시험자는 facts를 명시적으로 승인한 입력으로 구성해야 한다. 엔진 API가 원자료의 공개를 자동 승인하는 구조는 아니다.

## HTTP·CLI 계약: regeneration.v1

엔진에는 GET /health, GET /v1/scenarios, POST /v1/analyze, POST /v1/generate, POST /v1/review가 있다. 웹은 /api 접두어로 같은 경계를 중계한다. 기존 /api/v1/tasks 계약과 독립적이다. 성공은 결과 JSON, 실패는 상태 코드와 `{"error":"CODE"}`다. HTTP와 CLI 모두 알 수 없는 필드·중복 키·후행 JSON을 거부하고 입력은 최대 2 MiB다. 모델 어댑터의 별도 입력 상한은 그대로 적용한다.

| 작업 | 입력 | 출력 |
| --- | --- | --- |
| analyze | purpose, recipient, sources: id/name/text, 선택적 scenario | mode, input_hash, candidates: id/text/reason/source_ids |
| generate | purpose, recipient, facts: id/text | mode, input_hash, document: title/body, review: pass/issues |
| review | generate 입력 + document: title/body | pass, issues |

웹 없이 실제 엔진만 실행하는 예시다. 결과 JSON은 stdout, 오류는 stderr와 실패 exit code로 반환한다. 모든 파일은 가상 자료다. 분석 결과를 읽고 승인할 표현을 정하는 단계와 생성 입력을 분리한다.

```bash
just engine analyze fixtures/engine/analyze.json live
just engine generate fixtures/engine/approved.json live
just engine generate fixtures/engine/approved.json demo
```

## 검증 진입점

전체 검사는 `just check`가 QG를 직접 실행한다. QG는 recommended 규칙과 함께 `npm test`의 Node 시험, Go 단위·HTTP 통합시험, 문서 검사, 프로세스 관리 시험을 호출한다. npm test가 QG를 다시 호출하지 않는다.

```bash
just check
npm test
just test-engine
just test-web
just test-engine-live
CHROMIUM_BIN=/path/to/chromium just test-demo-browser
```

실제 모델 시험은 일반 검사에서 자동 호출하지 않는다. `test-engine-live`는 웹과 DB 없이 가상 입력으로 분석→시험자가 정한 승인 정보→실제 모델 작성·검토→독립 재검토를 실행한다. 결과는 `.local/test-results/engine-live.json`에 저장한다. 브라우저 시험은 실행 중인 demo 화면에서 네 사례의 승인·재생성·편집·재검토·선택 변경·다운로드 바이트를 확인한다. Chromium은 별도 설치된 실행 파일을 지정한다.

## 현재 범위와 남은 작업

새 경로는 임시 시연과 엔진 실험을 위한 단일 사용자 작업 공간이다. 새로고침하면 화면 작업이 사라진다. 서버에 작업·원자료를 저장하지 않고 브라우저 localStorage도 사용하지 않는다. 다운로드 파일은 사용자가 관리한다. 기존 DB를 이전하거나 삭제하지 않는다.

재사용 규칙·A–D 수치 변환·등록 제품 팩·재현 runner·상세 detector·확정 이력·사내 인증은 새 경로에 아직 연결하지 않았다. 기존 전체 기능 명세가 이 경로에서 모두 구현됐다고 해석하지 않는다. 인터넷 격리·사내 반출 권한·모델 endpoint 통제는 배치 환경에서 별도 적용해야 한다. 기존 CONTEXT_BUDGET_EXCEEDED의 근본 구조 개선은 이번 실행 분리와 구분하며 제한값을 늘려 해결했다고 주장하지 않는다.
