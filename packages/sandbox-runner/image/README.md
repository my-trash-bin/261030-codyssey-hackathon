# 고정 toy 실행기 설치와 검사

이 이미지는 의도적인 UTF-8 버퍼 결함의 buggy/fixed 두 모드와 실제 파일을 읽는 supervisor를 포함한다. 임의 프로그램 실행기는 아니다. supervisor는 대상 프로세스 종료 후 `/out/result.bin`의 파일 종류/크기/바이트를 확인하고, 호스트는 base64 바이트와 등록한 합성 입력을 다시 비교한다. 등록 이미지 전체가 신뢰 경계다.

## 실제 앱 자동 준비

`mise install` 후 기존 `just app`은 의존성 설치·빌드·모델 연결 정보 입력을 처리한다.
config의 reproduction.enabled가 true이고 `SAFEHANDOFF_REPRO_REGISTRY`가 없으면 아래 이미지 빌드와
등록 파일 생성을 자동 수행하고, 생성한 경로를 실제 앱 프로세스에 전달한다.
파일은 `.local/app-runtime-*/repro-registration.json`에 저장한다. config·기존 재현 등록은 수정하지 않는다.
모델 연결 정보는 `.env`가 없으면 `.env.example`을 복사한 뒤 입력받아 `.env`에 저장한다.
등록 경로가 이미 있으면 이를 사용하며 reproduction이 disabled이면 Docker 준비를 생략한다.
Linux Docker 설치·데몬·권한은 별도로 준비한다. HTTP/UI 재현 실행은 아직 미구현이다.
[실행 안내](../../../README.md) 3.2를 참고한다.

## 설치 시 빌드

Go 도구와 Docker가 설치된 호스트에서 저장소 루트 기준으로 실행한다. Go 표준 라이브러리만 사용한다. 아래 빌드는 업무 실행과 분리하며 다운로드를 하지 않는다.

```bash
mkdir -p .local/repro-image
CGO_ENABLED=0 GOPROXY=off GOTOOLCHAIN=local go build -trimpath -o .local/repro-image/repro packages/sandbox-runner/image/main.go
docker build --pull=false --network=none -t safehandoff-repro:local -f packages/sandbox-runner/image/Dockerfile .local/repro-image
docker image inspect safehandoff-repro:local --format '{{.Id}}'
```

출력된 전체 `sha256:...` 이미지 ID를 운영자가 검토한 등록 파일의 image에 넣는다. 변경한 이미지에는 새로운 등록과 검토가 필요하다. tag나 예제 digest로 실행하지 않는다.

등록 JSON은 image, target_pair_id, synthetic_input_set_id, inputs: {ascii, multibyte}, seed를 가진다. image는 실제 로컬 이미지 ID, ID 두 개는 설치자가 부여한 식별자다. inputs는 새로 만든 동일 길이 1-8자의 대문자 ASCII와 한글이며 seed는 정수 또는 null이다. 원자료를 복사해 넣지 않는다. 등록 파일은 .local 안에 보관한다.

`SAFEHANDOFF_REPRO_REGISTRY`로 파일을 지정하고 설정의 reproduction.enabled를 true로 지정하면 앱이 runner를 주입한다. 재현 HTTP API는 아직 없으며 라이브러리에서 `reproductionRequest(registration)`으로 만든 참조 요청만 runner에 전달한다. 설치 등록은 공개 승인을 대신하지 않는다.

## 실제 로컬 검사

```bash
SAFEHANDOFF_TEST_DOCKER_IMAGE=$(docker image inspect safehandoff-repro:local --format '{{.Id}}') \
  node --conditions=development --test packages/sandbox-runner/src/docker.test.ts
```

일반 CI에서는 Docker 경계의 mock 검사를 수행하며 실제 이미지 검사 두 개는 위 변수가 없으면 skip한다. 실제 검사는 네 결과와 Docker 격리 설정, 취소 후 컨테이너 정리를 확인한다. `ready`는 등록 여부를 뜻하며 데몬/이미지 사용 가능 여부는 실행 시 확인한다.

실행은 Linux 로컬 `/var/run/docker.sock`과 `/usr/bin/docker`만 사용한다. inherited Docker context, 원격 daemon, 프록시, 사용자 Docker 인증 설정, 모델 키를 전달하지 않는다. container는 15초 실행 예산과 별도 최대 3초 정리 예산을 사용한다. 컨테이너 생성/시작 실패와 정리 실패는 오류로 반환한다. 호스트 shell 실행으로 대체하지 않는다.

프로세스 강제 종료/호스트 장애에서는 finally가 실행되지 않을 수 있다. 운영자는 `safehandoff-` 접두사 컨테이너를 점검해야 하며 앱이 다른 프로세스의 진행 중 컨테이너를 자동 삭제하지 않는다. 시작 시 회수/실행 소유권 ledger는 후속 운영 범위다.
