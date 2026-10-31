# transcript 기록 + 세 가지 실제 사례 확인 (4차)

2026-10-31 UTC. 기존 모델 가상 데이터 실행 승인에 따라 로컬 Docker와 기존 `.env`의 등록 모델을 실제로 호출했다. 실제 업무 원자료·새 외부 모델은 쓰지 않았고 모델 주소·ID·키·비공개 설정은 기록하지 않는다.

## 실행 전 발견한 문제: 등록 이미지가 낡음

`.local/oss-smoke-registration.json`과 `var/runners/targets.json`이 가리키던 `safehandoff-runner:local`
이미지를 열어보니 지금 소스(`packages/sandbox-runner/image/main.go`, 단일 `/repro` 바이너리)와
전혀 다른 과거 레이아웃(`/buggy`, `/fixed`, `/checker`, `/probe` 네 바이너리)이었다. 이 이미지로
`DockerReproRunner.reproduce()`를 실제로 부르면 `exec: "/repro": stat /repro: no such file or
directory`로 컨테이너가 바로 죽어 `REPRO_UNAVAILABLE`만 반환했다(원인 문자열은 보안상 호출자에게
노출하지 않으므로 `docker start` 결과를 직접 재현해 확인).

`packages/sandbox-runner/image/README.md`의 설치 절차대로 다시 빌드해 해결했다:

```sh
CGO_ENABLED=0 GOPROXY=off GOTOOLCHAIN=local go build -trimpath -o .local/repro-image/repro packages/sandbox-runner/image/main.go
docker build --pull=false --network=none -t safehandoff-repro:local -f packages/sandbox-runner/image/Dockerfile .local/repro-image
```

새 이미지 전체 ID로 `.local/oss-smoke-registration.json`을 갱신했다. 소스 코드는 바뀐 게 없다 —
`.local/`은 gitignore 대상이라 낡은 로컬 Docker 상태 문제였다. `var/runners/targets.json`/
`checker.json`은 어떤 코드에서도 읽지 않는 레거시 파일로 확인됐다(이번엔 손대지 않음).

## 실행한 세 사례

`node tools/oss-repro-smoke.mjs --registration .local/oss-smoke-registration.json --live-model`을
`SAFEHANDOFF_TRANSCRIPT_DIR=.local/transcripts SAFEHANDOFF_TRANSCRIPT_CONTENT=1`로 세 번 실행했다
(seed만 다름 — CLI는 seed=42 고정이라 7, 2026은 라이브러리 함수를 직접 호출).

| seed | 합성 입력(ascii/한글) | 재현 | 검토 | transcript run_id |
| --- | --- | --- | --- | --- |
| 42 | QWERTY / 하늘바다나무 | reproduced | pass | `8a6809d4-...` / `95ffa610-...`(2회 실행) |
| 7 | MMJBLF / 뜆쿞틌폻귄킣 | reproduced | pass | `02b435d5-...` |
| 2026 | ZEXSGJ / 뮢콼쉮쿅뫼쵓 | reproduced | pass | `1c116ca4-...` |

세 사례 모두 최종 문서가 "ASCII 저장 성공, 한글은 encode 단계에서 E_ENCODE_SHORT_BUFFER로 실패,
네 조합 총 4회 실행, 재현 조건 확인, 원래 사건과 같은 근본원인 증명은 아님"을 정확히 반영했다.
작성 약 4~5초, 검토 약 4초 수준이었다.

## transcript 확인

`.local/transcripts/transcript-<run_id>.jsonl`을 직접 열어 `docs/transcript.md` 설명과 대조했다.
`run_started`(model_mode=live) → `model_started`(writer, content에 프롬프트 포함) →
`model_completed`(writer, content에 검증된 draft.v1 포함) → reviewer 동일 과정 →
`review_completed`가 순서대로 기록됐다. 파일 권한은 0600, 디렉터리는 0700이었다.

## 범위

`analyze()`와 사람 승인 UI는 여전히 미구현이며 facts는 스크립트가 직접 구성했다(이전 계획과 동일).
`document_status=reviewed_draft_not_finalized`, `manual_review_required=true`는 세 사례 모두 유지됐다.
모델 pass는 사람의 최종 공개 승인이 아니다.
