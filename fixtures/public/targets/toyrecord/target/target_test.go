package target

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOracle(t *testing.T) {
	for _, v := range []struct{ input, stage, code string }{{`{"value":"ABCDEF"}`, "persist", ""}, {`{"value":"가나다라마바"}`, "encode", "E_ENCODE_SHORT_BUFFER"}, {`{"value":"ABCDEFGHI"}`, "validate", "E_INPUT_LIMIT"}, {`{`, "parse", "E_INPUT_PARSE"}, {`{"value":"a","value":"b"}`, "parse", "E_INPUT_PARSE"}, {`{"value":null}`, "parse", "E_INPUT_PARSE"}, {`{"value":""}`, "validate", "E_INPUT_LIMIT"}} {
		for _, fixed := range []bool{false, true} {
			dir := t.TempDir()
			r, c := Run([]byte(v.input), dir, fixed)
			stage, code := v.stage, v.code
			if fixed && stage == "encode" {
				stage = "persist"
				code = ""
			}
			if r.Stage != stage {
				t.Fatal(r)
			}
			if code == "" {
				if c != 0 || r.Code != nil {
					t.Fatal(r, c)
				}
				if _, e := os.Stat(filepath.Join(dir, "result.bin")); e != nil {
					t.Fatal(e)
				}
			} else {
				if c != 2 || r.Code == nil || *r.Code != code {
					t.Fatal(r, c)
				}
				if _, e := os.Stat(filepath.Join(dir, "result.bin")); !os.IsNotExist(e) {
					t.Fatal("unexpected output")
				}
			}
		}
	}
}
