# API와 역할 계약

API의 단일 기준은 [api.md](api.md), 모델 역할의 단일 기준은 [agent-workflow.md](agent-workflow.md)입니다. 이 문서는 두 계약의 읽기 안내입니다. 아래는 구현할 계약이며 현재 서버의 모든 경로가 이를 지원한다는 뜻은 아닙니다. 구현 상태는 [검증보고서](검증보고서.md)를 따릅니다.

## 접속과 변경 요청

기본 주소는 `http://127.0.0.1:8080/api/v1`입니다. 시작 시 터미널에 표시한 5분 일회용 토큰을 `/connect`에서 입력하고 `POST /auth/session`으로 8시간 세션을 엽니다. `GET /session` 무인증 발급은 새 계약에 사용하지 않습니다. 세션 폐기는 `DELETE /auth/session`입니다. Host·Origin·세션·CSRF를 검사하고 외부 CORS를 허용하지 않습니다.

일반 변경 요청에는 `X-CSRF-Token`, `Idempotency-Key`, `expected_revision`을 사용합니다. 생성·인증·규칙 판본 관리의 예외는 [API 공통 규칙](api.md)을 따릅니다. 같은 요청 재전송은 동일 키와 바이트를 유지합니다.

## 작업과 공개 결정

작업 생성에는 목적·수신자·범위·언어·등록 지침 외에 `goal_variant`가 필요합니다. scope는 `project_id`, `purpose_id`, `goal_variant`, `recipient_id`, `audience`, `skill_set_hash`로 구성합니다. 목표별 허용 조합과 필수 정보는 [공통 계약](../contracts/domain-contract.json)을 따릅니다. 프로젝트·수신자 카탈로그는 로컬 설정으로 관리합니다.

자료 추가는 `POST /tasks/{id}/source-batches`의 multipart `meta.items`와 파일로 처리합니다. 업로드 자체는 공개 승인이 아닙니다. `POST /tasks/{id}/jobs`는 분석·조건 해석·작성·검토·재현을 접수하고, 결과는 job 상태로 확인합니다.

미리보기는 `POST /tasks/{id}/disclosure-previews`, 결정은 `POST /tasks/{id}/decision-batches`입니다. 결정 batch는 `operations` 대신 `items`를 사용합니다.

```json
{
  "expected_revision": 8,
  "items": [
    {
      "candidate_id": "cand_volume",
      "disposition": "allow",
      "preview_id": "preview_direction",
      "approved_projection_sha256": "<실제 64자리 SHA-256>",
      "expires_at": null,
      "save_rule": true
    }
  ]
}
```

허용은 현재 미리보기와 해시가 필요합니다. source·scope·정확값/원문 grant는 서버의 preview binding에서 구성하며 클라이언트가 별도 권한으로 보내지 않습니다. exclude/defer에는 preview·grant를 넣지 않습니다. 필수 정보가 부족하면 goal을 명시적으로 바꾸고 재분석·재결정하며 `scope_reduced`로 목표 계약을 대체하지 않습니다.

## 원문·재사용·확정

원문 표현은 `approved_excerpt.parameters`의 source_version_id·start·end·hidden_ranges로 지정합니다. UTF-8 절대 바이트 범위, 원자료 판본, 실제 렌더링 해시를 검사하며 숨김 표식은 `[가림]`입니다. 작성기는 excerpt 슬롯만 받고 앱이 승인 바이트를 삽입합니다. 과거 `[비공개]` 바이트의 승인을 새 해시로 자동 이전하지 않습니다.

저장 기준은 정확한 scope·schema/version·selector·transform/version에 맞을 때 새 자료로 재계산합니다. 정확값·원문은 재사용하지 않습니다. 명시적 적용은 `POST /tasks/{id}/rules/apply`입니다.

확정은 `POST /artifacts/{id}/finalize`에 `expected_revision`, `expected_artifact_set_hash`, `confirm=true`를 보냅니다. `confirmed`는 새 계약에 사용하지 않습니다. 사람 검토는 target_kind·target_hash·checklist·fallback_reason으로 기록하며 hard gate를 우회하지 못합니다. 다운로드는 확정 저장 바이트를 반환합니다.

작업 삭제는 `DELETE /tasks/{id}`에서 revision, `confirmation="DELETE"`, `acknowledge_saved_rules_retained=true`를 확인합니다. 입력 제외·규칙 철회와 구분하며 저장 기준은 별도로 남습니다.

## 역할과 기록

분석기·검토기는 원자료를 읽을 수 있지만 작성기는 현재 승인팩과 공개 지침만 받습니다. 검토의 자유 설명·원문 오류·stderr는 writer에 전달하지 않습니다. 직접 입력 해석은 권한이 아닌 제안입니다. 필수 정보는 등록 template needs와 의미 검토로 판단하며 모델의 required 추천만으로 공개를 강제하지 않습니다.

모델 요청/응답 본문은 기본 미저장, 명시적 debug 기록은 최대 24시간입니다. 역할별 호출 메타데이터와 fixture/live/사람 검토를 구분합니다. SSE에는 상태만 보냅니다.

정확한 DTO·오류·경계값은 [api.md](api.md), [core.schema.json](../contracts/core.schema.json), [agent-workflow.md](agent-workflow.md)를 함께 따릅니다. 기존 `scripts/generate-openapi.py`·`scripts/generate-contracts.go`는 현재 코드 계약을 생성하므로 새 명세를 적용하는 도구로 간주하지 않습니다.
