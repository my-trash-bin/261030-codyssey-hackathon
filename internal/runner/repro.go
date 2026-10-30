package runner

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"safehandoff.local/poc/internal/domain"
	"strings"
	"time"
	"unicode/utf8"
)

type TargetRun struct {
	Schema string  `json:"schema_version"`
	Status string  `json:"status"`
	Stage  string  `json:"stage"`
	Code   *string `json:"code"`
}
type RunObservation struct {
	Target        string    `json:"target"`
	Input         string    `json:"input"`
	Result        TargetRun `json:"result"`
	Exit          int       `json:"exit_code"`
	OutputExists  bool      `json:"output_exists"`
	OutputMatches bool      `json:"output_matches"`
}
type InputShape struct {
	Codepoints int    `json:"codepoints"`
	UTF8Bytes  int    `json:"utf8_bytes"`
	SHA        string `json:"sha256"`
}
type InputShapes struct {
	ASCII     InputShape `json:"ascii"`
	Multibyte InputShape `json:"multibyte"`
}
type Repro struct {
	Seed             *uint64          `json:"seed"`
	TargetPairDigest string           `json:"target_pair_digest"`
	InputSetSHA      string           `json:"input_set_sha256"`
	Inputs           InputShapes      `json:"inputs"`
	Schema           string           `json:"schema_version"`
	Status           string           `json:"status"`
	Reason           string           `json:"reason_code"`
	Runs             []RunObservation `json:"runs"`
}
type TargetRegistration struct {
	Image      string `json:"image"`
	BuggySHA   string `json:"buggy_sha256"`
	FixedSHA   string `json:"fixed_sha256"`
	PairDigest string `json:"target_pair_digest"`
}

func RunRepro(ctx context.Context, reg TargetRegistration, ascii, multi []byte) Repro {
	r := Repro{TargetPairDigest: reg.PairDigest, InputSetSHA: domain.Hash(domain.Canonical([]string{domain.Hash(ascii), domain.Hash(multi)})), Inputs: DescribeInputs(ascii, multi), Schema: "repro_result.v1", Status: "error", Reason: "TARGET_DIGEST_MISMATCH", Runs: []RunObservation{}}
	for path, sha := range map[string]string{"bin/toy-buggy": reg.BuggySHA, "bin/toy-fixed": reg.FixedSHA} {
		b, e := os.ReadFile(path)
		if e != nil || domain.Hash(b) != sha {
			return r
		}
	}
	if !strings.HasPrefix(reg.Image, "sha256:") || domain.Hash([]byte(reg.BuggySHA+":"+reg.FixedSHA)) != reg.PairDigest {
		return r
	}
	if !Available() {
		r.Status = "not_run"
		r.Reason = "no_environment"
		return r
	}
	ctx, c := context.WithTimeout(ctx, 15*time.Second)
	defer c()
	for _, version := range []string{"buggy", "fixed"} {
		for i, input := range [][]byte{ascii, multi} {
			obs, e := target(ctx, reg.Image, version, input, i)
			if e != nil {
				r.Reason = e.Error()
				return r
			}
			r.Runs = append(r.Runs, obs)
		}
	}
	r.Status, r.Reason = Oracle(r.Runs)
	return r
}
func target(ctx context.Context, image, version string, input []byte, which int) (RunObservation, error) {
	o := RunObservation{Target: version, Input: []string{"ascii", "multibyte"}[which]}
	name := domain.ID("safehandoff")
	defer func() {
		cleanup, c := context.WithTimeout(context.Background(), 3*time.Second)
		defer c()
		exec.CommandContext(cleanup, "docker", "rm", "-f", name).Run()
	}()
	cmd := exec.CommandContext(ctx, "docker", "run", "--rm", "--pull=never", "--name", name, "--network=none", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=33554432", "--user", "65532:65532", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--cpus=1", "--memory=256m", "--pids-limit=64", "-i", image, "/probe", version)
	cmd.Stdin = bytes.NewReader(input)
	stdout := &bounded{limit: 65536}
	stderr := &bounded{limit: 65536}
	cmd.Stdout = stdout
	cmd.Stderr = stderr

	e := cmd.Run()
	if ctx.Err() != nil {
		return o, errors.New("TOOL_TIMEOUT")
	}
	if e != nil {
		return o, errors.New("TOOL_EXECUTION_FAILED")
	}
	var wire struct {
		Result TargetRun `json:"result"`
		Exit   int       `json:"exit_code"`
		Exists bool      `json:"output_exists"`
		Bytes  []byte    `json:"output_bytes"`
	}
	if stdout.overflow || stderr.overflow || domain.Strict(stdout.b.Bytes(), &wire) != nil {
		return o, errors.New("TOOL_SCHEMA_INVALID")
	}
	o.Result = wire.Result
	o.Exit = wire.Exit
	o.OutputExists = wire.Exists
	var v struct {
		Value string `json:"value"`
	}
	if json.Unmarshal(input, &v) != nil {
		return o, errors.New("TOOL_SCHEMA_INVALID")
	}
	o.OutputMatches = wire.Exists && string(wire.Bytes) == v.Value
	if o.Result.Schema != "target_run.v1" || (o.Exit == 0 && (o.Result.Status != "ok" || o.Result.Stage != "persist" || o.Result.Code != nil)) || (o.Exit == 2 && o.Result.Status != "domain_error") || (o.Exit != 0 && o.Exit != 2) {
		return o, errors.New("TOOL_SCHEMA_INVALID")
	}

	return o, nil
}
func Oracle(r []RunObservation) (string, string) {
	if len(r) != 4 {
		return "inconclusive", "INCOMPLETE_OBSERVATION"
	}
	for _, i := range []int{0, 2} {
		if r[i].Result.Status != "ok" || !r[i].OutputMatches || r[i].Exit != 0 {
			return "inconclusive", "CONTROL_FAILED"
		}
	}
	if r[3].Result.Status != "ok" || r[3].Exit != 0 || !r[3].OutputMatches {
		return "inconclusive", "UNEXPECTED_TARGET_OUTCOME"
	}
	bug := r[1]
	if bug.Result.Status == "ok" && bug.OutputMatches {
		return "not_reproduced", "TARGET_NOT_OBSERVED"
	}
	if bug.Exit == 2 && bug.Result.Stage == "encode" && bug.Result.Code != nil && *bug.Result.Code == "E_ENCODE_SHORT_BUFFER" && !bug.OutputExists {
		return "reproduced", "EXPECTED_TARGET_OUTCOME"
	}
	return "inconclusive", "UNEXPECTED_TARGET_OUTCOME"
}

func DescribeInputs(ascii, multi []byte) InputShapes {
	shape := func(b []byte) InputShape {
		var v struct {
			Value string `json:"value"`
		}
		json.Unmarshal(b, &v)
		return InputShape{Codepoints: utf8.RuneCountInString(v.Value), UTF8Bytes: len(v.Value), SHA: domain.Hash(b)}
	}
	return InputShapes{ASCII: shape(ascii), Multibyte: shape(multi)}
}
