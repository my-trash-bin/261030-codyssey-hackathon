# toyrecord · 공개 가상 라이브러리 계약

실제 오픈소스 결함을 주장하지 않는 PoC용 가상 라이브러리다. 버전은 0.1.0-demo다.

입력은 UTF-8 JSON 객체 {"value":"문자열"} 하나다. value 외 키·중복 키·후행 JSON·잘못된 UTF-8를 거부한다. value는 1–8 Unicode 코드포인트다. 유효 입력은 원래 문자열의 UTF-8 bytes 그대로 result.bin에 저장하는 것이 기대 동작이다.

단계는 parse→validate→encode→persist다. JSON/형식 문제는 E_INPUT_PARSE, 빈 값/길이 초과는 E_INPUT_LIMIT, 지정 인코딩 버퍼 실패는 E_ENCODE_SHORT_BUFFER다. 대상 JSON 출력과 exit code 계약·네 실행 oracle은 ../toyrecord/README.md와 docs/test-data.md에 정의한다.

이 계약의 공개와 실제 회사 자료의 공개는 별개다. 분석자는 원자료에서 관찰된 현상과 조사 중인 원인을 구분한다. 합성 입력 길이6은 이 공개 계약에서 고른 새 예시 조건이며 원래 회사 문자열 길이를 공개한 값이 아니다.
