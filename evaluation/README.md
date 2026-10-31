# 이전 평가 자료

기존 실행의 입력/기대 조건/결과를 보존한다. 현재 TypeScript 기본 구조의 검증 결과가 아니다. 현재 테스트는 각 packages의 Node 테스트로 실행한다.

과거 Go 재현 소스/결과 JSON/문서/해시는 기록 보존을 위해 유지한다. 현재 workspace 실행 대상이 아니며 재현 팩이 현재 완전하다는 뜻은 아니다.

`effect-compare/`에는 10건 비교 실험의 가상 원자료/정답지(`cases.json`)와 사람 참여 시간 측정 화면(`measure.html`)을 둔다. 결정적 3자 파이프라인 비교는 `tools/value-comparison.mjs`, 참여자 시간 측정 집계는 `tools/effect-measure.mjs`로 실행한다.
