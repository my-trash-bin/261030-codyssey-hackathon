import { api, esc, text, notice, on, upload, session } from "./api.js";
const root = document.querySelector("#app");
let task = null,
	events = null,
	refreshing = false;
let rulesCache = [],
	catalogCache = { entries: [] };
const purposeNames = {
	vendor_support: "공급사 문의",
	oss_issue: "오픈소스 버그 제보",
	operations_advice: "외부 운영 자문",
};
const kindNames = {
	observation: "관찰",
	constraint: "제약",
	unknown: "미확인",
	identifier: "추적 ID",
	series: "요청량",
	timeline: "사건 순서",
	synthetic: "합성 재현",
	config_example: "새 설정 예시",
};
const decisionNames = {
	allow: "공개 허용",
	exclude: "이번 결과에서 제외",
	defer: "보류",
};
const jobNames = {
	analyze: "자료 분석",
	compose: "문서 작성",
	review: "재검토",
	interpret_disclosure: "조건 해석",
	reproduce: "합성 재현",
	provider_check: "연결 확인",
};
const jobStates = {
	queued: "대기",
	running: "실행 중",
	succeeded: "완료",
	failed: "실패",
	stale: "선택 변경으로 무효",
	cancelled: "취소",
};
const reproNames = {
	not_run: "실행하지 않음",
	not_requested: "요청하지 않음",
	running: "실행 중",
	reproduced: "지정 오류 재현 확인",
	not_reproduced: "지정 오류 재현 안 됨",
	inconclusive: "판정 불충분",
	error: "실행 오류",
};
const reproReasons = {
	no_environment: "해당 제품의 실행 환경 없음",
	disabled_by_configuration: "설정에서 실행 비활성화",
	EXPECTED_TARGET_OUTCOME: "대조군·수정 버전·실제 출력 파일 확인",
};
const entityName = (id) =>
	catalogCache.entries.find((v) => v.id === id)?.display_name || id;
let interpreting = false;
let viewState = "",
	pendingRefresh = false;
const phases = {
	needs_analysis: "자료 분석 필요",
	needs_decisions: "공개 선택 필요",
	ready_to_generate: "작성 준비 완료",
	processing: "처리 중",
	needs_attention: "확인 또는 재시도 필요",
	ready_to_finalize: "현재 선택 기준 검사 완료",
	finalized: "파일 확정 완료",
};
async function newPage() {
	const catalog = await api("/catalog");
	const options = (k) =>
		catalog.entries
			.filter((v) => v.kind === k)
			.map(
				(v) => `<option value="${esc(v.id)}">${esc(v.display_name)}</option>`,
			)
			.join("");
	root.innerHTML = `<div class="narrow"><div class="intro"><span class="badge">01 · 새 작업</span><h1>무엇을 공유하시나요?</h1><p class="muted">자료를 추가해도 공개가 승인되지는 않습니다. 다음 단계에서 공개할 내용을 선택합니다.</p></div><form id="new" class="panel"><div class="form-grid"><div><label for="title">내부 작업 이름</label><input id="title" required value="공급사 문의 준비"><label for="project">프로젝트</label><select id="project">${options("project")}</select><label for="purpose">공유 목적</label><select id="purpose"><option value="vendor_support">공급사 문의</option><option value="oss_issue">오픈소스 버그 제보</option><option value="operations_advice">외부 운영 자문</option></select></div><div><label for="recipient">수신자</label><select id="recipient">${options("recipient")}</select><label for="audience">공개 범위</label><select id="audience"><option value="named_external">지정 외부 수신자</option><option value="public">전체 공개</option></select><label for="language">결과 언어</label><select id="language"><option value="ko">한국어</option><option value="en">English (live 모델)</option></select></div><div class="wide"><label for="files">자료 파일 (UTF-8 txt, log, md, csv, json)</label><input id="files" type="file" multiple accept=".txt,.log,.md,.csv,.json"><label for="paste">또는 텍스트 붙여넣기</label><textarea id="paste" placeholder="사내 자료를 입력하세요"></textarea><p class="muted">파일당 256 KiB · 최대 10개 · 전체 1 MiB. 모델 입력 크기 제한은 별도입니다.</p></div></div><button class="primary" id="create">작업 만들기 및 자료 분석</button><p id="form-error" role="alert"></p></form></div>`;
	document.querySelector("#new").addEventListener("submit", async (e) => {
		e.preventDefault();
		const button = document.querySelector("#create");
		button.disabled = true;
		try {
			const v = (id) => document.getElementById(id).value;
			const t = await api("/tasks", {
				method: "POST",
				body: {
					internal_title: v("title"),
					project_id: v("project"),
					purpose_id: v("purpose"),
					recipient_id: v("recipient"),
					audience: v("audience"),
					output_language: v("language"),
					skill_ids: [],
				},
			});
			let files = [...document.querySelector("#files").files];
			if (v("paste").trim())
				files.push(
					new File([v("paste")], "붙여넣기.txt", { type: "text/plain" }),
				);
			let rev = t.revision;
			if (files.length) {
				const res = await upload(t.id, rev, files);
				rev = res.current_revision;
				await api(`/tasks/${t.id}/jobs`, {
					method: "POST",
					body: { expected_revision: rev, kind: "analyze" },
				});
			}
			location.href = "/tasks/" + t.id;
		} catch (err) {
			document.querySelector("#form-error").textContent = err.message;
		} finally {
			button.disabled = false;
		}
	});
}
function rep(kind) {
	switch (kind) {
		case "direction":
			return {
				kind: "derived_table",
				transform_id: "series_direction_only.v1",
				parameters: {},
			};
		case "ratio":
			return {
				kind: "derived_table",
				transform_id: "series_index_base100.v1",
				parameters: { decimal_places: 2 },
			};
		case "timeseq":
			return {
				kind: "derived_table",
				transform_id: "timeline_sequence_only.v1",
				parameters: {},
			};
		case "relative":
			return {
				kind: "derived_table",
				transform_id: "timeline_relative_intervals.v1",
				parameters: {},
			};
		case "shifted":
			return {
				kind: "derived_table",
				transform_id: "timeline_shifted_absolute.v1",
				parameters: { base_epoch_seconds: 1893456000 },
			};
		case "schedule":
			return {
				kind: "derived_table",
				transform_id: "timeline_synthetic_schedule.v1",
				parameters: { base_epoch_seconds: 1893456000 },
			};
		case "exact":
			return { kind: "exact_value", transform_id: "", parameters: {} };
		default:
			return { kind: "fact_summary", transform_id: "", parameters: {} };
	}
}
async function load() {
	if (interpreting) return;
	if (refreshing) {
		pendingRefresh = true;
		return;
	}
	refreshing = true;
	try {
		do {
			pendingRefresh = false;
			[task, rulesCache, catalogCache] = await Promise.all([
				api("/tasks/" + location.pathname.split("/")[2]),
				api("/rules"),
				api("/catalog"),
			]);
			const next = JSON.stringify([
				task.revision,
				task.phase,
				task.current_artifact_id,
				task.export_id,
				task.candidates?.length,
				task.jobs
					?.filter((j) => j.kind !== "interpret_disclosure")
					.map((j) => [j.id, j.status]),
			]);
			if (next !== viewState) {
				viewState = next;
				if (location.pathname.endsWith("/final")) await finalPage();
				else workspace();
			}
		} while (pendingRefresh);
	} finally {
		refreshing = false;
	}
}

