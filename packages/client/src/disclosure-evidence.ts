import type { Candidate, Evidence, Snapshot, Source } from './disclosure-state.js';
import { make, line, collapse, shortId } from './disclosure-dom.ts';
export function createEvidenceRenderer() {
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

  function buildEvidenceItem(snapshot: Snapshot, evidenceId: string): HTMLElement {
    const item = make('li', 'evidence');
    const evidence: Evidence | undefined = snapshot.evidence.find(entry => entry.id === evidenceId);
    if (!evidence) {
      item.append(line('p', `근거 ${evidenceId}: task 응답에 상세가 없습니다.`, 'hint'));
      return item;
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
    item.append(line('p', meta.join(' · '), 'evidence__meta'));
    if (locator.kind === 'byte_range') {
      item.append(line('p', excerptText(source, evidence.start, evidence.end), 'evidence__excerpt'));
    } else {
      item.append(line('p', '바이트 구간 근거가 아니어서 원문 발췌를 표시하지 않습니다.', 'hint'));
    }
    return item;
  }

  function buildEvidence(snapshot: Snapshot, evidenceIds: string[] | null, heading: string): HTMLElement {
    const wrap = make('div', 'candidate__evidence');
    wrap.append(line('h3', heading));
    if (!evidenceIds || evidenceIds.length === 0) {
      wrap.append(line('p', '이 후보에 연결된 근거가 없습니다.', 'hint'));
      return wrap;
    }
    const list = make('ul', 'evidence-list');
    for (const evidenceId of evidenceIds) list.append(buildEvidenceItem(snapshot, evidenceId));
    wrap.append(list);
    return wrap;
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

  function buildConflict(snapshot: Snapshot, candidate: Candidate): HTMLElement | null {
    const group = candidate.conflict_group;
    const reason = candidate.conflict_reason;
    const peers = conflictPeers(snapshot, candidate);
    if (!group && !reason && peers.length === 0) return null;
    const wrap = make('div', 'candidate__conflict');
    wrap.append(line('h3', '자료 충돌'));
    wrap.append(line(
      'p',
      group
        ? `같은 충돌 묶음 ${group}에 속한 후보가 서로 다른 근거를 인용합니다.`
        : '이 후보에는 충돌 사유가 표시되어 있습니다.',
      'status',
    ));
    if (reason) wrap.append(line('p', `충돌 사유: ${reason}`, 'hint'));

    const sides: { candidate: Candidate; current: boolean }[] = [
      { candidate, current: true },
      ...peers.map(peer => ({ candidate: peer, current: false })),
    ];
    for (const side of sides) {
      const block = make('div', 'conflict__side');
      const label = side.current
        ? '이 후보의 근거'
        : `충돌 후보 ${shortId(side.candidate.id)}의 근거`;
      block.append(line('p', label, 'conflict__side-label'));
      block.append(line('p', side.candidate.statement, 'conflict__statement'));
      if (!side.current && side.candidate.conflict_reason && side.candidate.conflict_reason !== reason) {
        block.append(line('p', `이 후보의 충돌 사유: ${side.candidate.conflict_reason}`, 'hint'));
      }
      block.append(buildEvidence(snapshot, side.candidate.evidence_ids, '인용 근거'));
      wrap.append(block);
    }
    if (peers.length === 0) {
      wrap.append(line('p', '같은 충돌 묶음의 다른 후보가 task 응답에 없습니다.', 'hint'));
    }
    wrap.append(line(
      'p',
      '어느 근거가 맞는지는 이 화면에서 확인할 수 없습니다. 양쪽 후보의 문장과 근거 출처·바이트 구간을 비교해 남길 내용을 직접 판단하세요.',
      'hint',
    ));
    return wrap;
  }

  return { buildEvidence, buildConflict };
}
