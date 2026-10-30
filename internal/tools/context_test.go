package tools

import (
	"safehandoff.local/poc/internal/domain"
	"testing"
)

func TestContextIsSpecific(t *testing.T) {
	q := ContextRequest{Schema: "context_check_request.v1", FindingID: "f", SetHash: "h", Detector: "ip.v1", Field: "/upstreams/0/address", Provenance: "make_config_example_v1:generated_config", Product: "vendorstore-lab", RuleActive: true, Config: []byte(`{"upstreams":[{"id":"primary","address":"192.0.2.17"}],"route":{"upstream_id":"primary"}}`)}
	if r := CheckContext(q); r.Status != "allowed" {
		t.Fatal(r)
	}
	r := CheckContext(q)
	r.FindingID = "other"
	if ValidateContextResult(q, r) == nil {
		t.Fatal("other finding accepted")
	}
	q.Provenance = "original_connection_log"
	if r := CheckContext(q); r.Status == "allowed" {
		t.Fatal(r)
	}
	q.Provenance = "make_config_example_v1:generated_config"
	q.Config = []byte(`{"upstreams":[{"id":"primary","address":"192.0.2.88"}],"route":{"upstream_id":"missing"}}`)
	if r := CheckContext(q); r.Status == "allowed" {
		t.Fatal(r)
	}
	q.Config = []byte(`{`)
	if r := CheckContext(q); r.Status != "unknown" {
		t.Fatal(r)
	}
}
func TestSyntheticIndependentAndDeterministic(t *testing.T) {
	a, b, e := Synthetic(41, 6)
	if e != nil {
		t.Fatal(e)
	}
	aa, bb, _ := Synthetic(41, 6)
	if string(a) != string(aa) || string(b) != string(bb) {
		t.Fatal("not reproducible")
	}
	if domain.Hash(a) == domain.Hash(b) {
		t.Fatal("same input")
	}
	if _, _, e = Synthetic(41, 9); e == nil {
		t.Fatal("limit")
	}
}
