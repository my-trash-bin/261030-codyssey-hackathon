// 파일 분석 입력 영역. 파일 선택·목록·승인 환경 확인 동의·문제 문구만 담당한다.
// 파일 선택만으로는 전송되지 않으며, 상태·전송 경계는 useAnalysis 훅이 맡는다.

import type { ChangeEvent, JSX } from 'react';
import type { AnalysisApi } from './hooks/useAnalysis.ts';
import { MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, formatBytes } from '../analysis-format.ts';

export function AnalysisPanel(props: { analysis: AnalysisApi }): JSX.Element {
  const { analysis } = props;
  const files = analysis.files;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const fileProblem = analysis.problem?.field === 'files';

  return (
    <details className="fold" id="analysis-panel" open>
      <summary>파일 분석 · 내부 근거</summary>
      <div className="fold__body">
        <div className="analysis">
          <div className="field">
            <label htmlFor="analysis-file-input">원자료 파일</label>
            <input
              type="file"
              id="analysis-file-input"
              name="analysis-file-input"
              multiple
              accept=".txt,.log,.md,.csv,.json"
              aria-invalid={fileProblem ? 'true' : undefined}
              aria-describedby="analysis-limit analysis-scope analysis-problem"
              onChange={(event: ChangeEvent<HTMLInputElement>): void => {
                analysis.setFiles(Array.from(event.currentTarget.files ?? []));
              }}
            />
            <p className="hint" id="analysis-limit">
              {`지원 형식은 txt·log·md·csv·json(UTF-8)입니다. 선택은 ${MAX_FILES}개 이하, 파일당 ${formatBytes(MAX_FILE_BYTES)}, 합계 ${formatBytes(MAX_TOTAL_BYTES)}까지 보냅니다. `}
              크기·형식 검사를 통과해도 근거 최대 100개(텍스트의 비어 있지 않은 줄, CSV 데이터 셀 등)를 넘으면 분석이 거부됩니다.
            </p>
            <p className="hint" id="analysis-scope">파일은 분석 요청 본문으로만 쓰이고 서버에 저장되지 않습니다. 아래 내부 메모 저장과는 별개 기능입니다. 파일 선택만으로는 전송되지 않습니다.</p>
          </div>

          <div className="analysis__files">
            <h3>선택한 파일</h3>
            <p className="hint">
              {files.length
                ? `${files.length}개 · 합계 ${formatBytes(total)} · 합계 한도 ${formatBytes(MAX_TOTAL_BYTES)}`
                : '아직 선택한 파일이 없습니다.'}
            </p>
            <ul className="plain-list">
              {files.map((file) => (
                <li key={`${file.name}:${file.size}:${file.lastModified}`}>{`${file.name} — ${formatBytes(file.size)}`}</li>
              ))}
            </ul>
          </div>

          <div className="option option--consent">
            <input
              type="checkbox"
              id="analysis-consent"
              checked={analysis.consent}
              aria-invalid={analysis.problem?.field === 'consent' ? 'true' : undefined}
              aria-describedby="analysis-consent-note analysis-problem"
              onChange={(event): void => { analysis.setConsent(event.currentTarget.checked); }}
            />
            <label htmlFor="analysis-consent">운영 설정에서 이 분석에 쓰이는 모델이 승인된 사내 또는 로컬 분석 환경임을 확인한 뒤 동의합니다.</label>
          </div>
          <p className="hint" id="analysis-consent-note">
            이 화면은 실제 모델 주소와 사내·로컬 여부를 확인할 수 없습니다. GET /api/core는 구현·연결·준비 상태만 알려줍니다.
            {' '}확인 없이 체크하면 승인되지 않은 환경으로 자료가 전송될 수 있습니다. 파일·목적·수신처를 바꾸면 동의가 해제됩니다.
          </p>

          <p className="status analysis__problem" id="analysis-problem">{analysis.problem ? analysis.problem.message : ''}</p>
        </div>
      </div>
    </details>
  );
}
