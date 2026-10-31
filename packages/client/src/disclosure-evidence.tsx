// 공개 결정 후보의 인용 근거·자료 충돌 표시.
// 원문 발췌는 서버가 준 raw_bytes를 화면에서 디코딩해 보여주며, 화면이 계산한 값을 만들지 않는다.
// 클래스 이름과 문구는 이전 DOM 구현(disclosure-evidence.ts)과 같다.

import type { JSX } from 'react';

import type { Candidate, Evidence, Snapshot, Source } from './disclosure-state.ts';
import { collapse, shortId } from './disclosure-format.ts';

// 같은 task 응답을 여러 번 그려도 base64 디코딩을 반복하지 않도록 원자료 객체 단위로 캐시한다.
const sourceBytes = new WeakMap<Source, Uint8Array | null>();

function findSource(snapshot: Snapshot, sourceVersionId: string): Source | undefined {
  return snapshot.sources.find(source =>
    source.id === sourceVersionId || source.source_id === sourceVersionId);
}

function decodeSource(source: Source): Uint8Array | null {
  if (sourceBytes.has(source)) return sourceBytes.get(source) ?? null;
  let decoded: Uint8Array | null = null;
  const raw = source.raw_bytes;
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const binary = atob(raw);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      decoded = bytes;
    } catch {
      decoded = null;
    }
  }
  sourceBytes.set(source, decoded);
  return decoded;
}

function excerptText(source: Source | undefined, start: number, end: number): string {
  if (!source) return '원자료를 task 응답에서 찾지 못해 발췌를 표시할 수 없습니다.';
  const bytes = decodeSource(source);
  if (!bytes) return '원자료 원문 바이트(raw_bytes)가 응답에 없어 발췌를 표시할 수 없습니다.';
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > bytes.length) {
    return `발췌 범위(${start}–${end})가 원문 바이트 길이(${bytes.length})를 벗어나 표시하지 않습니다.`;
  }
  const slice = bytes.subarray(start, end);
  let text = new TextDecoder('utf-8', { fatal: false }).decode(slice);
  const partial = start > 0 || end < bytes.length;
  if (partial) text = text.replace(/^\uFFFD+/, '').replace(/\uFFFD+$/, '');
  const collapsed = collapse(text);
  if (!collapsed) return '발췌 구간이 비어 있습니다(공백 또는 문자 경계 아님).';
  const bounded = collapsed.length > 160 ? `${collapsed.slice(0, 160)}…` : collapsed;
  return `"${bounded}"${partial ? ' (구간 일부)' : ''}`;
}

function EvidenceItem(props: { snapshot: Snapshot; evidenceId: string }): JSX.Element {
  const { snapshot, evidenceId } = props;
  const evidence: Evidence | undefined = snapshot.evidence.find(entry => entry.id === evidenceId);
  if (!evidence) {
    return <li className="evidence"><p className="hint">{`근거 ${evidenceId}: task 응답에 상세가 없습니다.`}</p></li>;
  }
  const source = findSource(snapshot, evidence.source_version_id);
  const locator = evidence.locator;
  const meta: string[] = [
    source ? source.display_name : `원자료 ${evidence.source_version_id}`,
    source ? `형식 ${source.format}` : '형식 미확인',
    `바이트 ${evidence.start}–${evidence.end}`,
    `locator ${locator.kind}`,
  ];
  if (locator.kind === 'csv_cell') {
    if (locator.row !== undefined) meta.push(`행 ${locator.row}`);
    if (locator.column) meta.push(`열 ${locator.column}`);
  }
  if (locator.kind === 'json_pointer' && locator.pointer) meta.push(locator.pointer);
  return (
    <li className="evidence">
      <p className="evidence__meta">{meta.join(' · ')}</p>
      {locator.kind === 'byte_range'
        ? <p className="evidence__excerpt">{excerptText(source, evidence.start, evidence.end)}</p>
        : <p className="hint">바이트 구간 근거가 아니어서 원문 발췌를 표시하지 않습니다.</p>}
    </li>
  );
}

export function EvidenceList(props: { snapshot: Snapshot; evidenceIds: string[] | null; heading: string }): JSX.Element {
  const { snapshot, evidenceIds, heading } = props;
  return (
    <div className="candidate__evidence">
      <h3>{heading}</h3>
      {!evidenceIds || evidenceIds.length === 0
        ? <p className="hint">이 후보에 연결된 근거가 없습니다.</p>
        : (
          <ul className="evidence-list">
            {evidenceIds.map((evidenceId, index) => (
              <EvidenceItem key={`${evidenceId}:${index}`} snapshot={snapshot} evidenceId={evidenceId} />
            ))}
          </ul>
        )}
    </div>
  );
}

function conflictPeers(snapshot: Snapshot, candidate: Candidate): Candidate[] {
  const group = candidate.conflict_group;
  const reason = candidate.conflict_reason;
  return snapshot.candidates.filter(other => {
    if (other.id === candidate.id) return false;
    if (group && other.conflict_group === group) return true;
    return !group && Boolean(reason) && other.conflict_reason === reason;
  });
}

// 충돌 블록을 그릴지 판단하는 조건. 후보 카드가 근거 목록 대신 충돌 블록을 고르는 데도 쓴다.
export function hasConflict(snapshot: Snapshot, candidate: Candidate): boolean {
  return Boolean(candidate.conflict_group)
    || Boolean(candidate.conflict_reason)
    || conflictPeers(snapshot, candidate).length > 0;
}

export function ConflictBlock(props: { snapshot: Snapshot; candidate: Candidate }): JSX.Element | null {
  const { snapshot, candidate } = props;
  const group = candidate.conflict_group;
  const reason = candidate.conflict_reason;
  const peers = conflictPeers(snapshot, candidate);
  if (!hasConflict(snapshot, candidate)) return null;
  const sides: { candidate: Candidate; current: boolean }[] = [
    { candidate, current: true },
    ...peers.map(peer => ({ candidate: peer, current: false })),
  ];
  return (
    <div className="candidate__conflict">
      <h3>자료 충돌</h3>
      <p className="status">
        {group
          ? `같은 충돌 묶음 ${group}에 속한 후보가 서로 다른 근거를 인용합니다.`
          : '이 후보에는 충돌 사유가 표시되어 있습니다.'}
      </p>
      {reason ? <p className="hint">{`충돌 사유: ${reason}`}</p> : null}
      {sides.map(side => (
        <div key={side.candidate.id} className="conflict__side">
          <p className="conflict__side-label">
            {side.current
              ? '이 후보의 근거'
              : `충돌 후보 ${shortId(side.candidate.id)}의 근거`}
          </p>
          <p className="conflict__statement">{side.candidate.statement}</p>
          {!side.current && side.candidate.conflict_reason && side.candidate.conflict_reason !== reason
            ? <p className="hint">{`이 후보의 충돌 사유: ${side.candidate.conflict_reason}`}</p>
            : null}
          <EvidenceList snapshot={snapshot} evidenceIds={side.candidate.evidence_ids} heading="인용 근거" />
        </div>
      ))}
      {peers.length === 0
        ? <p className="hint">같은 충돌 묶음의 다른 후보가 task 응답에 없습니다.</p>
        : null}
      <p className="hint">
        어느 근거가 맞는지는 이 화면에서 확인할 수 없습니다. 양쪽 후보의 문장과 근거 출처·바이트 구간을 비교해 남길 내용을 직접 판단하세요.
      </p>
    </div>
  );
}
