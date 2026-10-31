set shell := ["bash", "-euo", "pipefail", "-c"]

# 사용 가능한 명령
default:
    @just --list

# 고정 도구·Go 모듈·npm 개발 의존성 준비
setup:
    mise install
    mise exec -- go mod download
    mise exec -- go mod verify
    mise exec -- npm ci --ignore-scripts

# 서버·자료 생성기·평가기·checker 빌드
build:
    mkdir -p bin
    mise exec -- go build -buildvcs=false -trimpath -o bin/safehandoff ./cmd/safehandoff
    mise exec -- go build -buildvcs=false -trimpath -o bin/safehandoff-fixtures ./cmd/safehandoff-fixtures
    mise exec -- go build -buildvcs=false -trimpath -o bin/safehandoff-eval ./cmd/safehandoff-eval
    mise exec -- go build -buildvcs=false -trimpath -o bin/safehandoff-checker ./cmd/safehandoff-checker

fixtures: build
    ./bin/safehandoff-fixtures --scenario b2b-timeout --seed 41 --variation baseline --out var/demo-inputs

prepare-runners: build
    ./bin/safehandoff-eval --mode prepare

# QG·정책 회귀·Go·문서·서버 관리 시험
test:
    mise exec -- npm test

test-go:
    mise exec -- go test ./...
    cd fixtures/public/targets/toyrecord && mise exec -- go test ./...

test-docs:
    python3 tools/validate_docs.py

test-server:
    python3 -m unittest discover -s tools -p 'test_server.py'

lint:
    mise exec -- npm run lint

test-extensions: build
    ./bin/safehandoff-eval --mode extensions

# fixture 서버를 포그라운드로 실행
run-fixture: build
    ./bin/safehandoff --fixture --data-dir ./var/fixture

# live 서버를 포그라운드로 실행
run config="config.json": build
    ./bin/safehandoff --config {{ quote(config) }}

# live 서버를 백그라운드로 실행
start config="config.json": build
    python3 tools/server.py start --config {{ quote(config) }}

# fixture 서버를 백그라운드로 실행
start-fixture config="config.json": build
    python3 tools/server.py start --fixture --config {{ quote(config) }}

# 관리 중인 서버를 정상 종료
stop:
    python3 tools/server.py stop

# 빌드 후 기존 서버를 종료하고 live 서버 재시작
restart config="config.json": build
    python3 tools/server.py restart --config {{ quote(config) }}

# 빌드 후 기존 서버를 종료하고 fixture 서버 재시작
restart-fixture config="config.json": build
    python3 tools/server.py restart --fixture --config {{ quote(config) }}

status:
    python3 tools/server.py status

# 최근 서버 로그
logs:
    python3 tools/server.py logs

# 서버 로그 실시간 보기
logs-follow:
    python3 tools/server.py logs --follow

seed-demo: build
    ./bin/safehandoff --fixture --data-dir ./var/demo --seed-demo

test-live: build
    ./bin/safehandoff-eval --mode live

eval: build
    ./bin/safehandoff-eval --mode fixture

# 전용 demo 디렉터리만 삭제
demo-reset:
    #!/usr/bin/env python3
    from pathlib import Path
    import shutil
    target = Path("var/demo")
    if target.is_symlink() or target.resolve() != Path.cwd() / "var/demo":
        raise SystemExit("전용 var/demo 경로만 초기화할 수 있습니다")
    shutil.rmtree(target, ignore_errors=True)
