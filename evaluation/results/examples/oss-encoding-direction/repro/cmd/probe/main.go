// probe is a fixed runner inside the sandbox. It inspects actual output bytes.
package main

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"safehandoff.local/toyrecord/target"
)

func main() {
	if len(os.Args) != 2 || (os.Args[1] != "buggy" && os.Args[1] != "fixed") {
		os.Exit(3)
	}
	input, e := io.ReadAll(io.LimitReader(os.Stdin, 65537))
	if e != nil || len(input) > 65536 {
		os.Exit(3)
	}
	dir, e := os.MkdirTemp("/tmp", "probe-")
	if e != nil {
		os.Exit(3)
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "input.json")
	if os.WriteFile(path, input, 0600) != nil {
		os.Exit(3)
	}
	cmd := exec.Command("/"+os.Args[1], path, dir)
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = io.Discard
	err := cmd.Run()
	exit := 0
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			exit = ee.ExitCode()
		} else {
			os.Exit(3)
		}
	}
	var r target.Result
	if json.Unmarshal(stdout.Bytes(), &r) != nil {
		os.Exit(3)
	}
	data, e := os.ReadFile(filepath.Join(dir, "result.bin"))
	json.NewEncoder(os.Stdout).Encode(struct {
		Result target.Result `json:"result"`
		Exit   int           `json:"exit_code"`
		Exists bool          `json:"output_exists"`
		Bytes  []byte        `json:"output_bytes"`
	}{r, exit, e == nil, data})
}
