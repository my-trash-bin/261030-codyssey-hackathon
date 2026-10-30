package domain

import "testing"

func TestCSVAndJSONLocators(t *testing.T) {
	for _, s := range []Source{{ID: "csv", Format: "csv", Raw: []byte("\xef\xbb\xbfkey,value\r\nfirst,\"한글\n다음\"\r\n"), Included: true}, {ID: "json", Format: "json", Raw: []byte(`{"a/b":[{"~key":"한글"},2],"flag":true}`), Included: true}} {
		s.SHA = Hash(s.Raw)
		ev := EvidenceFor(s)
		if len(ev) == 0 {
			t.Fatal("no evidence")
		}
		task := Task{Sources: []Source{s}, Evidence: ev}
		for _, e := range ev {
			if err := ValidateEvidence(task, []string{e.ID}); err != nil {
				t.Fatal(e, err)
			}
		}
		if s.Format == "json" {
			found := false
			for _, e := range ev {
				found = found || e.Locator.Pointer == "/a~1b/0/~0key"
			}
			if !found {
				t.Fatal(ev)
			}
		}
	}
}
