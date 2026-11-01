// 재사용 규칙 화면. 최신 판본 목록·scope·표현·만료·철회를 보여 주고,
// 방향/지수 새 판본 작성, 철회, 선택한 현재 작업에 대한 명시 적용을 연결한다.
// 규칙 저장은 현재 작업의 유효한 allow 결정에서만 열리며, intake가 없는 작업은 이유를 표시하고 막는다.
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import type { Snapshot } from '../disclosure-state.ts';
import { scopeSummary } from '../disclosure-format.ts';
import type { ScopeNames } from '../disclosure-format.ts';
import {
  RULE_TRANSFORM_OPTIONS,
  isRuleTransformId,
  isSupportedRuleRepresentation,
  ruleIsActive,
  ruleRepresentationLabel,
} from '../rules-client.ts';
import type { RuleRecord, RuleRef } from '../rules-client.ts';
import { formatWorkflowTimestamp } from '../workflow-client.ts';
import { useRules } from './hooks/useRules.ts';
import type { RuleVersionDraft } from './hooks/useRules.ts';

export interface RulesSectionProps {
  csrfToken: string | null;
  snapshot: Snapshot | null;
  onTaskChanged: (id: string) => Promise<void> | void;
  names?: ScopeNames | null;
}

let ruleCounter = 0;

