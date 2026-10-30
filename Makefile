GO := mise exec -- go
.PHONY: setup build fixtures prepare-runners test test-extensions run-fixture run seed-demo test-live eval demo-reset
setup:
	mise install
	$(GO) mod download
	$(GO) mod verify
build:
	@mkdir -p bin
	$(GO) build -trimpath -o bin/safehandoff ./cmd/safehandoff
	$(GO) build -trimpath -o bin/safehandoff-fixtures ./cmd/safehandoff-fixtures
	$(GO) build -trimpath -o bin/safehandoff-eval ./cmd/safehandoff-eval
	$(GO) build -trimpath -o bin/safehandoff-checker ./cmd/safehandoff-checker
fixtures: build
	./bin/safehandoff-fixtures --scenario b2b-timeout --seed 41 --variation baseline --out var/demo-inputs
prepare-runners: build
	mise exec -- ./bin/safehandoff-eval --mode prepare
test:
	$(GO) test ./...
	cd fixtures/public/targets/toyrecord && mise exec -- go test ./...
test-extensions: build
	mise exec -- ./bin/safehandoff-eval --mode extensions
run-fixture: build
	./bin/safehandoff --fixture --data-dir ./var/fixture
run: build
	./bin/safehandoff
seed-demo: build
	./bin/safehandoff --fixture --data-dir ./var/demo --seed-demo
test-live: build
	./bin/safehandoff-eval --mode live
eval: build
	./bin/safehandoff-eval --mode fixture
demo-reset:
	@case "$$(realpath -m var/demo)" in "$$(pwd)/var/demo") rm -rf -- var/demo ;; *) exit 1 ;; esac