function workspace() {
	const t = task;
	const a = t.artifacts?.find((a) => a.id === t.current_artifact_id);
	root.innerHTML = `<div class="heading-row"><div><span class="badge">02 · 공개 선택과 작성</span><h1>${esc(t.internal_title)}</h1><p class="muted">판본 ${t.revision} · ${esc(purposeNames[t.scope.purpose_id] || t.scope.purpose_id)} · ${esc(entityName(t.scope.recipient_id))}</p></div><div><a class="button" href="/tasks/${t.id}/final">최종 파일 확인 →</a></div></div><div class="status">${esc(phases[t.phase])} · 재현: ${esc(reproNames[t.reproduction.status] || t.reproduction.status)} / ${esc(reproReasons[t.reproduction.reason_code] || t.reproduction.reason_code)}</div><div class="grid"><section class="panel"><h2>공개 선택</h2><p class="muted">선택을 변경하면 모든 파일을 새로 작성합니다. 직접 편집한 문장도 교체될 수 있습니다.</p><div id="cards">${
		(t.candidates || [])
			.map((c, i) => {
				const d = t.decisions?.[c.id];
				const matchingRules = rulesCache.filter(
					(r) =>
						!r.revoked &&
						(!r.expires_at || Date.parse(r.expires_at) > Date.now()) &&
						r.selector === c.selector &&
						JSON.stringify(r.scope) === JSON.stringify(t.scope),
				);
				return `<article class="card"><span class="badge">${c.required ? "핵심 정보" : "선택 정보"} · ${esc(kindNames[c.kind] || c.kind)}</span><h3>${esc(c.statement)}</h3>${c.conflict_group ? `<p class="warn">상충 근거: ${esc(c.conflict_reason)}. 같은 충돌 묶음의 주장을 동시에 허용할 수 없습니다. 근거를 확인하고 제외·보류 또는 수동 후보 추가로 정리하세요.</p>` : ""}<p class="muted">조사에 필요한 관찰과 제약을 전달합니다. 선택한 미리보기만 공개되며 원본 파일은 포함하지 않습니다.</p><p>현재 선택: <strong>${esc(d?.revoked ? "철회됨" : decisionNames[d?.disposition] || "미선택")}</strong></p><label for="choice-${i}">공개 방법</label><select id="choice-${i}">${c.kind === "series" ? '<option value="summary">구체적인 데이터 없이 사실만</option><option value="direction">추이만 보이게 나머지 마스킹</option><option value="ratio">첫 관찰을 100으로 한 비율</option><option value="exact">정확한 값</option><option value="fields">요청 정보 마스킹 · 열과 관찰 선택</option><option value="custom">기타 직접 입력</option>' : c.kind === "timeline" ? '<option value="summary">순서 문장만</option><option value="timeseq">사건 순서 표 · 실제 간격 제외</option><option value="relative">실제 시간 간격 공개</option><option value="shifted">새 기준 시각 · 실제 간격 유지</option><option value="schedule">원래 간격과 무관한 합성 시각</option>' : `<option value="${c.kind === "identifier" ? "exact" : "summary"}">이 문장 / 값 그대로 허용</option>`}<option value="excerpt">승인 원문 구간 · 고급</option><option value="exclude">이번 결과에서 제외</option><option value="defer">보류</option></select><p class="muted">${c.kind === "series" ? "방향 표는 관찰 개수와 순서를 포함합니다. 실제 값·비율·시간 간격은 제외됩니다." : "정확한 값은 이 자료와 현재 수신자에만 적용됩니다."}</p>${c.kind === "series" ? `<label><input type="checkbox" id="reuse-${i}">같은 범위·필드에서 표현 기준 재사용</label>` : ""}${c.kind === "series" ? `<details><summary>남길 열·단위·관찰 범위</summary><label><input type="checkbox" id="keep-order-${i}" checked>관찰 순서</label><label><input type="checkbox" id="keep-count-${i}" checked>실제 건수</label><label><input type="checkbox" id="keep-unit-${i}">분당 단위 (해당 자료에 있는 경우)</label><label for="row-start-${i}">시작 관찰 (0부터)</label><input type="number" id="row-start-${i}" value="0" min="0"><label for="row-end-${i}">끝 관찰 (미포함)</label><input type="number" id="row-end-${i}" value="${c.values?.length || 0}" min="1"><small>실제 시각은 공개하지 않습니다. 미리보기의 건수와 선택한 관찰만 공개합니다.</small></details><details><summary>직접 입력 조건</summary><textarea id="custom-${i}" placeholder="첫 관찰을 100으로 한 비율만 공개 / 방향만 공개"></textarea><small>조건 해석기가 등록된 변환으로 제안한 후 실제 미리보기를 확인합니다. fixture는 안내한 두 문장만 지원하며, live는 동일한 계약으로 해석합니다.</small></details>` : ""}${matchingRules.length ? `<details><summary>저장 기준 판본 적용</summary><select id="rule-choice-${i}">${matchingRules.map((r) => `<option value="${esc(r.id)}:${r.version}">${esc(r.representation.transform_id || r.representation.kind)} · v${r.version}</option>`).join("")}</select><button id="apply-rule-${i}">이 판본으로 새 미리보기·적용</button><small>현재 자료의 값을 다시 계산하며 이전 결과를 복사하지 않습니다.</small></details>` : ""}<details><summary>원문 구간 선택 · UTF-8 바이트</summary><label for="raw-ev-${i}">근거 구간</label><select id="raw-ev-${i}">${c.evidence_ids
					.map((id) => {
						const ev = t.evidence.find((e) => e.id === id);
						return `<option value="${esc(id)}">${esc(ev?.source_version_id)} · ${ev?.start}–${ev?.end}</option>`;
					})
					.join(
						"",
					)}</select><label for="raw-start-${i}">시작 바이트 (포함)</label><input type="number" id="raw-start-${i}" value="${t.evidence.find((e) => e.id === c.evidence_ids[0])?.start || 0}" min="0"><label for="raw-end-${i}">끝 바이트 (미포함)</label><input type="number" id="raw-end-${i}" value="${t.evidence.find((e) => e.id === c.evidence_ids[0])?.end || 0}" min="1"><label for="raw-hide-${i}">숨김 범위 JSON (절대 바이트)</label><textarea id="raw-hide-${i}">[]</textarea><small>공개 방법을 승인 원문 구간으로 고른 후 실제 렌더링 미리보기를 확인하세요. 다른 판본·범위는 별도 승인이 필요합니다.</small></details><details><summary>승인 만료 시각 (선택)</summary><input id="expiry-${i}" type="datetime-local"></details><div class="actions"><button id="preview-${i}">공개 미리보기</button><button class="primary" id="apply-${i}" disabled>이 선택 적용</button></div>${d && !d.revoked ? `<button id="revoke-${i}">현재 승인 철회</button>` : ""}<pre id="projection-${i}" hidden></pre><details><summary>근거 열기</summary><div id="evidence-${i}"></div></details></article>`;
			})
			.join("") ||
		"<p>자료를 추가하고 분석을 시작하세요. 분석 실패 시 아래에서 수동 후보를 추가할 수 있습니다.</p>"
	}</div><details><summary>사람이 사실 후보 추가</summary><label for="manual-text">공개 후보 문장</label><textarea id="manual-text"></textarea><label for="manual-note">내부 근거 메모</label><textarea id="manual-note"></textarea><button id="manual">후보 추가 (공개 결정은 별도)</button></details></section><section class="panel"><h2>현재 초안</h2>${
		a
			? `<pre class="draft">${esc(
					a.files
						.filter((f) => f.path.endsWith(".md"))
						.map((f) => text(f.bytes))
						.join("\n"),
				)}</pre><details><summary>문장 직접 편집</summary><p class="warn">저장하면 새 판본이 되며 다시 검토해야 합니다. 추가 사실은 공개 결정에서 승인해야 합니다.</p>${a.document.blocks.map((b, i) => (b.type === "paragraph" || b.type === "heading" ? `<label for="edit-block-${i}">${b.type === "heading" ? "제목" : "문단"} ${i + 1}</label><textarea id="edit-block-${i}">${esc(b.text)}</textarea>` : b.type === "list" ? b.items.map((item, j) => `<label for="edit-item-${i}-${j}">목록 항목 ${j + 1}</label><textarea id="edit-item-${i}-${j}">${esc(item.text)}</textarea>`).join("") : `<p class="muted">표·원문·설정 첨부는 공개 선택에서 수정하세요.</p>`)).join("")}<button id="edit">편집 저장</button></details>`
			: '<p class="muted">공개할 정보를 선택한 뒤 새 초안을 작성하세요. 이전 결과는 현재 결과로 사용할 수 없습니다.</p>'
	}<div class="actions"><button class="primary" id="compose" ${t.phase === "processing" || t.phase === "needs_analysis" ? "disabled" : ""}>현재 선택으로 작성</button>${["draft", "blocked"].includes(a?.status) ? '<button id="review">편집 초안 재검토</button>' : ""}</div><small>필수 미결정·보류·만료 승인이 있으면 작성과 확정이 차단됩니다.</small></section><aside class="panel"><h2>근거와 실행 기록</h2><details open><summary>원자료 · 내부 전용</summary>${(t.sources || []).map((src) => `<details><summary>${esc(src.display_name)} · ${src.included ? "사용" : "제외"} · ${src.format} · ${atob(src.raw_bytes).length} B</summary><pre>${esc(text(src.raw_bytes))}</pre></details>`).join("")}<input type="file" id="more-files" multiple accept=".txt,.log,.md,.csv,.json"><div class="actions"><button id="add-files">자료 추가</button><button id="analyze">자료 분석 / 재시도</button></div></details><details open><summary>실행 · ${esc(t.provider_mode)}</summary>${(t.jobs || []).map((j) => `<p><span class="badge">${esc(jobNames[j.kind] || j.kind)}</span> ${esc(jobStates[j.status] || j.status)} ${esc(j.error_code || "")}</p>`).join("")}</details><details><summary>공개 범위 변경</summary><label for="new-recipient">수신자 ID</label><input id="new-recipient" value="${esc(t.scope.recipient_id)}"><button id="scope">수신자 변경 및 재선택</button><button id="skills-update">설치된 제품 지침 판본 적용</button><small>지침 판본을 바꾸면 자료를 재분석하고 공개 선택을 다시 확인합니다.</small></details><details><summary>선택 변경 기록</summary>${(t.events || []).map((e) => `<p>r${e.revision} · ${esc(e.type)}</p>`).join("")}</details></aside></div>`;
	(t.candidates || []).forEach((c, i) => {
		let preview = null;
		let rawGrants = [];
		let interpretedRepresentation = null;
		const select = document.querySelector("#choice-" + i);
		const apply = document.querySelector("#apply-" + i);
		const current = t.decisions?.[c.id];
		if (current && !current.revoked) {
			select.value =
				current.disposition === "allow"
					? current.representation.kind === "derived_table"
						? current.representation.transform_id === "series_direction_only.v1"
							? "direction"
							: "ratio"
						: current.representation.kind === "approved_excerpt"
							? "excerpt"
							: current.representation.kind === "selected_fields"
								? "fields"
								: current.representation.kind === "exact_value"
									? "exact"
									: "summary"
					: current.disposition;
		}
		if (c.kind === "timeline" && current?.disposition === "allow") {
			select.value =
				{
					"timeline_sequence_only.v1": "timeseq",
					"timeline_relative_intervals.v1": "relative",
					"timeline_shifted_absolute.v1": "shifted",
					"timeline_synthetic_schedule.v1": "schedule",
				}[current.representation.transform_id] || "summary";
		}

		if (current) {
			const params = current.representation.parameters || {};
			for (const [key, id] of [
				["include_observation", "keep-order-"],
				["include_count", "keep-count-"],
				["include_unit", "keep-unit-"],
			]) {
				const input = document.querySelector("#" + id + i);
				if (input && params[key] !== undefined)
					input.checked = params[key] === 1;
			}
			for (const [key, id] of [
				["start_row", "row-start-"],
				["end_row", "row-end-"],
			]) {
				const input = document.querySelector("#" + id + i);
				if (input && params[key] !== undefined) input.value = params[key];
			}
			const grant = current.raw_grants?.[0];
			if (grant) {
				const ev = t.evidence.find(
					(e) =>
						e.source_version_id === grant.source_version_id &&
						e.start <= grant.byte_range.start &&
						e.end >= grant.byte_range.end &&
						c.evidence_ids.includes(e.id),
				);
				if (ev) document.querySelector("#raw-ev-" + i).value = ev.id;
				document.querySelector("#raw-start-" + i).value =
					grant.byte_range.start;
				document.querySelector("#raw-end-" + i).value = grant.byte_range.end;
				document.querySelector("#raw-hide-" + i).value = JSON.stringify(
					grant.hidden_ranges,
				);
			}
			if (current.expires_at) {
				const d = new Date(current.expires_at);
				document.querySelector("#expiry-" + i).value = new Date(
					d.getTime() - d.getTimezoneOffset() * 60000,
				)
					.toISOString()
					.slice(0, 16);
			}
		}
		on("apply-rule-" + i, async () => {
			const [id, version] = document
				.querySelector("#rule-choice-" + i)
				.value.split(":");
			const rule = rulesCache.find(
				(r) => r.id === id && r.version === Number(version),
			);
			const pr = await api(`/tasks/${t.id}/disclosure-previews`, {
				method: "POST",
				body: {
					expected_revision: t.revision,
					candidate_id: c.id,
					representation: rule.representation,
				},
			});
			const pre = document.querySelector("#projection-" + i);
			pre.hidden = false;
			pre.textContent = JSON.stringify(pr.projection, null, 2);
			notice(
				"새 자료의 미리보기를 표시했습니다. 아래 적용 버튼으로 확인하세요.",
			);
			preview = pr;
			rawGrants = [];
			interpretedRepresentation = rule.representation;
			const choice =
				rule.representation.transform_id === "series_direction_only.v1"
					? "direction"
					: rule.representation.transform_id === "series_index_base100.v1"
						? "ratio"
						: "summary";
			select.value = choice;
			apply.disabled = false;
			apply.dataset.ruleId = id;
			apply.dataset.ruleVersion = version;
		});
		const representation = () => {
			if (select.value === "excerpt")
				return { kind: "approved_excerpt", transform_id: "", parameters: {} };
			if (select.value === "fields") {
				return {
					kind: "selected_fields",
					transform_id: "",
					parameters: {
						include_observation: document.querySelector("#keep-order-" + i)
							.checked
							? 1
							: 0,
						include_count: document.querySelector("#keep-count-" + i).checked
							? 1
							: 0,
						include_unit: document.querySelector("#keep-unit-" + i).checked
							? 1
							: 0,
						start_row: Number(document.querySelector("#row-start-" + i).value),
						end_row: Number(document.querySelector("#row-end-" + i).value),
					},
				};
			}

			if (select.value === "custom") {
				if (!interpretedRepresentation)
					throw Error("조건 해석 후 미리보기를 확인하세요.");
				return interpretedRepresentation;
			}

			return rep(select.value);
		};
		document.querySelector("#raw-ev-" + i).addEventListener("change", (e) => {
			const ev = t.evidence.find((v) => v.id === e.target.value);
			document.querySelector("#raw-start-" + i).value = ev.start;
			document.querySelector("#raw-end-" + i).value = ev.end;
			preview = null;
			apply.disabled = true;
		});
		select.closest("article").addEventListener("input", (e) => {
			if (e.target.id !== "reuse-" + i) {
				preview = null;
				apply.disabled = !["exclude", "defer"].includes(select.value);
			}
		});
		select.addEventListener("change", () => {
			const panelId = {
				custom: "custom-",
				fields: "keep-order-",
				excerpt: "raw-ev-",
			}[select.value];
			if (panelId) {
				const field = document.querySelector("#" + panelId + i);
				if (field) field.closest("details").open = true;
			}
			delete apply.dataset.ruleId;
			delete apply.dataset.ruleVersion;
			preview = null;
			apply.disabled = !["exclude", "defer"].includes(select.value);
			document.querySelector("#projection-" + i).hidden = true;
		});
		on("preview-" + i, async () => {
			delete apply.dataset.ruleId;
			delete apply.dataset.ruleVersion;
			const choice = select.value;
			if (["exclude", "defer"].includes(choice)) {
				apply.disabled = false;
				return;
			}

			if (select.value === "custom") {
				interpreting = true;
				try {
					const job = await api(`/tasks/${t.id}/jobs`, {
						method: "POST",
						body: {
							expected_revision: t.revision,
							kind: "interpret_disclosure",
							arguments: {
								candidate_id: c.id,
								text: document.querySelector("#custom-" + i).value.trim(),
							},
						},
					});
					let result = null;
					for (let attempt = 0; attempt < 600; attempt++) {
						const state = await api("/jobs/" + job.id);
						if (state.status === "succeeded") {
							result = state.result;
							break;
						}
						if (["failed", "stale", "cancelled"].includes(state.status))
							throw Error(state.error_code || state.status);
						await new Promise((resolve) => setTimeout(resolve, 300));
					}
					if (!result) throw Error("조건 해석 대기시간 초과");
					if (result.status !== "supported")
						throw Error(
							result.status +
								": 조건을 더 구체적으로 입력하거나 지원하는 선택을 사용하세요.",
						);
					interpretedRepresentation = result.representation;
				} finally {
					interpreting = false;
				}
			}
			rawGrants = [];
			if (select.value === "excerpt") {
				const ev = t.evidence.find(
					(e) => e.id === document.querySelector("#raw-ev-" + i).value,
				);
				const src = t.sources.find((s) => s.id === ev.source_version_id);
				const raw = Uint8Array.from(atob(src.raw_bytes), (c) =>
					c.charCodeAt(0),
				);
				const start = Number(document.querySelector("#raw-start-" + i).value),
					end = Number(document.querySelector("#raw-end-" + i).value);
				const masks = JSON.parse(
					document.querySelector("#raw-hide-" + i).value,
				).sort((a, b) => a.start - b.start);
				let pos = start;
				const parts = [];
				if (start < ev.start || end > ev.end || start >= end)
					throw Error("원문 범위를 현재 근거 안에서 선택하세요.");
				for (const mask of masks) {
					if (mask.start < pos || mask.end > end || mask.start >= mask.end)
						throw Error("숨김 범위를 확인하세요.");
					parts.push(
						raw.slice(pos, mask.start),
						new TextEncoder().encode("[비공개]"),
					);
					pos = mask.end;
				}
				parts.push(raw.slice(pos, end));
				const rendered = new Uint8Array(
					parts.reduce((n, p) => n + p.length, 0),
				);
				let offset = 0;
				for (const part of parts) {
					rendered.set(part, offset);
					offset += part.length;
				}
				new TextDecoder("utf-8", { fatal: true }).decode(rendered);
				const digest = [
					...new Uint8Array(await crypto.subtle.digest("SHA-256", rendered)),
				]
					.map((b) => b.toString(16).padStart(2, "0"))
					.join("");
				const expiry = document.querySelector("#expiry-" + i).value;
				rawGrants = [
					{
						source_version_id: src.id,
						source_sha256: src.sha256,
						byte_range: { start, end },
						hidden_ranges: masks,
						rendered_sha256: digest,
						scope: t.scope,
						expires_at: expiry ? new Date(expiry).toISOString() : null,
					},
				];
			}
			preview = await api(`/tasks/${t.id}/disclosure-previews`, {
				method: "POST",
				body: {
					expected_revision: t.revision,
					candidate_id: c.id,
					representation: representation(),
					raw_grants: rawGrants,
				},
			});
			const pre = document.querySelector("#projection-" + i);
			pre.hidden = false;
			pre.textContent = preview.projection.excerpt
				? text(preview.projection.excerpt)
				: JSON.stringify(preview.projection, null, 2);
			apply.disabled = false;
		});
		on("apply-" + i, async () => {
			const disposition = ["exclude", "defer"].includes(select.value)
				? select.value
				: "allow";
			let op = { candidate_id: c.id, disposition };
			if (disposition === "allow") {
				if (!preview) throw Error("미리보기를 먼저 확인하세요.");
				op = {
					...op,
					representation: representation(),
					raw_grants: rawGrants,
					preview_id: preview.preview_id,
					projection_sha256: preview.projection_sha256,
					save_reusable_rule:
						document.querySelector("#reuse-" + i)?.checked || false,
				};
			}
			if (apply.dataset.ruleId) {
				op.applied_rule_id = apply.dataset.ruleId;
				op.applied_rule_version = Number(apply.dataset.ruleVersion);
				op.save_reusable_rule = false;
			}
			const expiry = document.querySelector("#expiry-" + i)?.value;
			if (expiry) op.expires_at = new Date(expiry).toISOString();
			await api(`/tasks/${t.id}/decision-batches`, {
				method: "POST",
				body: { expected_revision: t.revision, operations: [op] },
			});
			await load();
		});
		on("revoke-" + i, async () => {
			await api(`/tasks/${t.id}/decisions/${current.id}/revoke`, {
				method: "POST",
				body: { expected_revision: t.revision },
			});
			await load();
		});
		document
			.querySelector("#evidence-" + i)
			.parentElement.addEventListener("toggle", async (e) => {
				if (!e.currentTarget.open) return;
				const chunks = await Promise.all(
					c.evidence_ids.map((id) => api(`/tasks/${t.id}/evidence/${id}`)),
				);
				document.querySelector("#evidence-" + i).innerHTML = chunks
					.map((v) => `<pre>${esc(v.text)}</pre>`)
					.join("");
			});
	});
	on("compose", () => start("compose"));
	on("review", () => start("review"));
	on("analyze", () => start("analyze"));
	on("add-files", async () => {
		const files = [...document.querySelector("#more-files").files];
		if (!files.length) throw Error("파일을 선택하세요.");
		await upload(t.id, t.revision, files);
		await load();
	});
	on("skills-update", async () => {
		await api("/tasks/" + t.id, {
			method: "PATCH",
			body: { expected_revision: t.revision, skill_ids: [] },
		});
		await load();
	});
	on("scope", async () => {
		await api("/tasks/" + t.id, {
			method: "PATCH",
			body: {
				expected_revision: t.revision,
				recipient_id: document.querySelector("#new-recipient").value,
			},
		});
		await load();
	});
	on("manual", async () => {
		await api(`/tasks/${t.id}/manual-candidates`, {
			method: "POST",
			body: {
				expected_revision: t.revision,
				statement: document.querySelector("#manual-text").value,
				kind: "observation",
				evidence_ids: [],
				user_note: document.querySelector("#manual-note").value,
			},
		});
		await load();
	});
	on("edit", async () => {
		await api("/artifacts/" + a.id + "/edit", {
			method: "PUT",
			body: {
				expected_revision: t.revision,
				expected_document_hash: a.document_hash,
				document: (() => {
					const d = structuredClone(a.document);
					d.blocks.forEach((b, i) => {
						const input = document.querySelector("#edit-block-" + i);
						if (input) b.text = input.value;
						if (b.items)
							b.items.forEach((item, j) => {
								const el = document.querySelector(`#edit-item-${i}-${j}`);
								if (el) item.text = el.value;
							});
					});
					return d;
				})(),
			},
		});
		await load();
	});
}
async function start(kind) {
	await api(`/tasks/${task.id}/jobs`, {
		method: "POST",
		body: { expected_revision: task.revision, kind },
	});
	await load();
}
async function finalPage() {
	const t = task;
	const a = t.artifacts?.find((a) => a.id === t.current_artifact_id);
	root.innerHTML = `<div class="narrow"><span class="badge">03 · 최종 확인</span><h1>이 파일들을 공유합니다</h1><p><a href="/tasks/${t.id}">← 공개 선택으로 돌아가기</a></p><div class="status">${esc(phases[t.phase])} · 판본 ${t.revision}</div><p>목적: ${esc(purposeNames[t.scope.purpose_id] || t.scope.purpose_id)} / 수신자: ${esc(entityName(t.scope.recipient_id))} / 범위: ${t.scope.audience === "public" ? "전체 공개" : "지정 외부 수신자"}</p><p>재현: ${esc(reproNames[t.reproduction.status] || t.reproduction.status)} (${esc(reproReasons[t.reproduction.reason_code] || t.reproduction.reason_code)}). 실제 재현 성공을 뜻하지 않습니다.</p>${a ? `<section class="panel"><h2>실제 저장 파일</h2><p class="muted">아래 내용과 해시를 확인하세요. 확정 후에도 승인 상태가 바뀌면 다운로드가 차단됩니다.</p>${a.files.map((f) => `<article class="file"><strong>${esc(f.path)}</strong> · ${f.size} B<details><summary>실제 파일 내용 및 SHA-256</summary><pre>${esc(f.sha256)}\n\n${esc(text(f.bytes))}</pre></details>${t.export_id ? `<a class="button" href="/api/v1/exports/${t.export_id}/files/${f.id}">파일 다운로드</a>` : ""}</article>`).join("")}<p>파일 집합 해시</p><pre>${esc(a.artifact_set_hash)}</pre>${a.status === "blocked" ? `<details><summary>사람 의미 검토로 전환</summary><p>실제 파일의 미승인 정보·추가 단정·누락된 제약을 확인하세요. 승인과 판본 및 파일 검사는 생략할 수 없습니다.</p><textarea id="human-reason" placeholder="모델 검토를 대신한 사유와 확인 내용"></textarea><button id="human">이 파일 해시에 사람 검토 기록</button></details>` : ""}<label><input type="checkbox" id="confirmed">실제 파일과 현재 공개 선택을 확인했습니다.</label><div class="actions"><button class="primary" id="finalize" ${t.phase !== "ready_to_finalize" ? "disabled" : ""}>이 파일들로 확정</button>${t.export_id ? `<a class="button primary" href="/api/v1/exports/${t.export_id}/archive">공개 ZIP 다운로드</a><button id="copy">본문 복사</button>` : ""}</div><p class="muted">검사 미완료 또는 보류·만료·철회가 있으면 확정할 수 없습니다.</p></section>` : '<p class="warn">현재 선택에 유효한 결과가 없습니다. 공개 선택 화면에서 다시 작성하세요.</p>'}</div>`;
	on("human", async () => {
		if (!document.querySelector("#confirmed").checked)
			throw Error("실제 파일 확인에 체크해 주세요.");
		await api("/artifacts/" + a.id + "/human-review", {
			method: "POST",
			body: {
				expected_revision: t.revision,
				expected_artifact_set_hash: a.artifact_set_hash,
				fallback_reason: document.querySelector("#human-reason").value,
				confirmed: true,
			},
		});
		await load();
	});
	on("finalize", async () => {
		if (!document.querySelector("#confirmed").checked)
			throw Error("실제 파일 확인에 체크해 주세요.");
		await api("/artifacts/" + a.id + "/finalize", {
			method: "POST",
			body: {
				expected_revision: t.revision,
				expected_artifact_set_hash: a.artifact_set_hash,
				confirmed: true,
			},
		});
		await load();
	});
	on("copy", async () => {
		const f = a.files.find((f) => f.path.endsWith(".md"));
		const r = await fetch(`/api/v1/exports/${t.export_id}/files/${f.id}`);
		if (!r.ok) throw Error("현재 승인이 유효하지 않습니다.");
		await navigator.clipboard.writeText(await r.text());
		notice("확정된 본문을 복사했습니다.");
	});
}
async function history() {
	const [ts, rules, catalog] = await Promise.all([
		api("/tasks"),
		api("/rules"),
		api("/catalog"),
	]);
	catalogCache = catalog;
	root.innerHTML = `<div class="intro"><span class="badge">작업 기록</span><h1>공유를 준비한 기록</h1><p class="muted">과거 결과는 내부 참고용입니다. 현재 승인 상태를 확인한 뒤 파일을 확정하세요.</p><a class="button primary" href="/tasks/new">+ 새 작업</a></div><div class="history">${ts.map((t) => `<a class="card" href="/tasks/${t.id}"><span class="badge">${esc(t.provider_mode)}</span><h2>${esc(t.internal_title)}</h2><p>${esc(phases[t.phase])} · r${t.revision}</p><small>${esc(purposeNames[t.scope.purpose_id] || t.scope.purpose_id)} / ${esc(entityName(t.scope.recipient_id))}</small></a>`).join("") || "<p>아직 작업이 없습니다.</p>"}</div><section class="panel"><h2>저장한 표현 기준</h2>${rules.map((r, i) => `<div class="rule"><strong>${esc(r.scope.project_id)}의 ${esc(r.scope.recipient_id)} 문의</strong> · ${esc(r.representation.transform_id || r.representation.kind)}<p>${esc(r.selector)} · v${r.version} · ${r.revoked ? "철회됨" : r.expires_at && Date.parse(r.expires_at) < Date.now() ? "만료됨" : "활성"}</p><button id="rule-${i}" ${r.revoked ? "disabled" : ""}>기준 철회</button></div>`).join("") || '<p class="muted">재사용 가능한 표현 기준을 저장하면 여기에 표시됩니다. 정확한 값 승인은 재사용되지 않습니다.</p>'}</section>`;
	rules.forEach((r, i) =>
		on("rule-" + i, async () => {
			await api("/rules/" + r.id + "/revoke", {
				method: "POST",
				body: { expected_rule_version: r.version },
			});
			await history();
		}),
	);
}
try {
	await session();
	if (location.pathname === "/tasks/new") await newPage();
	else if (/^\/tasks\/[^/]+/.test(location.pathname)) {
		await load();
		events = new EventSource(`/api/v1/tasks/${task.id}/events`);
		events.addEventListener("resync_required", () => {
			viewState = "";
			load().catch((err) => notice(err.message));
		});
		let seq = task.events?.at(-1)?.seq || 0;
		for (const type of [
			"job.started",
			"review.completed",
			"task.invalidated",
			"export.finalized",
		])
			events.addEventListener(type, (e) => {
				const v = JSON.parse(e.data);
				if (v.seq > seq) {
					seq = v.seq;
					load().catch((err) => notice(err.message));
				}
			});
		setInterval(() => {
			if (task?.phase === "processing")
				load().catch((err) => notice(err.message));
		}, 2500);
	} else await history();
} catch (err) {
	root.textContent = "화면을 불러오지 못했습니다: " + err.message;
}
