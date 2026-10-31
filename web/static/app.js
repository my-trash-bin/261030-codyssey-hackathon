import { renderWorkspace } from "./workspace.js";
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
	hypothesis: "추정",
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
				(v) =>
					`<option value="${esc(v.id)}" ${v.id === "recipient_vendorstore" ? "selected" : ""}>${esc(v.display_name)}</option>`,
			)
			.join("");
	root.innerHTML = `<div class="narrow"><div class="intro"><span class="badge">01 · 새 작업</span><h1>무엇을 공유하시나요?</h1><p class="muted">자료를 추가해도 공개가 승인되지는 않습니다. 다음 단계에서 공개할 내용을 선택합니다.</p></div><form id="new" class="panel"><div class="form-grid"><div><label for="title">내부 작업 이름</label><input id="title" required value="공급사 문의 준비"><label for="project">프로젝트</label><select id="project">${options("project")}</select><label for="purpose">공유 목적</label><select id="purpose"><option value="vendor_support">공급사 문의</option><option value="oss_issue">오픈소스 버그 제보</option><option value="operations_advice">외부 운영 자문</option></select></div><div><label for="recipient">수신자</label><select id="recipient">${options("recipient")}</select><label for="audience">공개 범위</label><select id="audience"><option value="named_external">지정 외부 수신자</option><option value="public">전체 공개</option></select><label for="language">결과 언어</label><select id="language"><option value="ko">한국어</option><option value="en">English (live 모델)</option></select></div><div class="wide"><details><summary>새 프로젝트·수신자 등록</summary><label for="project-name">새 프로젝트 이름 (내부 전용)</label><input id="project-name"><button type="button" id="add-project">프로젝트 등록</button><label for="recipient-name">새 외부 수신자 이름 (내부 전용)</label><input id="recipient-name"><button type="button" id="add-recipient">수신자 등록</button></details><label for="csv-role">CSV 자료의 역할</label><select id="csv-role"><option value="requests_v1">요청량 관찰 · 검증된 열에서만 표현 기준 재사용</option><option value="generic">일반 자료 · 수치 기준 자동 재사용 안 함</option></select><label for="files">자료 파일 (UTF-8 txt, log, md, csv, json)</label><input id="files" type="file" multiple accept=".txt,.log,.md,.csv,.json"><label for="paste">또는 텍스트 붙여넣기</label><textarea id="paste" placeholder="사내 자료를 입력하세요"></textarea><p class="muted">파일당 256 KiB · 최대 10개 · 전체 1 MiB. 모델 입력 크기 제한은 별도입니다.</p></div></div><button class="primary" id="create">작업 만들기 및 자료 분석</button><p id="form-error" role="alert"></p></form></div>`;

	for (const [kind, input, select, button] of [
		["projects", "project-name", "project", "add-project"],
		["recipients", "recipient-name", "recipient", "add-recipient"],
	])
		on(button, async () => {
			const name = document.getElementById(input).value.trim();
			if (!name) throw Error("등록할 이름을 입력하세요.");
			const created = await api("/catalog/" + kind, {
				method: "POST",
				body: { display_name: name },
			});
			document
				.getElementById(select)
				.add(new Option(name, created.id, true, true));
			if (kind === "recipients")
				document.getElementById("audience").value = "named_external";
			notice("등록한 항목을 선택했습니다.");
		});
	document.getElementById("recipient").addEventListener("change", (e) => {
		document.getElementById("audience").value =
			e.target.value === "public" ? "public" : "named_external";
	});
	document.getElementById("purpose").addEventListener("change", (e) => {
		if (e.target.value === "oss_issue") {
			document.getElementById("recipient").value = "public";
			document.getElementById("audience").value = "public";
		}
	});
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
				const res = await upload(t.id, rev, files, v("csv-role"));
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
			if (interpreting) return;
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
 renderWorkspace({ task, rulesCache, catalogCache, root, entityName, load, start,
  setInterpreting(value) { interpreting = value; },
  purposeNames, kindNames, decisionNames, jobNames, jobStates, reproNames, reproReasons, phases });
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
	root.innerHTML = `<div class="narrow"><span class="badge">03 · 최종 확인</span><h1>이 파일들을 공유합니다</h1><p><a href="/tasks/${t.id}">← 공개 선택으로 돌아가기</a></p><div class="status">${esc(phases[t.phase])} · 판본 ${t.revision}</div><p>목적: ${esc(purposeNames[t.scope.purpose_id] || t.scope.purpose_id)} / 수신자: ${esc(entityName(t.scope.recipient_id))} / 범위: ${t.scope.audience === "public" ? "전체 공개" : "지정 외부 수신자"}</p><p>재현: ${t.reproduction.revision && t.reproduction.revision !== t.revision ? "이전 판본의 참고 기록 · " : ""}${esc(reproNames[t.reproduction.status] || t.reproduction.status)} (${esc(reproReasons[t.reproduction.reason_code] || t.reproduction.reason_code)}). 실제 재현 성공을 뜻하지 않습니다.</p>${a ? `<section class="panel"><h2>실제 저장 파일</h2><p class="muted">아래 내용과 해시를 확인하세요. 확정 후에도 승인 상태가 바뀌면 다운로드가 차단됩니다.</p>${a.files.map((f) => `<article class="file"><strong>${esc(f.path)}</strong> · ${f.size} B<details><summary>실제 파일 내용 및 SHA-256</summary><pre>${esc(f.sha256)}\n\n${esc(text(f.bytes))}</pre></details>${t.export_id ? `<a class="button" href="/api/v1/exports/${t.export_id}/files/${f.id}">파일 다운로드</a>` : ""}</article>`).join("")}<p>파일 집합 해시</p><pre>${esc(a.artifact_set_hash)}</pre>${a.status === "blocked" ? `<details><summary>사람 의미 검토로 전환</summary><p>실제 파일의 미승인 정보·추가 단정·누락된 제약을 확인하세요. 승인과 판본 및 파일 검사는 생략할 수 없습니다.</p><textarea id="human-reason" placeholder="모델 검토를 대신한 사유와 확인 내용"></textarea><button id="human">이 파일 해시에 사람 검토 기록</button></details>` : ""}<label><input type="checkbox" id="confirmed">실제 파일과 현재 공개 선택을 확인했습니다.</label><div class="actions"><button class="primary" id="finalize" ${t.phase !== "ready_to_finalize" ? "disabled" : ""}>이 파일들로 확정</button>${t.export_id ? `<a class="button primary" href="/api/v1/exports/${t.export_id}/archive">공개 ZIP 다운로드</a><button id="copy">본문 복사</button>` : ""}</div><p class="muted">검사 미완료 또는 보류·만료·철회가 있으면 확정할 수 없습니다.</p></section>` : '<p class="warn">현재 선택에 유효한 결과가 없습니다. 공개 선택 화면에서 다시 작성하세요.</p>'}</div>`;
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
	const latestByID = new Map();
	for (const rule of rules) {
		if (
			!latestByID.has(rule.id) ||
			latestByID.get(rule.id).version < rule.version
		)
			latestByID.set(rule.id, rule);
	}
	const currentRules = [...latestByID.values()];
	root.innerHTML = `<div class="intro"><span class="badge">작업 기록</span><h1>공유를 준비한 기록</h1><p class="muted">과거 결과는 내부 참고용입니다. 현재 승인 상태를 확인한 뒤 파일을 확정하세요.</p><a class="button primary" href="/tasks/new">+ 새 작업</a></div><div class="history">${ts.map((t) => `<a class="card" href="/tasks/${t.id}"><span class="badge">${esc(t.provider_mode)}</span><h2>${esc(t.internal_title)}</h2><p>${esc(phases[t.phase])} · r${t.revision}</p><small>${esc(purposeNames[t.scope.purpose_id] || t.scope.purpose_id)} / ${esc(entityName(t.scope.recipient_id))}</small></a>`).join("") || "<p>아직 작업이 없습니다.</p>"}</div><section class="panel"><h2>저장한 표현 기준</h2>${currentRules.map((r, i) => `<div class="rule"><strong>${esc(r.scope.project_id)}의 ${esc(r.scope.recipient_id)} 문의</strong> · ${esc(r.representation.transform_id || r.representation.kind)}<p>${esc(r.selector)} · v${r.version} · ${r.revoked ? "철회됨" : r.expires_at && Date.parse(r.expires_at) < Date.now() ? "만료됨" : "활성"}</p><button id="rule-${i}" ${r.revoked ? "disabled" : ""}>기준 철회</button></div>`).join("") || '<p class="muted">재사용 가능한 표현 기준을 저장하면 여기에 표시됩니다. 정확한 값 승인은 재사용되지 않습니다.</p>'}</section>`;
	currentRules.forEach((r, i) =>
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
