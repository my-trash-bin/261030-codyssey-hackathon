GO := mise exec -- go
.PHONY: setup build fixtures prepare-runners test test-go test-docs lint test-extensions run-fixture run seed-demo test-live eval demo-reset
setup:
	mise install
	$(GO) mod download
	$(GO) mod verify
	mise exec -- npm ci --ignore-scripts
build:
	@mkdir -p bin
	$(GO) build -buildvcs=false -trimpath -o bin/safehandoff ./cmd/safehandoff
	$(GO) build -buildvcs=false -trimpath -o bin/safehandoff-fixtures ./cmd/safehandoff-fixtures
	$(GO) build -buildvcs=false -trimpath -o bin/safehandoff-eval ./cmd/safehandoff-eval
	$(GO) build -buildvcs=false -trimpath -o bin/safehandoff-checker ./cmd/safehandoff-checker
fixtures: build
	./bin/safehandoff-fixtures --scenario b2b-timeout --seed 41 --variation baseline --out var/demo-inputs
prepare-runners: build
	mise exec -- ./bin/safehandoff-eval --mode prepare
test:
	mise exec -- npm test
test-go:
	$(GO) test ./...
	cd fixtures/public/targets/toyrecord && mise exec -- go test ./...
test-docs:
	python3 tools/validate_docs.py
lint:
	mise exec -- npm run lint
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
