# 가상 toyrecord 재현

의도적으로 만든 PoC 결함이며 실제 제품이 아닙니다. Go 1.24 이상 준비 후 다음을 실행하세요.

    cd repro
    GOTOOLCHAIN=local GOPROXY=off go run ./cmd/repro --inputs ./inputs

고객 입력을 사용하지 않고 공개 계약으로 새 입력을 생성했습니다. 실행 결과의 not_run은 성공을 뜻하지 않습니다.
