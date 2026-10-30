package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"safehandoff.local/toyrecord/target"
)

func main() {
	inputs := flag.String("inputs", "./inputs", "합성 입력 폴더")
	flag.Parse()
	dir, e := os.MkdirTemp("", "toyrecord-")
	if e != nil {
		panic(e)
	}
	defer os.RemoveAll(dir)
	status := "reproduced"
	results := []target.Result{}
	for _, version := range []string{"buggy", "fixed"} {
		bin := filepath.Join(dir, version)
		c := exec.Command("go", "build", "-o", bin, "./cmd/"+version)
		c.Env = append(os.Environ(), "GOTOOLCHAIN=local", "GOPROXY=off")
		if out, e := c.CombinedOutput(); e != nil {
			fmt.Fprintln(os.Stderr, string(out))
			os.Exit(3)
		}
		for _, name := range []string{"ascii.json", "multibyte.json"} {
			input, e := os.ReadFile(filepath.Join(*inputs, name))
			if e != nil {
				panic(e)
			}
			outDir, e := os.MkdirTemp(dir, "run-")
			if e != nil {
				panic(e)
			}
			out, err := exec.Command(bin, filepath.Join(*inputs, name), outDir).Output()
			var r target.Result
			if json.Unmarshal(out, &r) != nil {
				status = "error"
			}
			wantErr := version == "buggy" && name == "multibyte.json"
			if wantErr {
				exit, ok := err.(*exec.ExitError)
				if !ok || exit.ExitCode() != 2 || r.Stage != "encode" || r.Code == nil || *r.Code != "E_ENCODE_SHORT_BUFFER" {
					status = "inconclusive"
				}
				if _, e := os.Stat(filepath.Join(outDir, "result.bin")); !os.IsNotExist(e) {
					status = "error"
				}
			} else {
				var v struct {
					Value string `json:"value"`
				}
				json.Unmarshal(input, &v)
				data, e := os.ReadFile(filepath.Join(outDir, "result.bin"))
				if err != nil || e != nil || r.Status != "ok" || !bytes.Equal(data, []byte(v.Value)) {
					status = "inconclusive"
				}
			}
			results = append(results, r)
		}
	}
	json.NewEncoder(os.Stdout).Encode(map[string]any{"schema_version": "repro_result.v1", "status": status, "runs": results})
	if status != "reproduced" {
		os.Exit(1)
	}
}
