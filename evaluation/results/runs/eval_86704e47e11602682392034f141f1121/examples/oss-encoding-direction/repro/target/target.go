// Package target implements the intentionally defective and fixed public toy.
package target

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"unicode/utf8"
)

type Result struct {
	Schema string  `json:"schema_version"`
	Status string  `json:"status"`
	Stage  string  `json:"stage"`
	Code   *string `json:"code"`
}

func Run(input []byte, out string, fixed bool) (Result, int) {
	fail := func(stage, code string) (Result, int) {
		return Result{"target_run.v1", "domain_error", stage, &code}, 2
	}
	if !utf8.Valid(input) {
		return fail("parse", "E_INPUT_PARSE")
	}
	dec := json.NewDecoder(bytes.NewReader(input))
	tok, e := dec.Token()
	if e != nil || tok != json.Delim('{') {
		return fail("parse", "E_INPUT_PARSE")
	}
	seen := false
	value := ""
	for dec.More() {
		k, e := dec.Token()
		if e != nil || k != "value" || seen {
			return fail("parse", "E_INPUT_PARSE")
		}
		seen = true
		token, e := dec.Token()
		if e != nil {
			return fail("parse", "E_INPUT_PARSE")
		}
		var ok bool
		value, ok = token.(string)
		if !ok {
			return fail("parse", "E_INPUT_PARSE")
		}
	}
	if tok, e = dec.Token(); e != nil || tok != json.Delim('}') || !seen {
		return fail("parse", "E_INPUT_PARSE")
	}
	if _, e = dec.Token(); e != io.EOF {
		return fail("parse", "E_INPUT_PARSE")
	}
	n := utf8.RuneCountInString(value)
	if n < 1 || n > 8 {
		return fail("validate", "E_INPUT_LIMIT")
	}
	size := n
	if fixed {
		size = len(value)
	}
	if size < len(value) {
		return fail("encode", "E_ENCODE_SHORT_BUFFER")
	}
	buf := make([]byte, size)
	copy(buf, value)
	if os.WriteFile(filepath.Join(out, "result.bin"), buf, 0600) != nil {
		code := "E_EXECUTION"
		return Result{"target_run.v1", "execution_error", "persist", &code}, 3
	}
	return Result{"target_run.v1", "ok", "persist", nil}, 0
}
func Main(fixed bool) {
	executionError := func() {
		code := "E_EXECUTION"
		json.NewEncoder(os.Stdout).Encode(Result{"target_run.v1", "execution_error", "parse", &code})
		os.Exit(3)
	}
	if len(os.Args) != 3 {
		executionError()
		return
	}
	b, e := os.ReadFile(os.Args[1])
	if e != nil {
		executionError()
		return
	}
	r, code := Run(b, os.Args[2], fixed)
	json.NewEncoder(os.Stdout).Encode(r)
	os.Exit(code)
}
