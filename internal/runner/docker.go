// Package runner executes only prepared, digest-pinned tools in a Docker sandbox.
package runner

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"safehandoff.local/poc/internal/domain"
	"strings"
	"time"
)

type Registration struct {
	Image      string `json:"image"`
	Executable string `json:"executable"`
	BinarySHA  string `json:"binary_sha256"`
}
type bounded struct {
	b        bytes.Buffer
	limit    int
	overflow bool
}

func (b *bounded) Write(p []byte) (int, error) {
	n := len(p)
	if b.b.Len()+n > b.limit {
		b.overflow = true
		p = p[:max(0, b.limit-b.b.Len())]
	}
	b.b.Write(p)
	return n, nil
}
func Available() bool {
	ctx, c := context.WithTimeout(context.Background(), 2*time.Second)
	defer c()
	return exec.CommandContext(ctx, "docker", "info", "--format", "{{.ServerVersion}}").Run() == nil
}
func Process(ctx context.Context, reg Registration, input []byte) ([]byte, error) {
	if !strings.HasPrefix(reg.Image, "sha256:") || reg.Executable != "/checker" {
		return nil, errors.New("UNREGISTERED_TOOL")
	}
	b, e := os.ReadFile("bin/safehandoff-checker")
	if e != nil || domain.Hash(b) != reg.BinarySHA {
		return nil, errors.New("TARGET_DIGEST_MISMATCH")
	}
	ctx, c := context.WithTimeout(ctx, 15*time.Second)
	defer c()
	name := "safehandoff-" + domain.ID("run")
	defer func() {
		cleanup, c := context.WithTimeout(context.Background(), 3*time.Second)
		defer c()
		exec.CommandContext(cleanup, "docker", "rm", "-f", name).Run()
	}()
	cmd := exec.CommandContext(ctx, "docker", "run", "--rm", "--pull=never", "--name", name, "--network=none", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=33554432", "--user", "65532:65532", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--cpus=1", "--memory=256m", "--pids-limit=64", "-i", reg.Image, reg.Executable)
	cmd.Stdin = bytes.NewReader(input)
	out := &bounded{limit: 65536}
	errout := &bounded{limit: 65536}
	cmd.Stdout = out
	cmd.Stderr = errout
	if e := cmd.Run(); e != nil {
		if ctx.Err() != nil {
			return nil, errors.New("TOOL_TIMEOUT")
		}
		return nil, errors.New("TOOL_ENVIRONMENT_UNAVAILABLE")
	}
	if out.overflow || errout.overflow {
		return nil, errors.New("TOOL_OUTPUT_LIMIT")
	}
	return out.b.Bytes(), nil
}
