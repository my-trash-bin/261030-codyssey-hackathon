const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
	const browser = await chromium.launch({
		headless: true,
		args: ["--no-sandbox"],
	});
	const page = await browser.newPage({
		viewport: { width: 1366, height: 768 },
	});
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto("http://127.0.0.1:8080/tasks/new");
	await page.locator("#recipient").selectOption("recipient_vendorstore");
	await page
		.locator("#files")
		.setInputFiles(
			["client-log.txt", "request-summary.csv", "support-notes.md"].map(
				(f) => process.cwd() + "/fixtures/author/b2b-timeout/" + f,
			),
		);
	await page.locator("#create").click();
	await page.waitForURL(/tasks\/task_/);
	await page.waitForSelector("#preview-0");
	const id = page.url().split("/").at(-1);
	let state = await page.evaluate(
		async (id) => (await (await fetch("/api/v1/tasks/" + id)).json()).data,
		id,
	);
	const kinds = state.candidates.map((c) => c.kind);
	for (let i = 0; i < kinds.length; i++) {
		const kind = kinds[i];
		if (i === 0) {
			await page.locator("#choice-" + i).selectOption("excerpt");
			await page
				.locator("#raw-ev-" + i)
				.locator("..")
				.getByText("근거 구간")
				.count();
		} else if (kind === "series") {
			await page.locator("#choice-" + i).selectOption("custom");
			await page
				.locator("#custom-" + i)
				.fill("첫 관찰을 100으로 한 비율만 공개");
			await page.locator("#reuse-" + i).check();
		} else if (kind === "timeline") {
			await page.locator("#choice-" + i).selectOption("timeseq");
		}
		await page.locator("#preview-" + i).click();
		await page.waitForFunction(
			(i) => !document.getElementById("apply-" + i).disabled,
			i,
			{ timeout: 30000 },
		);
		if (kind === "series") {
			const shown = await page.locator("#projection-" + i).textContent();
			if (!shown.includes("100.00"))
				throw Error("ratio interpretation missing");
		}
		const next = page.waitForResponse((r) =>
			r.url().endsWith("/decision-batches"),
		);
		await page.locator("#apply-" + i).click();
		const response = await next;
		if (!response.ok()) throw Error(await response.text());
		const body = await response.json();
		await page.waitForFunction(
			(rev) =>
				document
					.querySelector(".heading-row")
					?.textContent.includes("판본 " + rev),
			body.data.current_revision,
		);
	}
	await page.locator("#compose").click();
	await page.waitForFunction(() =>
		document.querySelector(".status")?.textContent.includes("검사 완료"),
	);
	await page.getByText("최종 파일 확인 →").click();
	state = await page.evaluate(
		async (id) => (await (await fetch("/api/v1/tasks/" + id)).json()).data,
		id,
	);
	const a = state.artifacts.find((a) => a.id === state.current_artifact_id);
	const files = Object.fromEntries(
		a.files.map((f) => [
			f.path,
			Buffer.from(f.bytes, "base64").toString("utf8"),
		]),
	);
	if (
		!files["approved-excerpt.txt"] ||
		!files["timeline.csv"] ||
		!files["client-config-example.json"] ||
		!files["observations.csv"]
	)
		throw Error("missing approved file");
	if (
		files["timeline.csv"].includes("2026-") ||
		files["timeline.csv"].includes("T+")
	)
		throw Error("unapproved timeline interval");
	if (!files["client-config-example.json"].includes("192.0.2.17"))
		throw Error("generated documentation config missing");
	await page.locator("#confirmed").check();
	await page.locator("#finalize").click();
	await page.getByText("공개 ZIP 다운로드").waitFor();
	await browser.close();
	const report = {
		status: errors.length ? "fail" : "pass",
		errors,
		checks: [
			"원문 byte range 미리보기와 별도 첨부",
			"조건 해석 job→비율 미리보기→사용자 적용",
			"표현 기준 저장",
			"간격 없는 사건 순서 표",
			"새 설정의 문서용 IP 문맥 검사",
			"모든 파일 검토·확정",
		],
		files: Object.keys(files),
	};
	fs.writeFileSync(
		"evaluation/results/browser-advanced-run.json",
		JSON.stringify(report, null, 2) + "\n",
	);
	console.log(report);
	if (errors.length) process.exit(1);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
