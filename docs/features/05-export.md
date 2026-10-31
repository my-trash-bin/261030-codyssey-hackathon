# F05 - 최종 파일 확인/확정/복사/다운로드

상태: P0 구현 기준안 / 기준일: 2026-10-31 / 구현 담당: [plan.md](../product/plan.md)의 F05 담당

## 1. 목적

[PRD-08](../product/prd.md)에 따라 사용자가 확인한 **현재 선택의 실제 파일**을 그대로 사용할 수 있게 한다. 검사한 초안과 내려받은 첨부가 다르거나, 선택을 바꾼 뒤 이전 자료가 다시 사용되는 일을 앱의 확정/내보내기 경로에서 막는다(INV-07~09).

이 기능은 자료를 외부로 전송하지 않는다. 파일을 확인하고 복사/다운로드하는 사용자 동작을 제공한다. 내부 미리보기를 사용자가 직접 복사하거나 OS의 다른 앱으로 공유하는 행위까지 통제하는 제품은 아니다.

## 2. 쓰는 사람과 권한

| 주체 | 허용 | 금지 |
| --- | --- | --- |
| 현재 사용자 | 실제 파일 미리보기, 검사 상태 확인, 현재 결과 확정, 유효한 확정 파일 다운로드 | 누락결정/만료/오래된 hash/필수 검사 실패를 확정 클릭으로 무시 |
| 작성/검토 모델 | 승인 범위에서 초안 작성/의미 검토 결과 제출 | finalize API 호출, 임의 파일 추가, 외부 전송 |
| 서버 파일 구성기 | DocAST/승인 슬롯/등록 asset/허용 도구 결과로 파일 구성 | 작업 디렉터리 전체 압축, 내부 원자료/trace 자동 첨부 |
| 외부 수신자 | 사용자가 별도로 제공한 파일 이용 | 앱의 export API 직접 접근 권한 없음 |

최종 확정은 F03의 공개 결정과 별개다. 새로운 사실/값/원문을 추가하려면 먼저 F03에서 해당 범위를 결정하고 새 결과를 검사한다.

## 3. 화면

UI-06(`/tasks/{id}/final`)은 UI-03에서 `최종 파일 확인`으로 들어간다. 표시할 내용은 목적/goal_variant/수신자/공개 범위, 현재 파일 판본, 실제 파일 목록, 공개 원문/정확값 사용 항목, 검토 모드, 필수 검사 상태, 재현 상태다.

파일마다 이름/형식/크기/실제 내용을 볼 수 있어야 한다. 본문뿐 아니라 CSV/JSON/승인 인용/공개 실행 파일도 목록에 표시한다. 등록된 고정 공개 자산은 설명/판본/digest를 보여주고 원문 근거/내부 진단과 섞지 않는다. 파일 hash 등 기술 정보는 접을 수 있다.

버튼은 확정 전 `작업으로 돌아가기`, `이 파일들로 확정`; 확정 후 `본문 복사`, `개별 파일 다운로드`, `패키지 다운로드`다. 공유 자동 제출 버튼은 없다.

### 빈 화면/실패/권한 상태

| 상태 | 표시 / 행동 |
| --- | --- |
| 후보 파일 없음 | 작업 공간으로 이동해 작성 |
| ready 이전 파일 | `작성/검토 중인 파일`로 열람. 확정 동작 없음 |
| 보류/필수 미결정 | 문제 항목으로 이동, 확정 비활성 |
| 사람 의미 검토 필요 | 현재 파일/미해결 의미 항목 표시, F04의 human 검토로 이동 |
| hard check 실패 | 이유와 수정 경로 표시. 체크박스 우회 없음 |
| `not_run / no_environment` | 실제 미실행 상태 표시. default/observations_only 문의는 확정 가능 |
| `reproduction_evidence` 미충족 | 재현 확인 목표를 충족하지 못함 표시. 재실행 또는 명시적 goal 변경 |
| 확정 중 선택 변경 | 409를 표시하고 현재 revision으로 이동 |
| 다운로드 시 만료/철회 | 현재 export 사용 불가, 현재 질문/작업으로 이동 |
| 브라우저 클립보드 거부 | 복사 실패 표시, 같은 확정 파일 다운로드 제공 |

