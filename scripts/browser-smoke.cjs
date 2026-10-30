const { chromium } = require("playwright");
(async () => {
	const browser = await chromium.launch({
		headless: true,
		args: ["--no-sandbox"],
	});
	const page = await browser.newPage({
		viewport: { width: 1280, height: 720 },
	});
	const errors = [];
	let dropped = false;
	const retryPayloads = [];
	await page.route("**/api/v1/tasks/*/source-batches", async (route) => {
		const req = route.request();
		retryPayloads.push({
			key: req.headers()["idempotency-key"],
			bytes: req.postDataBuffer(),
		});
		const response = await route.fetch();
		if (!dropped) {
			dropped = true;
			await route.abort("failed");
		} else await route.fulfill({ response });
	});
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto("http://127.0.0.1:8080/tasks/new");
	await page
		.locator("#files")
		.setInputFiles([
			process.cwd() + "/fixtures/author/b2b-timeout/client-log.txt",
			process.cwd() + "/fixtures/author/b2b-timeout/request-summary.csv",
			process.cwd() + "/fixtures/author/b2b-timeout/support-notes.md",
		]);
	await page.locator("#recipient").selectOption("recipient_vendorstore");
	await page.locator("#create").click();
	await page.waitForURL(/tasks\/task_/);
	await page.waitForSelector("#preview-0");
	for (let i = 0; i < 6; i++) {
		if (!(await page.locator("#preview-" + i).count())) break;
		const s = page.locator("#choice-" + i);
		if (await s.locator("option[value=direction]").count())
			await s.selectOption("direction");
		await page.locator("#preview-" + i).click();
		await page.locator("#apply-" + i).waitFor({ state: "visible" });
		await page.waitForFunction(
			(i) => !document.getElementById("apply-" + i).disabled,
			i,
		);
		const response = page.waitForResponse((r) =>
			r.url().endsWith("/decision-batches"),
		);
		await page.locator("#apply-" + i).click();
		await response;
		await page.waitForTimeout(150);
	}
	await page.locator("#compose").click();
	await page.waitForFunction(() =>
		document.querySelector(".status")?.textContent.includes("검사 완료"),
	);
	const widths = [];
	for (const width of [1280, 1366]) {
		await page.setViewportSize({ width, height: width === 1280 ? 720 : 768 });
		widths.push(
			await page.evaluate(() => ({
				width: innerWidth,
				scroll: document.documentElement.scrollWidth,
			})),
		);
	}
	await page.screenshot({
		path: process.cwd() + "/evaluation/results/workspace.png",
		fullPage: true,
	});
	await page.getByText("최종 파일 확인 →").click();
	await page.locator("#confirmed").check();
	await page.locator("#finalize").click();
	await page.getByText("공개 ZIP 다운로드").waitFor();
	await page.reload();
	await page.getByText("공개 ZIP 다운로드").waitFor();
	const [dl] = await Promise.all([
		page.waitForEvent("download"),
		page.getByText("공개 ZIP 다운로드").click(),
	]);
	await dl.saveAs("/tmp/safehandoff-browser/browser-public.zip");
	await page.goto("http://127.0.0.1:8080/history");
	await page.locator(".history .card").first().waitFor();
	await browser.close();
	if (
		retryPayloads.length !== 2 ||
		retryPayloads[0].key !== retryPayloads[1].key ||
		!retryPayloads[0].bytes.equals(retryPayloads[1].bytes)
	)
		throw Error("multipart retry changed its key or bytes");
	const report = {
		status:
			errors.length || widths.some((w) => w.scroll > w.width) ? "fail" : "pass",
		widths,
		errors,
		download: dl.suggestedFilename(),
		multipart_retry: {
			attempts: retryPayloads.length,
			same_key: true,
			same_bytes: true,
		},
		checks: [
			"업로드",
			"분석",
			"미리보기 확인 후 개별 공개 선택",
			"작성 중 검토 및 최종 검사",
			"두 화면 너비",
			"확정",
			"새로고침 복원",
			"ZIP 다운로드",
			"작업 기록",
		],
	};
	require("fs").writeFileSync(
		process.cwd() + "/evaluation/results/browser-run.json",
		JSON.stringify(report, null, 2) + "\n",
	);
	console.log(report);
	if (report.status !== "pass") process.exit(1);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
