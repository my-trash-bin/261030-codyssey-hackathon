import { api, esc, text, on, upload } from "./api.js";
import { bindDisclosureCards } from "./disclosure-cards.js";

export function renderWorkspace({ task, rulesCache, catalogCache, root, entityName, load, start, setInterpreting, purposeNames, kindNames, decisionNames, jobNames, jobStates, reproNames, reproReasons, phases }) {
	const t = task;
	const a = t.artifacts?.find((a) => a.id === t.current_artifact_id);
	root.innerHTML = `<div class="heading-row"><div><span class="badge">02 · 공개 선택과 작성</span><h1>${esc(t.internal_title)}</h1><p class="muted">판본 ${t.revision} · ${esc(purposeNames[t.scope.purpose_id] || t.scope.purpose_id)} · ${esc(entityName(t.scope.recipient_id))}</p></div><div><a class="button" href="/tasks/${t.id}/final">최종 파일 확인 →</a></div></div><div class="status">${esc(phases[t.phase])} · 재현: ${t.reproduction.revision && t.reproduction.revision !== t.revision ? "이전 판본의 참고 기록 · " : ""}${esc(reproNames[t.reproduction.status] || t.reproduction.status)} / ${esc(reproReasons[t.reproduction.reason_code] || t.reproduction.reason_code)}</div><div class="grid"><section class="panel"><h2>공개 선택</h2><p class="muted">선택을 변경하면 모든 파일을 새로 작성합니다. 직접 편집한 문장도 교체될 수 있습니다.</p><div id="cards">${
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
				return `<article class="card"><span class="badge">${c.required ? "핵심 정보" : "선택 정보"} · ${esc(kindNames[c.kind] || c.kind)} · ${esc({ observed: "자료에서 관찰", reported: "보고된 내용", inferred: "추정", unknown: "확인하지 못함" }[c.uncertainty] || c.uncertainty)}</span><h3>${esc(c.statement)}</h3>${c.needs_decision ? '<p class="warn">검토에서 이 공개 선택의 재확인을 요청했습니다. 새 미리보기를 확인하고 허용하거나 이번 결과에서 제외하세요.</p>' : ""}${c.conflict_group ? `<p class="warn">상충 근거: ${esc(c.conflict_reason)}. 같은 충돌 묶음의 주장을 동시에 허용할 수 없습니다. 근거를 확인하고 제외·보류 또는 수동 후보 추가로 정리하세요.</p>` : ""}<p class="muted">조사에 필요한 관찰과 제약을 전달합니다. 선택한 미리보기만 공개되며 원본 파일은 포함하지 않습니다.</p><p>현재 선택: <strong>${esc(d?.revoked ? "철회됨" : decisionNames[d?.disposition] || "미선택")}</strong></p><label for="choice-${i}">공개 방법</label><select id="choice-${i}">${c.kind === "series" ? '<option value="summary">구체적인 데이터 없이 사실만</option><option value="direction">추이만 보이게 나머지 마스킹</option><option value="ratio">첫 관찰을 100으로 한 비율</option><option value="exact">정확한 값</option><option value="fields">요청 정보 마스킹 · 열과 관찰 선택</option><option value="custom">기타 직접 입력</option>' : c.kind === "timeline" ? '<option value="summary">순서 문장만</option><option value="timeseq">사건 순서 표 · 실제 간격 제외</option><option value="relative">실제 시간 간격 공개</option><option value="shifted">새 기준 시각 · 실제 간격 유지</option><option value="schedule">원래 간격과 무관한 합성 시각</option>' : `<option value="${c.kind === "identifier" ? "exact" : "summary"}">이 문장 / 값 그대로 허용</option>`}<option value="excerpt">승인 원문 구간 · 고급</option><option value="exclude">이번 결과에서 제외</option><option value="defer">보류</option></select><p class="muted">${c.kind === "series" ? "방향 표는 관찰 개수와 순서를 포함합니다. 실제 값·비율·시간 간격은 제외됩니다." : "정확한 값은 이 자료와 현재 수신자에만 적용됩니다."}</p>${c.kind === "series" ? `<label><input type="checkbox" id="reuse-${i}">같은 범위·필드에서 표현 기준 재사용</label>` : ""}${c.kind === "series" ? `<details><summary>남길 열·단위·관찰 범위</summary><label><input type="checkbox" id="keep-order-${i}" checked>관찰 순서</label><label><input type="checkbox" id="keep-count-${i}" checked>실제 건수</label><label><input type="checkbox" id="keep-unit-${i}">분당 단위 (해당 자료에 있는 경우)</label><label for="row-start-${i}">시작 관찰 (0부터)</label><input type="number" id="row-start-${i}" value="0" min="0"><label for="row-end-${i}">끝 관찰 (미포함)</label><input type="number" id="row-end-${i}" value="${c.values?.length || 0}" min="1"><small>실제 시각은 공개하지 않습니다. 미리보기의 건수와 선택한 관찰만 공개합니다.</small></details><details><summary>직접 입력 조건</summary><textarea id="custom-${i}" placeholder="첫 관찰을 100으로 한 비율만 공개 / 방향만 공개"></textarea><small>조건 해석기가 등록된 변환으로 제안한 후 실제 미리보기를 확인합니다. fixture는 안내한 두 문장만 지원하며, live는 동일한 계약으로 해석합니다.</small></details>` : ""}${matchingRules.length ? `<details><summary>저장 기준 판본 적용</summary><select id="rule-choice-${i}">${matchingRules.map((r) => `<option value="${esc(r.id)}:${r.version}">${esc(r.representation.transform_id || r.representation.kind)} · v${r.version}</option>`).join("")}</select><button id="apply-rule-${i}">이 판본으로 새 미리보기·적용</button><small>현재 자료의 값을 다시 계산하며 이전 결과를 복사하지 않습니다.</small></details>` : ""}<details><summary>원문 구간 선택 · UTF-8 바이트</summary><label for="raw-ev-${i}">근거 구간</label><select id="raw-ev-${i}">${c.evidence_ids
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
	}</div><details><summary>사람이 사실 후보 추가</summary><label for="manual-text">공개 후보 문장</label><textarea id="manual-text"></textarea><label for="manual-kind">내용의 성격</label><select id="manual-kind"><option value="observation">관찰 보고</option><option value="constraint">유지할 제약</option><option value="hypothesis">추정 · 원인으로 단정하지 않음</option><option value="unknown">확인하지 못한 사항</option><option value="identifier">정확한 추적 ID</option></select><label for="manual-note">내부 근거 메모</label><textarea id="manual-note"></textarea><button id="manual">후보 추가 (공개 결정은 별도)</button></details></section><section class="panel"><h2>현재 초안</h2>${t.scope_reduced ? '<p class="muted">허용한 관찰 자료의 범위로 문의 목적을 축소했습니다.</p>' : t.candidates?.some((c) => c.required && t.decisions?.[c.id]?.disposition === "exclude") ? '<div class="warn"><p>핵심 정보를 제외했습니다. 더 필요한 공개 선택을 하거나 문의 범위를 줄여 주세요.</p><label><input type="checkbox" id="reduce-confirm">허용한 자료로 가능한 문의만 작성합니다.</label><button id="reduce-scope">문의 범위 축소 확인</button></div>' : ""}${
		a
			? `<pre class="draft">${esc(
					a.files
						.filter((f) => f.path.endsWith(".md"))
						.map((f) => text(f.bytes))
						.join("\n"),
				)}</pre><details><summary>문장 직접 편집</summary><p class="warn">저장하면 새 판본이 되며 다시 검토해야 합니다. 추가 사실은 공개 결정에서 승인해야 합니다.</p>${a.document.blocks.map((b, i) => (b.type === "paragraph" || b.type === "heading" ? `<label for="edit-block-${i}">${b.type === "heading" ? "제목" : "문단"} ${i + 1}</label><textarea id="edit-block-${i}">${esc(b.text)}</textarea>` : b.type === "list" ? b.items.map((item, j) => `<label for="edit-item-${i}-${j}">목록 항목 ${j + 1}</label><textarea id="edit-item-${i}-${j}">${esc(item.text)}</textarea>`).join("") : `<p class="muted">표·원문·설정 첨부는 공개 선택에서 수정하세요.</p>`)).join("")}<button id="edit">편집 저장</button></details>`
			: '<p class="muted">공개할 정보를 선택한 뒤 새 초안을 작성하세요. 이전 결과는 현재 결과로 사용할 수 없습니다.</p>'
	}<div class="actions"><button class="primary" id="compose" ${t.phase === "processing" || t.phase === "needs_analysis" ? "disabled" : ""}>현재 선택으로 작성</button>${["draft", "blocked"].includes(a?.status) ? '<button id="review">편집 초안 재검토</button>' : ""}</div><small>필수 미결정·보류·만료 승인이 있으면 작성과 확정이 차단됩니다.</small></section><aside class="panel"><h2>근거와 실행 기록</h2><details open><summary>원자료 · 내부 전용</summary>${(t.sources || []).map((src) => `<details><summary>${esc(src.display_name)} · ${src.included ? "사용" : "제외"} · ${src.format} · ${src.source_slot === "requests_v1" ? "요청량 관찰 · " : ""}${atob(src.raw_bytes).length} B</summary><pre>${esc(text(src.raw_bytes))}</pre>${src.included ? `<button id="remove-source-${src.id}">이번 자료에서 제외</button>` : ""}</details>`).join("")}<label for="more-csv-role">추가 CSV 자료의 역할</label><select id="more-csv-role"><option value="requests_v1">요청량 관찰</option><option value="generic">일반 자료 · 자동 기준 적용 안 함</option></select><input type="file" id="more-files" multiple accept=".txt,.log,.md,.csv,.json"><div class="actions"><button id="add-files">자료 추가</button><button id="analyze">자료 분석 / 재시도</button></div></details><details open><summary>실행 · ${esc(t.provider_mode)}</summary>${(t.jobs || []).map((j) => `<p><span class="badge">${esc(jobNames[j.kind] || j.kind)}</span> ${esc(jobStates[j.status] || j.status)} ${esc(j.error_code || "")}${j.cancel_requested ? " · 취소 요청됨" : ""}${j.id === t.current_job_id && ["queued", "running"].includes(j.status) && !j.cancel_requested ? `<button id="cancel-job-${j.id}">실행 취소</button>` : ""}</p>`).join("")}</details>${a?.findings?.length ? `<details open><summary>파일 위치별 검사</summary>${a.findings.map((f) => `<p>${esc(f.file_path)} · 바이트 ${f.start}–${f.end}<br>${esc({ "ip.v1": "IP 주소", "token.v1": "인증 값 형태", "bearer.v1": "인증 헤더 형태", "internal_path.v1": "내부 경로", "url.v1": "URL" }[f.detector_id] || f.detector_id)} · ${f.resolution === "blocked" ? "추가 공개 결정 또는 수정 필요" : "현재 범위에서 허용"}</p>`).join("")}</details>` : ""}<details><summary>공개 범위 변경</summary><label for="new-recipient">수신자</label><select id="new-recipient">${catalogCache.entries
		.filter((e) => e.kind === "recipient")
		.map(
			(e) =>
				`<option value="${esc(e.id)}" ${e.id === t.scope.recipient_id ? "selected" : ""}>${esc(e.display_name)}</option>`,
		)
		.join(
			"",
		)}</select><label for="new-audience">공개 범위</label><select id="new-audience"><option value="public" ${t.scope.audience === "public" ? "selected" : ""}>전체 공개</option><option value="named_external" ${t.scope.audience === "named_external" ? "selected" : ""}>지정 외부 수신자</option></select><button id="scope">수신자 변경 및 재선택</button><button id="skills-update">설치된 제품 지침 판본 적용</button><small>지침 판본을 바꾸면 자료를 재분석하고 공개 선택을 다시 확인합니다.</small></details><details><summary>선택 변경 기록</summary>${(t.events || []).map((e) => `<p>r${e.revision} · ${esc(e.type)}</p>`).join("")}</details></aside></div>`;
	bindDisclosureCards({ t, rulesCache, load, setInterpreting });
	(t.sources || [])
		.filter((src) => src.included)
		.forEach((src) =>
			on("remove-source-" + src.id, async () => {
				await api(`/tasks/${t.id}/sources/${src.source_id}`, {
					method: "DELETE",
					body: { expected_revision: t.revision },
				});
				await load();
			}),
		);
	(t.jobs || [])
		.filter(
			(j) =>
				j.id === t.current_job_id &&
				["queued", "running"].includes(j.status) &&
				!j.cancel_requested,
		)
		.forEach((j) =>
			on("cancel-job-" + j.id, async () => {
				await api("/jobs/" + j.id + "/cancel", {
					method: "POST",
					body: { expected_revision: t.revision },
				});
				await load();
			}),
		);
	on("reduce-scope", async () => {
		if (!document.querySelector("#reduce-confirm").checked)
			throw Error("축소할 문의 범위를 확인해 주세요.");
		await api("/tasks/" + t.id, {
			method: "PATCH",
			body: { expected_revision: t.revision, scope_reduced: true },
		});
		await load();
	});
	on("compose", () => start("compose"));
	on("review", () => start("review"));
	on("analyze", () => start("analyze"));
	on("add-files", async () => {
		const files = [...document.querySelector("#more-files").files];
		if (!files.length) throw Error("파일을 선택하세요.");
		await upload(
			t.id,
			t.revision,
			files,
			document.querySelector("#more-csv-role").value,
		);
		await load();
	});
	on("skills-update", async () => {
		await api("/tasks/" + t.id, {
			method: "PATCH",
			body: { expected_revision: t.revision, skill_ids: [] },
		});
		await load();
	});
	document.querySelector("#new-recipient")?.addEventListener("change", (e) => {
		document.querySelector("#new-audience").value =
			e.target.value === "public" ? "public" : "named_external";
	});
	on("scope", async () => {
		await api("/tasks/" + t.id, {
			method: "PATCH",
			body: {
				expected_revision: t.revision,
				recipient_id: document.querySelector("#new-recipient").value,
				audience: document.querySelector("#new-audience").value,
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
				kind: document.querySelector("#manual-kind").value,
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