`현재 선택 기준 검사 완료`라는 표현을 쓰고 '안전 보장', '유출 위험 없음'으로 표시하지 않는다. 오래된 결과는 내부 이력으로 읽을 수 있으나 앱의 복사/다운로드 대상이 아니다.

## 4. 데이터

| 표 | 읽기 | 쓰기 / 제약 |
| --- | --- | --- |
| tasks / snapshots | 현재 revision/scope/goal/포인터 | 확정 시 현재 phase 및 artifact 포인터 검사 |
| decisions / rules / fact_packs | 현재 허용/만료/철회/팩 hash | 확정 때문에 새 공개 허용을 만들지 않음 |
| artifacts | DocAST/artifact_version/revision/상태/hash | draft/checking/blocked/ready/finalized/stale 전이 |
| artifact_files | 허용된 실제 bytes/경로/형식/size/sha256/내부 provenance | 파일 구성 때만 생성. 확정 이후 바이트 변경 없음 |
| reviews / findings / tool_runs | 동일 대상 hash의 검토와 검사/예외/재현 결과 | 현재 파일 집합과 결합한 검사 기록 |
| exports | 이미 확정한 결과 조회 | artifact_set_hash, 저장 ZIP bytes/hash, confirmed_at |
| events / idempotency_keys | 중복확정/변경 상태 | 확정과 같은 트랜잭션에서 이벤트/응답 저장 |

내부 provenance는 문서/표/인용이 어떤 승인에서 왔는지 검증하는 데 쓴다. 별도 공개 허용 없이 공개 manifest나 첨부에 넣지 않는다. 구체 스키마는 [ERD](../design/erd.md)를 따른다.

## 5. 규칙과 파일 구성

### 공유 파일의 출처

공유 payload는 현재 DocAST와 승인된 표/원문 슬롯/공개 도구 결과/등록 공개 asset에서만 만든다. 원자료 파일, 모델 request/response, 검토 자유 설명, 도구 stderr, 평가 정답, 공급사 역할 자료, 내부 로그는 자동 첨부 대상이 아니다.

파일 이름은 목적별 고정 allowlist에서 정한다. 사용자 작업 이름/고객이 포함된 원본 파일명을 공개 이름으로 사용하지 않는다. 예시는 `issue.md`, `support-request.md`, `operations-brief.md`, `observations.csv`, 승인된 경우의 `timeline.csv`/설정 예시/재현 폴더다. 최종 목록의 권위는 [spec](../design/spec.md)와 제품 팩의 허용 asset 목록이다.

### 직렬화

- Markdown은 동일 DocAST와 승인 슬롯에서 생성한다. 미리보기는 실제 공개 파일을 보여준다. 임의 raw HTML/임의 URL/원격 이미지가 실행/조회되지 않게 한다.
- CSV는 명시적 문자열/숫자 타입으로 직렬화한다. 수식으로 해석될 수 있는 문자열의 표현 규칙은 공통 spec을 따르고 실제 변환 결과를 미리보기에 보여준다. 정당한 숫자를 문자열 규칙 때문에 몰래 바꾸지 않는다.
- JSON은 공통 직렬화 규칙을 쓰고, 파일 hash는 실제 UTF-8 bytes에서 계산한다.
- 원문 승인 구간은 확인한 렌더러와 hash에 맞춰 삽입한다. 모델이 원문을 다시 타이핑한 것으로 대체하지 않는다.
- 후처리/형식 정리/맥락 예외 반영 등 바이트를 바꾸는 처리는 확정 전에 끝낸다.

### manifest와 ZIP

`manifest.json`에는 공개 payload의 상대경로/크기/해시만 기록한다. manifest 자신과 ZIP을 manifest 목록에 넣지 않는다. artifact_set_hash는 manifest를 포함한 모든 공개 파일의 정렬된 path/size/sha256 목록을 공통 직렬화하여 계산한다. ZIP hash는 별도로 계산한다.

