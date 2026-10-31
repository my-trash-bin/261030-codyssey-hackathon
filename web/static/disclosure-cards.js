import { api, esc, text, notice, on } from "./api.js";

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
export function bindDisclosureCards({ t, rulesCache, load, setInterpreting }) {
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
				setInterpreting(true);
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
					setInterpreting(false);
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
}
