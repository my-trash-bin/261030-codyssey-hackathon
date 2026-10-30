// Package tools contains registered deterministic transformations and context checks.
package tools

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"net/netip"
	"safehandoff.local/poc/internal/domain"
)

type ContextRequest struct {
	Schema     string          `json:"schema_version"`
	FindingID  string          `json:"finding_id"`
	SetHash    string          `json:"artifact_set_hash"`
	Detector   string          `json:"detector_id"`
	Field      string          `json:"field_path"`
	Provenance string          `json:"provenance"`
	Product    string          `json:"product_id"`
	RuleActive bool            `json:"rule_active"`
	Config     json.RawMessage `json:"config"`
}
type ContextResult struct {
	Schema    string `json:"schema_version"`
	FindingID string `json:"finding_id"`
	SetHash   string `json:"artifact_set_hash"`
	Status    string `json:"status"`
	Reason    string `json:"reason_code"`
}
type ConfigExample struct {
	Upstreams []struct {
		ID      string `json:"id"`
		Address string `json:"address"`
	} `json:"upstreams"`
	Route struct {
		UpstreamID string `json:"upstream_id"`
	} `json:"route"`
}

func CheckContext(q ContextRequest) ContextResult {
	r := ContextResult{Schema: "context_check.v1", FindingID: q.FindingID, SetHash: q.SetHash, Status: "denied", Reason: "CONTEXT_MISMATCH"}
	if q.Schema != "context_check_request.v1" || q.FindingID == "" || q.SetHash == "" {
		r.Status = "error"
		r.Reason = "TOOL_SCHEMA_INVALID"
		return r
	}
	if q.Detector != "ip.v1" || q.Field != "/upstreams/0/address" || q.Provenance != "make_config_example_v1:generated_config" || q.Product != "vendorstore-lab" || !q.RuleActive {
		return r
	}
	var c ConfigExample
	if domain.Strict(q.Config, &c) != nil {
		r.Status = "unknown"
		r.Reason = "CONFIG_PARSE_FAILED"
		return r
	}
	if len(c.Upstreams) != 1 || c.Upstreams[0].ID == "" || c.Route.UpstreamID != c.Upstreams[0].ID {
		r.Reason = "BROKEN_CONFIG_REFERENCE"
		return r
	}
	ip, e := netip.ParseAddr(c.Upstreams[0].Address)
	if e != nil {
		return r
	}
	for _, block := range []string{"192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24"} {
		if netip.MustParsePrefix(block).Contains(ip) {
			r.Status = "allowed"
			r.Reason = "APPROVED_DOCUMENTATION_ADDRESS_IN_GENERATED_CONFIG"
			return r
		}
	}
	return r
}
func ValidateContextResult(q ContextRequest, r ContextResult) error {
	if r.Schema != "context_check.v1" || r.FindingID != q.FindingID || r.SetHash != q.SetHash {
		return errors.New("TOOL_SCHEMA_INVALID")
	}
	if r.Status != "allowed" && r.Status != "denied" && r.Status != "unknown" && r.Status != "error" {
		return errors.New("TOOL_SCHEMA_INVALID")
	}
	return nil
}
func Synthetic(seed uint64, n int) ([]byte, []byte, error) {
	if n < 1 || n > 8 {
		return nil, nil, errors.New("INVALID_INPUT_LENGTH")
	}
	rng := rand.New(rand.NewPCG(seed, 41))
	ascii := make([]rune, n)
	multi := make([]rune, n)
	for i := range ascii {
		ascii[i] = rune('A' + rng.IntN(26))
		multi[i] = rune(0xac00 + rng.IntN(11172))
	}
	a, _ := json.Marshal(map[string]string{"value": string(ascii)})
	b, _ := json.Marshal(map[string]string{"value": string(multi)})
	return append(a, '\n'), append(b, '\n'), nil
}
func DirectionLabels(n int) string { return fmt.Sprintf("observation-%d", n) }