ZIP은 allowlist 파일을 하나씩 추가한다. 절대경로, 상위경로, 역슬래시 우회, 중복 이름, 심볼릭 링크를 거부한다. 파일 순서/시각/권한을 공통 값으로 고정하고 원래 로컬 경로/원래 시각/ZIP 주석을 넣지 않는다. 디렉터리 전체 압축은 사용하지 않는다. 기본 export 최대 크기는 20MiB이며 조정값은 spec의 limits를 따른다.

### 확정의 필수 조건

다음을 서버에서 모두 확인해야 한다.

1. 인증 사용자와 task/artifact/file의 소속이 맞는다.
2. task revision, current artifact, expected_artifact_set_hash가 현재와 일치한다.
3. 사용한 결정/규칙/raw grant가 현재 범위에서 활성이고 만료되지 않았다.
4. 보류 및 목적/goal_variant의 필수 정보/검사 미충족이 없다.
5. 작성 중 검토 및 최종 파일 검토가 현재 대상 hash에 연결되어 있다.
6. 파일명/참조/등록 asset/공개 tool 결과/스키마/크기 등 hard check가 통과했다.
7. 해결되지 않은 보안 검사 finding이 없으며 맥락 예외는 해당 finding과 현재 hash에만 적용됐다. severity가 info인 보안 finding도 자동 통과하지 않는다. 비보안 작성 안내는 finding이 아닌 event로 구분한다.
8. 사용자가 현재 파일들을 확인하는 명시적 동작을 했다.

`reproduction_evidence`의 완료에는 목표 재현 확인이 필요하다. default/observations_only는 재현 미실행 상태를 정확히 밝힌 관찰 문의로 완성할 수 있다. 목표를 낮추는 행위는 별도 사용자 goal_variant 변경이며 finalize가 몰래 바꾸지 않는다.

### 원자적 확정과 다운로드

검사/파일 생성은 긴 DB 트랜잭션 밖에서 수행하고, 확정 트랜잭션에서 현재 조건을 다시 확인한다. 저장된 실제 파일/ZIP을 exports에 연결한 뒤 artifact/task를 finalized로 바꾼다. 최종 확정 전에 파일 bytes를 다시 생성하지 않는다.

다운로드 때도 현재 revision/artifact/hash와 승인/규칙의 만료/철회를 검사한다. 과거 확정 응답을 멱등하게 다시 받더라도 다운로드 권한이 부활하지 않는다. 무효한 export는 409 `EXPORT_INVALIDATED`다. 유효한 파일만 저장된 동일 bytes로 반환하며 모델/renderer/tool을 다시 호출하지 않는다.

본문 복사는 파일 API의 확정 UTF-8 bytes를 decode한 텍스트를 Clipboard API에 전달한다. OS나 붙여넣는 앱이 수행하는 줄바꿈/인코딩 정규화까지 동일 바이트로 보장하지 않는다. 다운로드 파일은 저장된 동일 bytes를 반환한다. 화면 DOM의 `innerText`나 내부 주석/근거까지 포함하는 복사 방식을 쓰지 않는다. 브라우저가 클립보드 쓰기를 거부하면 실제 실패를 표시한다.

확정 후 편집/첨부 변경/다시 작성은 새 revision과 재검토로 돌아간다. 파일 이름 한 글자만 바뀌어도 파일 집합 hash가 달라진다. 오래된 검토 결과를 사용하지 않는다.

## 6. 다른 기능과 계약

| 서비스 / API | 입력 | 반환 / 연결 |
| --- | --- | --- |
| artifact 조회 / `GET /api/v1/artifacts/{artifact_id}` | 인증/task 소속 | 현재 DocAST/파일 목록/hash/검토/검사 상태 |
| 내부 후보 미리보기 / `GET /api/v1/artifacts/{artifact_id}/files/{file_id}/preview` | 인증/객체 소속 | 실제 후보 파일 bytes, 상태 표시. 확정 다운로드와 구분 |
| `ExportService.Finalize` / `POST /api/v1/artifacts/{artifact_id}/finalize` | expected_revision, expected_artifact_set_hash, 명시적 사용자 확인, Idempotency-Key | export_id, 확정 파일 목록/hash/시각 |
| `ExportService.GetFile` / `GET /api/v1/exports/{export_id}/files/{file_id}` | 현재 세션, 현재 유효성 | 저장된 동일 파일 bytes |
| `ExportService.GetArchive` / `GET /api/v1/exports/{export_id}/archive` | 현재 세션, 현재 유효성 | 저장된 동일 ZIP bytes |

