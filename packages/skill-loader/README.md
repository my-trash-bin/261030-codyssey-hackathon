# F07 파일시스템 팩 로더

`@safehandoff/skill-loader`는 manifest·팩 경로·파일 바이트를 검증한다. core-interface만 의존하며 모델·네트워크·도구 실행·공개 승인·팩 활성화를 수행하지 않는다. Linux와 Node 24에서 동작하며 안전한 경로 해석을 지원하지 않는 환경에서는 오류를 반환한다.

## 사용

설치자가 실제 등록한 ID 목록을 전달한다. 아래 값은 저장소의 가상 팩 시험용이며 실제 운영 등록을 뜻하지 않는다.

```ts
import { FsSkillPackLoader } from '@safehandoff/skill-loader';

const loader = new FsSkillPackLoader({
  productIds: ['vendorstore-lab'],
  purposeIds: ['vendor_support'],
  toolIds: ['derive_series_v1', 'render_timeline_v1', 'make_config_example_v1', 'check_doc_ip_context_v1'],
  templateIds: ['vendor_support.v1'],
});
const root = 'fixtures/skills/vendorstore-support';
const pack = await loader.load(root);
const pin = {
  id: pack.manifest.id,
  version: pack.manifest.version,
  manifest_sha256: pack.manifest_sha256,
  pack_sha256: pack.pack_sha256,
};
// 설치자가 검토 후 pin을 저장하고, 사용 직전 같은 저장 pin으로 검증한다.
const verified = await loader.verify(root, pin);
```

`load`는 새 설치 후보의 지문을 계산한다. 기존 등록을 검증할 때 새 load 결과로 pin을 자동 교체하면 안 된다. `verify`에는 설치 시 보존한 pin을 제공해야 한다. `ready`는 로더 구현의 사용 가능 표시이며 특정 경로나 팩의 유효성을 미리 증명하지 않는다.

루트에 manifest.json과 SKILL.md가 필요하다. manifest의 필드는 skill_manifest.v1 계약과 정확히 일치해야 한다. ID는 128자 이하의 소문자·숫자·점·밑줄·하이픈 식별자이며 product/purpose는 한 개 이상이어야 한다. version은 128자 이하의 영숫자로 시작하는 영숫자·점·더하기·밑줄·하이픈 문자열이다. version의 의미나 정렬 순서는 추론하지 않는다. role_documents는 역할 이름별 파일 참조이고, 같은 역할의 중복은 거부하지만 여러 역할이 같은 파일을 참조할 수 있다.

## 경로와 파일 취급

순수 `validatePackLayout`은 절대경로·URL·Windows drive 경로·상위경로·제어문자·대체 스트림·device 이름을 거부한다. 구분자·dot 성분·Unicode NFC·대소문자 별칭의 중복과 파일/디렉터리 이름 충돌도 검사한다. 실제 파일명과 manifest 참조는 slash 기반의 NFC 정규 상대경로여야 한다. 빈 목록은 순수 검증에서 허용한다.

로더는 root부터 경로 성분을 O_NOFOLLOW로 열고 열린 디렉터리 기준으로 하위를 탐색한다. 팩이 제공하는 symlink는 따라가지 않는다. /proc/self/fd의 커널 descriptor 참조만 내부 anchor로 사용한다. 일반 파일 외 FIFO·socket·device·hardlink는 거부한다. 파일을 연 뒤 inode와 크기·변경 시간을 재검사하고 읽기 전후 변경이 감지되면 실패한다. 호스트 관리자나 설치자가 만든 mount를 적대적으로 방어하는 기능은 아니다.

전체 일반 파일을 exact bytes로 읽는다. scripts·assets·숨김 파일도 지문 대상이며 scripts를 실행하거나 import하지 않는다. 팩 루트에는 등록 대상으로 검토한 파일만 두어야 한다. 로딩 중 동시에 팩을 수정하지 않아야 하며, 반환한 바이트는 읽은 시점의 snapshot이다. 이후 파일 변경은 다시 verify해야 확인할 수 있다.

## 지문

- 각 파일 sha256: 파일 바이트의 SHA-256 소문자 hex.
- manifest_sha256: manifest.json 원본 바이트의 SHA-256. 공백 변경도 다른 지문이다.
- files: manifest.json을 포함한 모든 일반 파일을 relative_path의 문자열 순서로 정렬한다. bytes는 원본 바이트의 base64다.
- pack_sha256: 정렬한 files에서 만든 `[[relative_path, sha256], ...]`의 JSON.stringify UTF-8 바이트를 SHA-256으로 계산한다. 절대경로·파일 시간은 넣지 않는다. manifest 변경·파일 추가/삭제·scripts 변경도 판본을 바꾼다.

## 상한과 오류

| 항목 | 기본 상한 |
| --- | --- |
| 일반 파일 수 | 128 |
| 디렉터리와 파일을 합친 항목 수 | 256 |
| 하위 디렉터리 깊이 | 16 |
| 개별 파일 | 1 MiB |
| 팩 전체 바이트 | 8 MiB |
| manifest.json | 64 KiB |
| 상대경로 | 1024자 |

기존 PACK_PATH_ABSOLUTE/ESCAPES_ROOT/SYMLINK/DUPLICATE, PACK_MANIFEST_INVALID, PACK_REFERENCE_MISSING 오류에 PACK_DIGEST_MISMATCH와 PACK_LIMIT_EXCEEDED를 추가했다. 오류 메시지에는 OS 경로나 파일 바이트를 복사하지 않는다. 권한 오류·지원하지 않는 환경은 PACK_MANIFEST_INVALID다.

## 현재 연결 범위

실제 가상 팩과 임시 파일시스템의 정상·경계·오류 테스트를 포함한다. core-interface의 roleDocuments/skillSetHash는 아직 선언만 있으며 이 로더가 작성기에 내부 문서를 전달하지 않는다. pack:register CLI, catalog 저장, 앱 자동 로딩, task revision 연결은 다음 단계다. 환경 변수와 HTTP API는 추가하지 않았다.

팩 파일시스템 시험은 Linux에서 실행한다. macOS 등에서는 이 10개 시험을 skip으로 표시하고,
지원하지 않는 플랫폼의 로딩 요청이 거부되는 별도 계약 시험을 실행한다.
skip은 Linux 경로·digest·경합 안전성 검증을 통과했다는 의미가 아니다.
