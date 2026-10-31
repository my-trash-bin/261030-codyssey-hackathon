# API와 역할 계약

이 문서는 기존 PoC의 **현재 API 사용법**입니다. [api.md](api.md)·`contracts/core.schema.json`은 새 구현 목표이며 현행 API와 바로 호환되지 않습니다. 특히 세션 경로, 결정 batch, 확정 필드가 다릅니다. [문서 정합성 대조](검증보고서.md#기존-문서와-새-문서의-정합성-대조)를 참고하세요.

기본 주소는 `http://127.0.0.1:8080/api/v1`입니다. [실제 라우트 OpenAPI](../contracts/openapi.json)에 구현된 경로를 기록했습니다. 모델 계약은 `contracts/*.schema.json`, 사용자 요청 DTO는 `internal/httpapi`의 별도 구조체입니다.

## 브라우저와 변경 요청

먼저 `GET /session`으로 `csrf_token`과 HttpOnly 세션 쿠키를 얻습니다. 변경 요청은 `X-CSRF-Token`, `Idempotency-Key`, `expected_revision`을 보냅니다. 생성·provider check·rule version은 각자의 생성·판본 계약을 씁니다. 쿠키·Host·Origin 검사가 실패하면 403, 낡은 판본·해시·멱등 키 충돌은 409입니다. 외부 CORS를 허용하지 않습니다.

1. `POST /tasks`: 목적은 `oss_issue`, `vendor_support`, `operations_advice`; 범위는 `public`, `named_external`입니다. 기본 내장 제품 팩을 쓰며 `skill_ids`의 임의 선택은 거부합니다.
2. `POST /tasks/{id}/source-batches`: multipart `meta` JSON과 `client_key` 이름의 파일 필드. 일괄 파싱·크기 확인 후 한 번의 revision 증가로 저장합니다. 붙여넣기도 파일 한 개입니다.
3. `POST /tasks/{id}/jobs`: `analyze`, `interpret_disclosure`, `compose`, `review`, `reproduce`. 접수는 202이며 실제 결과는 `/jobs/{id}`에 기록합니다. `reproduce`는 별도로 승인한 합성 입력 후보가 있어야 실행합니다.
4. `POST /disclosure-previews`: 현재 후보와 표현에서 실제 공개 투영·해시·preview ID를 받습니다.
5. `POST /decision-batches`: `allow/exclude/defer`. allow는 서버 미리보기와 동일한 해시·표현·grant가 필요합니다. 선택을 바꿀 때마다 새 미리보기를 만듭니다. 필수 후보를 제외하면 `scope_reduced=true`의 명시적 PATCH 또는 batch의 `accept_scope_reduction=true` 확인이 있어야 작성할 수 있습니다.
6. `POST /artifacts/{id}/finalize`: `expected_revision`, `expected_artifact_set_hash`, `confirmed=true`. 확정 후 export 파일과 archive를 받을 수 있습니다.

`GET /tasks/{id}/events`는 Last-Event-ID 이후 이벤트를 재생하는 SSE입니다. 자료·모델 출력 토큰은 보내지 않습니다. 화면은 작업 중 polling으로도 복구합니다. 내부 run trace는 DB와 evaluator 내부 보고서에만 있으며 공개 ZIP에는 들어가지 않습니다.

## 원문 승인

`approved_excerpt`는 일반 사실 승인과 별개입니다. preview와 decision operation의 `raw_grants`에 단일 원문 grant를 전달합니다.

```json
{
  "source_version_id": "srcv_실제ID",
  "source_sha256": "원본바이트SHA256",
  "byte_range": {"start": 0, "end": 20},
  "hidden_ranges": [],
  "rendered_sha256": "실제렌더링바이트SHA256",
  "scope": {
    "project_id": "project_demo",
    "purpose_id": "oss_issue",
    "recipient_id": "public",
    "audience": "public",
    "skill_set_hash": "현재작업해시"
  },
  "expires_at": null
}
```

범위는 원본 UTF-8의 반열린 바이트 구간이며 후보 근거 안에 있어야 합니다. 숨김 구간은 `[비공개]`로 대체한 **실제 바이트** 해시를 사용합니다. UTF-8 문자 경계를 나누거나 source 판본·hash·scope·expiry가 달라지면 거부합니다. writer에는 슬롯 ID만 주고, 파일 구성기가 `approved-excerpt.txt`를 삽입합니다. 브라우저의 원문 구간 선택에서 근거·시작·끝·숨김 범위를 지정하고 실제 렌더링 미리보기 후 적용할 수 있습니다. API 통합시험과 고급 브라우저 시험으로 검증합니다.

## 모델 역할

| 역할 | 입력 | 출력 |
| --- | --- | --- |
| analyst | 선택한 원자료의 UTF-8 내용, 앱 evidence ID, 목적, 내부 제품 지침 | 근거 있는 후보·불확실성·충돌 |
| writer | 새 messages의 승인팩, 공개 작성 지침 | 제한된 DocAST |
| reviewer | 원자료, 현재 결정, 승인팩, 현재 문서 또는 실제 파일 텍스트·hash | 정형 검토 지적 |
| disclosure | 직접 입력 조건·현재 후보·등록 변환 | 권한이 아닌 구조화 제안 |
| check | 비민감 고정 연결 확인 | `{"ok":true}` |

텍스트 HTTP 응답은 단일 JSON만 받습니다. 중복·알 수 없는 키·키 대소문자 변형·후행 JSON·형식 오류·잘림을 거부합니다. 전체를 감싼 단일 json fence만 제거할 수 있습니다. 문서 fact ID·슬롯·필수 사실·새 숫자는 앱이 별도로 검사합니다. 형식 복구는 기본 두 번, 전체 호출은 12번, 작성 수정은 두 번으로 제한합니다.

API `human-review`는 실제 파일을 확인한 사유와 현재 hash에 mode=human을 기록합니다. 의미 검토와 모델 성공 통계를 구분하며, 미승인·만료·낡은 판본·파일 오류·추가 공개 결정 요구를 우회하지 않습니다.

## 계약 파일 갱신

```bash
mise exec -- go run ./scripts/generate-contracts.go
python3 scripts/generate-openapi.py
```

Python은 계약 문서 재생성에만 사용하며 앱 실행에는 필요하지 않습니다. 모델 정상/오류 corpus는 `contracts/examples`와 Go 시험이 공유합니다. 모든 계약의 완전한 JSON Schema 런타임 검증과 동일 corpus 전수 검증까지 구현된 것은 아닙니다. 현재 실제 강제는 strict decoder·역할별 검증기·도메인 교차 참조 검사입니다.

고정 공개 repro 코드는 앱이 digest를 검증한 뒤 최종 검토 입력에는 파일명·hash와 `registered_public_asset=true`만 전달합니다. 새 본문·표·원문·설정·실행 결과는 실제 텍스트를 검토합니다. writer에는 불확실성 메타데이터를 보존한 승인팩만 전달합니다.