F04가 문서/검토 결과를 제공하고 F03/F06이 결정/규칙 유효성을 제공한다. F07은 해당 finding의 맥락 결과만, F08은 고정 재현 결과만 제공한다. F09는 기록/삭제를 담당한다. F10은 응답 no-store/nosniff/Content-Disposition, 안전한 렌더링, 인증을 집행한다. 오류 code/HTTP status와 정확한 DTO는 [api.md](../design/api.md)에 따른다.

## 7. 하지 않을 것

외부 메일/티켓/GitHub 자동 제출, 공개 URL 생성, 다른 사용자에게 다운로드 권한 부여, 내부 승인 이력의 자동 첨부, 이미 받은 파일 회수, 모든 의미 유출 방지 보장은 없다. 추후 티켓 연결은 현재 확정 판본/수신자 확인 흐름을 확장하는 별도 기능이다.

## 8. 끝났다는 기준

| ID | 분류 | 실행과 기대 결과 |
| --- | --- | --- |
| AC-F05-01 | 정상 | 모든 실제 파일을 확인/확정하고 다운로드한 bytes가 확인 대상 hash와 정확히 일치 |
| AC-F05-02 | 정상 양성 | 명시 승인한 원문/정확값/공개 asset은 정확히 포함되며 필요한 기술 단서를 보존 |
| AC-F05-03 | 경계 | 검사 후 본문/파일명/첨부 한 바이트 변경 시 이전 검토로 확정 불가 |
| AC-F05-04 | 패키지 | 실제 ZIP에 allowlist 파일만 있고 내부 원자료/trace/평가/원래 경로/시각 없음 |
| AC-F05-05 | 경로 | 절대경로/..//역슬래시/중복 경로/심볼릭 링크/크기 초과 거부 |
| AC-F05-06 | 승인 | 보류/필수 미결정/만료/철회/깨진 참조/필수 검사 오류면 API 직접 호출도 차단 |
| AC-F05-07 | 의미 검토 | human fallback은 별도 기록하고 hard check를 우회하지 않음 |
| AC-F05-08 | goal | default 미재현 문의는 확정 가능, reproduction_evidence 미충족은 확정 불가 |
| AC-F05-09 | 동시성 | 확정 중 선택 변경/동일 요청 재전송/다른 hash의 멱등 키 재사용을 계약대로 처리 |
| AC-F05-10 | 다운로드 | 확정 후 철회/선택 변경 시 과거 URL과 멱등 재응답으로도 파일을 받을 수 없음 |
| AC-F05-11 | 권한 | 비인증/다른 task의 artifact/file/잘못된 CSRF 요청이 파일을 읽거나 확정하지 못함 |
| AC-F05-12 | UI | A/B/C/D 변경의 결과가 실제 파일에 반영되고 복사 실패를 성공처럼 표시하지 않음 |
| AC-F05-13 | 수신자 | 앱/원자료 없이 공개 파일만 받은 수신자가 해당 사례의 다음 행동 수행 가능 |

대응 시험: [qa.md](../qa/qa.md)의 T02, T06, T16, T19-20, T23, T28, T32, T35, T37, T43, T52, T58-59.

## 9. 확인 필요와 구현 순서

실제 회사에서 결과물을 공유할 권한은 Q-POLICY, 실제 공개 패키지/제품 지침의 라이선스는 Q-LICENSE/Q-EXT다. 기본 가상 패키지의 확정은 이 문서 기준으로 구현한다.

구현 순서는 파일 allowlist/직렬화 -> manifest/ZIP/hash -> current 상태와 검사 gate -> 원자적 finalize -> 다운로드 재검사 -> UI 최종 확인/복사 -> 실제 ZIP 검증이다. serialization 또는 공개 파일 구성이 바뀌면 spec/contracts/F03/F04/F07/F08/QA를 함께 수정한다.
