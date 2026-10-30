let csrf = "";
export const esc = (s) =>
	String(s ?? "").replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			],
	);
export const text = (b) =>
	new TextDecoder().decode(
		Uint8Array.from(atob(b || ""), (c) => c.charCodeAt(0)),
	);

export async function api(path, options = {}) {
	let h = {};
	if (options.method && options.method !== "GET") {
		h = { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() };
		if (!(options.body instanceof FormData)) {
			h["Content-Type"] = "application/json";
			options.body = JSON.stringify(options.body);
		}
	}
	const request = new Request(new URL("/api/v1" + path, location.origin), {
		...options,
		headers: h,
	});
	let r, v;
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			r = await fetch(request.clone());
			v = await r.json();
			break;
		} catch (error) {
			if (attempt === 1) throw error;
		}
	}

	if (!r.ok) throw Error(v.error?.code || r.status);
	return v.data;
}
export function notice(s) {
	const n = document.querySelector("#notice");
	n.textContent = s;
	n.style.display = "block";
	setTimeout(() => (n.style.display = "none"), 6000);
}
export function on(id, fn) {
	document.getElementById(id)?.addEventListener("click", async (e) => {
		const b = e.currentTarget;
		b.disabled = true;
		try {
			await fn(e);
		} catch (err) {
			notice(err.message);
		} finally {
			b.disabled = false;
		}
	});
}
export async function upload(id, rev, files) {
	const form = new FormData();
	const items = [];
	files.forEach((f, i) => {
		const key = "file" + i;
		let format = f.name.split(".").pop().toLowerCase();
		if (format === "text") format = "txt";
		items.push({
			client_key: key,
			display_name: f.name,
			format,
			source_slot: format === "csv" ? "requests_v1" : "notes",
		});
		form.append(key, f);
	});
	form.append("meta", JSON.stringify({ expected_revision: rev, items }));
	return api(`/tasks/${id}/source-batches`, { method: "POST", body: form });
}

export async function session() {
	csrf = (await api("/session")).csrf_token;
}
