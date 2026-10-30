package main

import (
	"encoding/json"
	"io"
	"os"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/internal/tools"
)

func main() {
	b, e := io.ReadAll(io.LimitReader(os.Stdin, 262145))
	var q tools.ContextRequest
	if e != nil || domain.Strict(b, &q) != nil {
		json.NewEncoder(os.Stdout).Encode(tools.ContextResult{Schema: "context_check.v1", Status: "error", Reason: "TOOL_SCHEMA_INVALID"})
		os.Exit(1)
	}
	json.NewEncoder(os.Stdout).Encode(tools.CheckContext(q))
}
