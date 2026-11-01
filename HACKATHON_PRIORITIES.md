# 해커톤 제출 전 우선순위 정리

기준일: 2026-11-01. 제출 직전 남은 항목을 "당장 해결"과 "미뤄도 됨"으로 분류한 작업 메모다.
제품 범위/완료 상태의 정본은 [docs/product/plan.md](docs/product/plan.md)/[docs/product/submission-status.md](docs/product/submission-status.md)이며,
이 문서는 그 위에 얹는 제출 체크리스트일 뿐 별도 정본을 만들지 않는다.

## 당장 해결해야 할 것

1. **데모 영상 새로 녹화 (최대 작업)** - `.local/demo-video/`에 있는 영상은 103초짜리 옛 Go 프로토타입
   fixture 녹화이고 git에도 커밋돼 있지 않다(`.gitignore`). `docs/presentation/video/README.md`가
   "이 영상을 쓰면 '이전 fixture 시제품 녹화'라고 소개하라"고 명시할 정도로 현재 실제 client UI와 다르다.
   사전 녹화 영상이 제출 요건이므로 실제 React client(`:5173`) 기준으로 다시 찍어야 한다. 라이브 시연은
   별도이며 이 녹화 각본을 재사용하지 않는다.
2. **발표 PDF 재생성 여부** - `SafeHandoff_발표자료_통합.pdf`(10/31 09:26 생성)는 `팀원_소개`/
   `서비스_아키텍처` 슬라이드(11/1 01:06 수정)보다 오래돼 최신 내용을 반영하지 못한다.
   `just build-presentation`으로 재생성 가능하나, PDF 자체를 추후 `.gitignore` 처리할 계획이라
   이번 라운드에서는 보류한다 (재생성 필요 여부는 `.gitignore` 전환 시점에 다시 판단).
3. **submission-status.md 수치 오류/중복 재실행 기록 - 해결됨.** 손으로 옮겨 적은 `pnpm build`/`pnpm test`/
   `validate_docs.py` 재실행 수치 표와 AC 카운트 표가 재배치 사이에 실제로 어긋났던 것을 확인하고
   (`passed 46/partial 13` vs 실제 `45/14`), 재현 가능한 스크립트 결과를 손으로 다시 적어두는 절(section 1
   전체)을 삭제하고 `validation-report.json`/`plan.md`/`acceptance-map.csv`를 직접 가리키는 포인터로
   바꿨다. 심사자 공개 제한/체크리스트처럼 재실행으로 대체 불가능한 부분만 남겼다
   ([docs/product/submission-status.md](docs/product/submission-status.md)).
4. **Docker 합성 재현 데모 여부 결정** - `.env`의 `SAFEHANDOFF_REPRO_REGISTRY`가 주석 처리돼 있어
   지금 상태로 재현 기능을 시연하면 `CORE_NOT_IMPLEMENTED`로 막힌다. 발표/영상에서 Docker 재현을
   보여줄 계획이면 그 값을 채워야 한다.
5. **발표 시 가설/포장 구분 멘트 준비** - [docs/presentation/ISSUES.md](docs/presentation/ISSUES.md)의
   PRES-07(보안 "Zero" 보장류 문구는 과장), PRES-08(B2B 포장은 의도된 발표용 과장),
   PRES-09(시장 규모는 검증 안 된 가설)를 실제 발표 대사에 반영할지 리허설 때 확인한다. 문서화는
   끝났지만 말로 전달하는 것은 아직 남은 사람의 일이다.

## 미뤄도 되는 것 (이미 해커톤 이후 백로그로 공식 분류됨)

- **`product_backlog` 65개 AC** (전체 `/api/v1/tasks` REST, UI-02~10 다중 화면, `rules` CRUD API,
  ZIP 아카이브 다운로드 등) - [plan.md](docs/product/plan.md)의 `M1~M5` 로드맵에 이미 분리됨. 코어
  계약/DB 스키마만 준비된 상태로 두기로 결정됨.
- **[user-flow.md](docs/design/user-flow.md)의 `UF-02~06` TODO 항목들** - 문서 자체가 "구현 변경이나
  완료 약속이 아니다"라고 명시한 리뷰용 메모.
- **[deferred-features.md](docs/product/deferred-features.md)의 `DF-005`(DocAST 수동 편집) /
  `DF-006`(재현 목표 UI) / `DF-007`(규칙 관리 화면)** - 이미 "후속 검토" 상태로 공식 분류, 재도입
  조건까지 해당 문서에 적혀 있음.
- **[01-task-intake.md](docs/features/01-task-intake.md) 입력 개편 설계** - "문서만 반영했고
  미구현"이라고 [plan.md](docs/product/plan.md)가 명시. 지금 구현에 들어갈 계획 아님.
- **PRES-11의 design-pick 작성 경위 확인** - 신경 쓸 부분이지만 제출을 막는 블로커는 아님.