/** datetime-local 입력이 해석하는 지역 시각 형식으로 바꾼다. 이미 지난 만료는 새 판본 기본값으로 쓰지 않는다. */
function expiryInput(value: string | null): string {
  if (value === null || value === '') return '';
  const at = new Date(value);
  if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) return '';
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function RuleItem(props: {
  rule: RuleRecord;
  names: ScopeNames | null;
  busy: boolean;
  onVersion: (ruleId: string, expectedVersion: number, draft: RuleVersionDraft) => void;
  onRevoke: (ruleId: string, expectedVersion: number) => void;
}): JSX.Element {
  const { rule, names, busy, onVersion, onRevoke } = props;
  const [uid] = useState(() => {
    ruleCounter += 1;
    return `rule-${ruleCounter}`;
  });
  const supported = isSupportedRuleRepresentation(rule.representation);
  const [transformId, setTransformId] = useState<string>(() =>
    rule.representation.transform_id === 'series_index_base100.v1' ? rule.representation.transform_id : 'series_direction_only.v1');
  const [decimalText, setDecimalText] = useState<string>(() => {
    const places = rule.representation.parameters?.['decimal_places'];
    return typeof places === 'number' ? String(places) : '0';
  });
  const [expiresText, setExpiresText] = useState(() => expiryInput(rule.expiresAt));
  const [formError, setFormError] = useState('');
  const [revoking, setRevoking] = useState(false);

  // 새 판본이 만들어지면 화면 입력을 서버의 최신 값으로 맞춘다.
  useEffect(() => {
    setTransformId(rule.representation.transform_id === 'series_index_base100.v1' ? rule.representation.transform_id : 'series_direction_only.v1');
    const places = rule.representation.parameters?.['decimal_places'];
    setDecimalText(typeof places === 'number' ? String(places) : '0');
    setExpiresText(expiryInput(rule.expiresAt));
  }, [rule.version, rule.expiresAt]);

  const active = ruleIsActive(rule);
  const state = rule.revoked ? '철회됨' : active ? '활성' : '만료됨';
  const expires = rule.expiresAt === null ? '만료 없음' : formatWorkflowTimestamp(rule.expiresAt);

  function submitVersion(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!isRuleTransformId(transformId)) {
      setFormError('지원하는 변환을 선택하세요. 서버는 방향과 지수 변환만 받습니다.');
      return;
    }
    const decimalPlaces = Number(decimalText);
    if (transformId === 'series_index_base100.v1' && (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 4)) {
      setFormError('지수 소수 자리는 0~4 사이 정수여야 합니다.');
      return;
    }
    setFormError('');
    onVersion(rule.id, rule.version, {
      transformId,
      decimalPlaces,
      expiresAt: expiresText === '' ? null : expiresText,
    });
  }

  return (
    <li>
      <p className="meta">{`규칙 ${rule.id.slice(0, 8)} · 판본 ${rule.version} · ${state}`}</p>
      <p className="hint">{`범위: ${scopeSummary(rule.scope, names)}`}</p>
      <p className="hint">{`문서 목표 ${rule.goalVariant === null ? '기본' : rule.goalVariant} · 만료 ${expires}`}</p>
      <p className="hint">{`대상 열 ${rule.selector}`}</p>
      <p className="hint">
        {`표현 ${ruleRepresentationLabel(rule.representation)}`
          + (supported ? '' : ' · 이 표현은 새 작업에 자동 적용되지 않고 새 판본으로 바꿔야 합니다.')}
      </p>

      <details className="fold">
        <summary>새 판본 작성</summary>
        <div className="fold__body">
          {rule.revoked
            ? <p className="hint">철회된 규칙은 새 판본을 만들 수 없습니다. 새 규칙은 현재 작업의 허용 결정에서 다시 저장하세요.</p>
            : (
              <form className="form" noValidate aria-busy={busy ? 'true' : undefined} onSubmit={submitVersion}>
            <div className="field">
              <label htmlFor={`${uid}-transform`}>변환</label>
              <select
                id={`${uid}-transform`}
                value={transformId}
                disabled={busy}
                onChange={event => {
                  setTransformId(event.currentTarget.value);
                  setFormError('');
                }}
              >
                {RULE_TRANSFORM_OPTIONS.map(option => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </div>
            {transformId === 'series_index_base100.v1'
              ? (
                <div className="field">
                  <label htmlFor={`${uid}-decimal`}>지수 소수 자리</label>
                  <input
                    id={`${uid}-decimal`}
                    type="number"
                    min={0}
                    max={4}
                    step={1}
                    inputMode="numeric"
                    value={decimalText}
                    disabled={busy}
                    onChange={event => {
                      setDecimalText(event.currentTarget.value);
                      setFormError('');
                    }}
                  />
                  <p className="hint">0~4 사이 정수이며 첫 값을 100으로 둡니다. 서버가 새 원자료로 다시 계산합니다.</p>
                </div>
              )
              : (
                <p className="hint">방향 변환은 증가·감소·동일만 계산하며 추가 인자가 없습니다.</p>
              )}
            <div className="field">
              <label htmlFor={`${uid}-expires`}>만료 시각(선택)</label>
              <input
                id={`${uid}-expires`}
                type="datetime-local"
                value={expiresText}
                disabled={busy}
                onChange={event => {
                  setExpiresText(event.currentTarget.value);
                  setFormError('');
                }}
              />
              <p className="hint">비우면 만료 없이 저장합니다. 이미 지난 만료는 입력에 채우지 않습니다.</p>
            </div>
            {formError === '' ? null : <p className="hint" role="status" aria-live="polite">{formError}</p>}
            <div className="actions">
              <button className="button button--solid" type="submit" disabled={busy}>
                새 판본 저장
              </button>
            </div>
              </form>
            )}
        </div>
      </details>

      {revoking
        ? (
          <div className="action">
            <p className="hint">규칙의 전 판본을 철회하면 이 규칙을 쓰는 작업의 결정도 철회되고 작업 판본이 올라갑니다. 되돌릴 수 없습니다.</p>
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => {
                setRevoking(false);
                onRevoke(rule.id, rule.version);
              }}
            >
              철회 확인
            </button>
            <button className="button" type="button" disabled={busy} onClick={() => { setRevoking(false); }}>
              취소
            </button>
          </div>
        )
        : (
          <div className="actions">
            <button
              className="button"
              type="button"
              disabled={busy || rule.revoked}
              onClick={() => { setRevoking(true); }}
            >
              {rule.revoked ? '이미 철회됨' : '규칙 철회'}
            </button>
          </div>
        )}
    </li>
  );
}

