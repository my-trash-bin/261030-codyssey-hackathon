#!/usr/bin/env python3
"""Explicit live-model smoke test, without web or the legacy workflow/DB."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="config.json")
    args = parser.parse_args()
    report = {"mode": "live", "transport": "CLI", "stages": {}, "status": "failed"}

    def invoke(action, payload):
        completed = subprocess.run(
            [str(ROOT / "bin/safehandoff-engine"), "--mode", "live", "--config", args.config,
             "--action", action], input=json.dumps(payload, ensure_ascii=False),
            text=True, capture_output=True, cwd=ROOT, timeout=300,
        )
        if completed.returncode:
            raise RuntimeError(f"{action}: {completed.stderr.strip()}")
        result = json.loads(completed.stdout)
        report["stages"][action] = "passed"
        return result

    try:
        analysis = invoke("analyze", {
            "purpose": "가상 공급사 기술지원 문의",
            "recipient": "지정 가상 공급사 Demo Support",
            "sources": [{"id": "sample", "name": "가상 관찰 메모", "text":
                         "모든 정보는 가상이다. 첫 API 요청에서 응답 대기 timeout을 관찰했고 "
                         "재시도에서 HTTP 200을 받았다. 첫 서버 처리와 중복 여부는 모른다. "
                         "공급사 환경이 없어 재현하지 않았다. 처리 결과와 안전한 재시도 조건을 묻고 싶다."}],
        })
        if not analysis["candidates"]:
            raise RuntimeError("분석 후보가 없습니다")
        # Explicit test-only human decisions. They are not model-approved facts.
        approved = {
            "purpose": "가상 공급사 기술지원 문의",
            "recipient": "지정 가상 공급사 Demo Support",
            "facts": [
                {"id": "observation", "text": "가상 사례에서 첫 요청은 응답 대기 timeout, 재시도는 HTTP 200을 관찰했다."},
                {"id": "unknown", "text": "첫 서버 처리 완료와 중복 여부는 모른다. 공급사 환경이 없어 재현하지 않았다."},
                {"id": "question", "text": "처리 결과 확인과 안전한 재시도 조건을 문의한다."},
            ],
        }
        result = invoke("generate", approved)
        if result["mode"] != "live" or not result["review"]["pass"]:
            raise RuntimeError("공유본의 실제 모델 검토가 통과하지 않았습니다")
        review = invoke("review", {**approved, "document": result["document"]})
        if not review["pass"]:
            raise RuntimeError("독립 재검토가 통과하지 않았습니다")
        report["analysis"] = analysis
        report["result"] = result
        report["status"] = "passed"
    except (RuntimeError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        report["error"] = str(error)
    destination = ROOT / ".local/test-results/engine-live.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(f"live engine: {report['status']} · {destination}")
    if "error" in report:
        print(report["error"], file=sys.stderr)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
