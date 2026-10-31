# ToyRecord 팩 연결 실행

`toyrecord-repro` 1.0.0은 가상 제품의 고정 재현 팩이다. 역할 문서는 로딩하지만 RealCore 프롬프트에
주입하지 않는다. candidate와 공개 결정은 기존 스모크 fixture를 사용한다. 팩 선택은 공개 승인이나
도구 실행 권한이 아니며 기존 합성 입력 grant와 정형 결과 승인을 그대로 사용한다.

## 설치와 운영자 등록

먼저 `pnpm build` 후 팩을 등록한다. 다음 파일은 모두 로컬 내부 기록이다.

```sh
node tools/pack-register.mjs --root fixtures/skills/toyrecord-repro \
  --allowlist fixtures/skills/toyrecord-allowlist.json --catalog .local/toyrecord-catalog.json
```

운영자가 직접 빌드/확인한 로컬 image의 정확한 `sha256:` digest와 catalog pin으로
`.local/toyrecord-installation.json`을 만든다. 예시는 형식 설명이며 실제 image 등록값이 아니다.
pack 객체에는 선택한 catalog 항목의 root를 제외한 네 필드를 그대로 복사한다.

```json
{
  "schema_version": "toyrecord_installation.v1",
  "pack": {
    "id": "toyrecord-repro",
    "version": "1.0.0",
    "manifest_sha256": "<catalog의 manifest_sha256>",
    "pack_sha256": "<catalog의 pack_sha256>"
  },
  "target_pair_id": "toyrecord.sandbox-observation.v1",
  "image": "sha256:<운영자가 확인한 로컬 image digest>"
}
```

재현 명세는 팩 내부의 `assets/reproduction.v1.json`에 고정한다. 해당 파일은 pack digest에 포함된다.
`toyrecord_reproduction.v1`의 필드는 schema_version, target_pair_id, oracle_id, supervisor,
targets, input_kinds, codepoint_count, tool_ids, result_contract다. 현재 runner가 지원하는 고정
값과 정확히 일치해야 하며 명령/실행 경로/Docker 옵션을 받을 자리는 없다. 중복 JSON 키와
표현 차이로 해석이 갈리지 않도록 명세 asset은 JSON.stringify(value, null, 2) 형식과 선택적
마지막 줄바꿈만 허용한다. UTF-8로 저장한다.

## 실행

```sh
SAFEHANDOFF_TRANSCRIPT_DIR=.local/transcripts SAFEHANDOFF_TRANSCRIPT_CONTENT=1 \
  node tools/oss-repro-smoke.mjs --catalog .local/toyrecord-catalog.json \
  --pack-version 1.0.0 --registration .local/toyrecord-installation.json \
  --seed 42 --output .local/toyrecord-pack-smoke-42.json
```

기본은 고정 모델 응답 fixture다. 승인된 실제 모델 테스트에는 기존과 같이 `--live-model`을 추가한다.
`--seed`는 0-4294967295 정수이며 기본 42다. 출력은 기존 파일을 덮어쓰지 않는다.

`--catalog`와 `--pack-version`은 함께 필요하다. `--registration`은 모든 경로에서 필수다.
legacy 경로는 catalog/version 없이 기존 image 등록 파일을 사용하며 selected_pack=null이다.
새 bound installation을 catalog 없이 넘기면 거부한다. 두 경로 모두 image tag를 허용하지 않는다.
팩 모드에서는 catalog의 정확한 id/version이 하나여야 하며 실행 전에 verify로 pin을 재검증한다.
ID 허용목록은 실행 코드에 고정하며 팩이나 catalog에서 권한을 가져오지 않는다. pack pin/target/
image 등록이 불일치하거나 도구/명세가 누락되면 모델/Docker 호출 전에 실패한다. 실제 image
identity 대조는 DockerReproRunner가 계속 수행한다.

보고서 selected_pack에는 id/version/manifest_sha256/pack_sha256/target_pair_id/skill_set_hash가
들어간다. transcript의 run_started 다음 pack_selected에 같은 값을 기록한다. 설치 경로는 기록하지
않는다. 해당 skill_set_hash는 이번 스모크 grounding scope에도 사용한다. 서버 task의 revision/
artifact 무효화나 전체 도구 registry 권한 연결을 구현했다는 의미는 아니다.

검증은 catalog/pin/등록/명세/도구/run_id 연결 등 결정적인 조건만 회귀 검사한다. 실제 Docker
4-run 확인과 실제 모델 호출은 별도로 실행한다. 검토 pass는 사람의 최종화나 문장 의미의 자동
정확도 보증이 아니다.