export function RulesSection(props: RulesSectionProps): JSX.Element {
  const rules = useRules(props);
  const [uid] = useState(() => {
    ruleCounter += 1;
    return `rules-section-${ruleCounter}`;
  });
  const [decisionId, setDecisionId] = useState('');
  const [selectedRuleIds, setSelectedRuleIds] = useState<ReadonlySet<string>>(() => new Set());
  const busy = rules.busyKey !== null;

  const eligible = useMemo(() => {
    if (!props.snapshot) return [];
    const now = Date.now();
    return Object.entries(props.snapshot.decisions)
      .filter(([, decision]) =>
        decision.disposition === 'allow' && !decision.revoked &&
        (decision.expires_at === null || Date.parse(decision.expires_at) > now) &&
        isSupportedRuleRepresentation(decision.representation))
      .map(([candidateId, decision]) => ({ candidateId, decision }));
  }, [props.snapshot]);

  // 목록이 바뀌면 더 이상 활성·존재하지 않는 선택만 걷어낸다.
  useEffect(() => {
    setSelectedRuleIds(previous => {
      const next = new Set([...previous].filter(id => rules.rules.some(rule => rule.id === id && ruleIsActive(rule))));
      return next.size === previous.size ? previous : next;
    });
  }, [rules.rules]);

  useEffect(() => {
    setDecisionId(previous => (eligible.some(entry => entry.decision.id === previous) ? previous : ''));
  }, [eligible]);

  useEffect(() => {
    setDecisionId('');
    setSelectedRuleIds(new Set());
  }, [props.snapshot?.id]);

  const refs: RuleRef[] = rules.rules
    .filter(rule => selectedRuleIds.has(rule.id) && ruleIsActive(rule))
    .map(rule => ({ id: rule.id, version: rule.version }));

  const intakeKnown = rules.taskDetail !== null;
  const hasIntake = rules.taskDetail?.intake !== null && rules.taskDetail?.intake !== undefined;
  const saveReady = props.snapshot !== null && hasIntake && decisionId !== '' && !busy;
  const applyReady = props.snapshot !== null && hasIntake && refs.length > 0 && !busy;
  const applyHintId = `${uid}-apply-hint`;
  const saveHintId = `${uid}-save-hint`;

  return (
    <section className="block" id="reusable-rules" aria-labelledby="reusable-rules-heading">
      <p className="hint" id="reusable-rules-heading">
        규칙은 값이나 과거 문장을 저장하지 않고, 숫자 CSV 열과 방향·지수 변환만 저장합니다. 같은 프로젝트·목적·수신처·문서 목표의 새 원자료에서만 다시 계산합니다.
      </p>

      <div className="actions">
        <button
          className="button button--small"
          type="button"
          disabled={rules.rulesBusy || props.csrfToken === null}
          aria-busy={rules.rulesBusy ? 'true' : undefined}
          onClick={() => { rules.refresh(); }}
        >
          새로 고침
        </button>
      </div>
      <p className="status" role="status" aria-live="polite" data-role="rules-status">{rules.rulesStatus}</p>

      {rules.rules.length === 0
        ? null
        : (
          <ul className="plain-list">
            {rules.rules.map(rule => (
              <RuleItem
                key={rule.id}
                rule={rule}
                names={props.names ?? null}
                busy={busy}
                onVersion={rules.createVersion}
                onRevoke={rules.revoke}
              />
            ))}
          </ul>
        )}

      <p className="status" role="status" aria-live="polite" data-role="rules-message">{rules.message}</p>

      <section className="batch" aria-labelledby="rules-save-heading">
        <h3 id="rules-save-heading">현재 작업의 결정에서 규칙 저장</h3>
        <p className="status" role="status" aria-live="polite" data-role="rules-task-status">{rules.taskStatus}</p>
        {props.snapshot === null
          ? (
            <p className="hint">작업을 고르면 그 작업의 허용 결정에서 규칙을 저장할 수 있습니다.</p>
          )
          : (
            <>
              <p className="hint">{scopeSummary(props.snapshot.scope, props.names)}</p>
              <p className="hint">방향·지수 변환으로 저장한 허용 결정만 보입니다. 숫자 CSV 한 열이 아니면 서버가 저장을 거부합니다.</p>
              {eligible.length === 0
                ? <p className="hint">저장할 수 있는 결정이 없습니다. 추이(B)로 허용한 결정이 있어야 합니다.</p>
                : (
                  <fieldset className="candidate__disposition">
                    <legend>저장할 결정</legend>
                    {eligible.map((entry, index) => {
                      // 후보 ID는 임의 문자열이라 HTML id에 그대로 쓰지 않고 목록 위치 토큰으로 바꾼다.
                      const inputId = `${uid}-decision-${index}`;
                      return (
                        <div className="option" key={entry.candidateId}>
                          <input
                            id={inputId}
                            type="radio"
                            name={`${uid}-decision`}
                            value={entry.decision.id}
                            checked={decisionId === entry.decision.id}
                            disabled={busy}
                            onChange={() => { setDecisionId(entry.decision.id); }}
                          />
                          <label htmlFor={inputId}>
                            {`${props.snapshot?.candidates.find(candidate => candidate.id === entry.candidateId)?.statement ?? '후보'} · ${ruleRepresentationLabel(entry.decision.representation)}`}
                          </label>
                        </div>
                      );
                    })}
                  </fieldset>
                )}
              {intakeKnown && !hasIntake
                ? <p className="hint">기존 방식으로 만든 작업이라 규칙을 저장할 수 없습니다. 프로젝트와 수신처를 고른 작업에서만 저장할 수 있습니다.</p>
                : null}
              <div className="action">
                <button
                  className="button button--solid"
                  type="button"
                  disabled={!saveReady}
                  aria-describedby={saveHintId}
                  onClick={() => { rules.saveFromDecision(decisionId); }}
                >
                  선택한 결정에서 규칙 저장
                </button>
                <p className="hint" id={saveHintId}>
                  {saveReady
                    ? '서버가 대상 열과 표현을 다시 검증합니다.'
                    : !intakeKnown
                      ? '이 작업의 저장 범위를 확인한 뒤 저장할 수 있습니다. 새로 고침으로 다시 확인하세요.'
                      : !hasIntake
                        ? '저장 범위가 없는 작업이라 저장할 수 없습니다.'
                        : '저장할 결정을 선택하면 열립니다.'}
                </p>
              </div>
            </>
          )}
      </section>

      <section className="batch" aria-labelledby="rules-apply-heading">
        <h3 id="rules-apply-heading">현재 작업에 규칙 적용</h3>
        {props.snapshot === null
          ? <p className="hint">작업을 고르면 적용할 규칙을 고를 수 있습니다. 저장된 규칙을 이 작업의 후보에 다시 계산합니다.</p>
          : rules.rules.filter(rule => ruleIsActive(rule)).length === 0
            ? <p className="hint">적용할 수 있는 활성 규칙이 없습니다. 철회되었거나 만료된 규칙은 새 적용에 쓰이지 않습니다.</p>
            : (
              <fieldset className="candidate__disposition">
                <legend>적용할 규칙</legend>
                {rules.rules.filter(rule => ruleIsActive(rule)).map(rule => {
                  const inputId = `${uid}-apply-${rule.id}`;
                  return (
                    <div className="option" key={rule.id}>
                      <input
                        id={inputId}
                        type="checkbox"
                        checked={selectedRuleIds.has(rule.id)}
                        disabled={busy}
                        onChange={event => {
                          const checked = event.currentTarget.checked;
                          setSelectedRuleIds(previous => {
                            const next = new Set(previous);
                            if (checked) next.add(rule.id);
                            else next.delete(rule.id);
                            return next;
                          });
                        }}
                      />
                      <label htmlFor={inputId}>
                        {`규칙 ${rule.id.slice(0, 8)} 판본 ${rule.version} · ${ruleRepresentationLabel(rule.representation)}`}
                      </label>
                    </div>
                  );
                })}
              </fieldset>
            )}
        <div className="action">
          <button
            className="button button--solid"
            type="button"
            disabled={!applyReady}
            aria-describedby={applyHintId}
            onClick={() => { rules.apply(refs); }}
          >
            {`선택한 규칙 적용${refs.length === 0 ? '' : ` (${refs.length}개)`}`}
          </button>
          <p className="hint" id={applyHintId}>
            {props.snapshot === null
              ? '적용할 작업을 먼저 선택하세요.'
              : !intakeKnown
                ? '이 작업의 저장 범위를 확인한 뒤 적용할 수 있습니다.'
                : !hasIntake
                  ? '기존 방식으로 만든 작업이라 규칙을 적용할 수 없습니다.'
                  : refs.length === 0
                    ? '규칙을 하나 이상 고르세요.'
                    : `${refs.length}개를 한 번에 적용합니다. 하나라도 맞지 않으면 아무것도 적용되지 않습니다.`}
          </p>
        </div>
      </section>
    </section>
  );
}
