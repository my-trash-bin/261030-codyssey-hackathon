# 공개 toyrecord 계약 입력

PoC를 위한 의도적 결함 예시다. 실제 오픈소스 라이브러리의 버그나 수정 사항이 아니다. 이 디렉터리는 공개 대상 규약/입력만 제공한다. 앱과 고정 buggy/fixed 프로그램/runner 구현은 별도 작업이다.

입력/단계/코드/4회 실행 oracle은 [test-data.md](../../../../docs/qa/test-data.md)의 사례A를 따른다. `ascii.json`, `hangul.json`은 정상/다중바이트 계약 입력, `too-long.json`, `invalid.json.txt`는 경계/parse 오류 시험 입력이다.

새 합성 입력은 공개 계약에서 정한 길이와 seed로 만든다. 회사 원래 문자열/원래 길이를 자동 재사용하지 않는다. 기대 실행 결과는 아직 실제 실행 측정값이 아니다.
