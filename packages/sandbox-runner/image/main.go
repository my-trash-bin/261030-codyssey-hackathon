// Fixed toy target and file-observing supervisor. Build offline with CGO_ENABLED=0.
package main

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"unicode/utf8"
)

type result struct {
	Schema string  `json:"schema_version"`
	Status string  `json:"status"`
	Stage  string  `json:"stage"`
	Code   *string `json:"code"`
}

func outcome(status, stage, code string) result {
	r := result{Schema: "target_run.v1", Status: status, Stage: stage}
	if code != "" {
		r.Code = &code
	}
	return r
}
func target(mode string, input []byte) {
	emit := func(r result, exit int) { json.NewEncoder(os.Stdout).Encode(r); os.Exit(exit) }
	if !json.Valid(input) {
		emit(outcome("domain_error", "parse", "E_INPUT_PARSE"), 2)
	}
	decoder := json.NewDecoder(bytes.NewReader(input))
	opening, _ := decoder.Token()
	if opening != json.Delim('{') {
		emit(outcome("domain_error", "validate", "E_INPUT_LIMIT"), 2)
	}
	fields := map[string]json.RawMessage{}
	for decoder.More() {
		key, _ := decoder.Token()
		name := key.(string)
		if _, exists := fields[name]; exists {
			emit(outcome("domain_error", "parse", "E_INPUT_PARSE"), 2)
		}
		var raw json.RawMessage
		if decoder.Decode(&raw) != nil {
			emit(outcome("domain_error", "parse", "E_INPUT_PARSE"), 2)
		}
		fields[name] = raw
	}
	decoder.Token()
	var value string
	if len(fields) != 1 || json.Unmarshal(fields["value"], &value) != nil || utf8.RuneCountInString(value) < 1 || utf8.RuneCountInString(value) > 8 {
		emit(outcome("domain_error", "validate", "E_INPUT_LIMIT"), 2)
	}
	if mode == "buggy" && len([]byte(value)) > utf8.RuneCountInString(value) {
		emit(outcome("domain_error", "encode", "E_ENCODE_SHORT_BUFFER"), 2)
	}
	if os.WriteFile("/out/result.bin", []byte(value), 0600) != nil {
		emit(outcome("execution_error", "persist", "E_EXECUTION"), 3)
	}
	emit(outcome("ok", "persist", ""), 0)
}
func main() {
	input, err := io.ReadAll(io.LimitReader(os.Stdin, 1025))
	if err != nil || len(input) > 1024 || len(os.Args) != 2 || (os.Args[1] != "buggy" && os.Args[1] != "fixed" && os.Args[1] != "target-buggy" && os.Args[1] != "target-fixed") {
		os.Exit(3)
	}
	mode := os.Args[1]
	if mode == "target-buggy" || mode == "target-fixed" {
		target(mode[7:], input)
		return
	}
	// The target is this registered fixed executable, never model-supplied code.
	cmd := exec.Command("/repro", "target-"+mode)
	cmd.Env = []string{}
	cmd.Stdin = bytes.NewReader(input)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()
	exit := 0
	if runErr != nil {
		if e, ok := runErr.(*exec.ExitError); ok {
			exit = e.ExitCode()
		} else {
			os.Exit(3)
		}
	}
	var r result
	if stdout.Len() > 65536 || stderr.Len() > 65536 || json.Unmarshal(stdout.Bytes(), &r) != nil {
		os.Exit(3)
	}
	var output *[]byte
	info, err := os.Lstat("/out/result.bin")
	if err == nil {
		if !info.Mode().IsRegular() || info.Size() > 65536 {
			os.Exit(3)
		}
		data, e := os.ReadFile("/out/result.bin")
		if e != nil {
			os.Exit(3)
		}
		output = &data
	} else if !os.IsNotExist(err) {
		os.Exit(3)
	}
	json.NewEncoder(os.Stdout).Encode(struct {
		Schema string  `json:"schema_version"`
		Result result  `json:"result"`
		Exit   int     `json:"exit_code"`
		Output *[]byte `json:"output_bytes"`
	}{"sandbox_observation.v1", r, exit, output})
}
