package runner

import "testing"

func TestOracleDoesNotCountOtherErrors(t *testing.T) {
	success := RunObservation{Exit: 0, OutputExists: true, OutputMatches: true, Result: TargetRun{Schema: "target_run.v1", Status: "ok", Stage: "persist"}}
	code := "E_INPUT_LIMIT"
	bad := RunObservation{Exit: 2, Result: TargetRun{Schema: "target_run.v1", Status: "domain_error", Stage: "validate", Code: &code}}
	runs := []RunObservation{success, bad, success, success}
	status, _ := Oracle(runs)
	if status != "inconclusive" {
		t.Fatal(status)
	}
	runs[0] = bad
	status, reason := Oracle(runs)
	if status != "inconclusive" || reason != "CONTROL_FAILED" {
		t.Fatal(status, reason)
	}
}
