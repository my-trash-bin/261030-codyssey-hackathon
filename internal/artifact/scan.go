package artifact

import (
	"bytes"
	"fmt"
	"net/netip"
	"regexp"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/internal/tools"
	"strings"
)

var detectors = []struct {
	id      string
	pattern *regexp.Regexp
}{
	{"ip.v1", regexp.MustCompile(`\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b`)},
	{"token.v1", regexp.MustCompile(`(?i)\b(?:api[_-]?key|auth[_-]?marker|authorization|secret)[ \t]*["']?[ \t]*[:=][ \t]*["']?[A-Za-z0-9_./+-]{8,}`)},
	{"bearer.v1", regexp.MustCompile(`(?i)\bBearer[ \t]+[A-Za-z0-9_./+-]{8,}`)},
	{"internal_path.v1", regexp.MustCompile(`/(?:srv|home|var|etc)/(?:[A-Za-z0-9_.@-]+/?)+`)},
	{"url.v1", regexp.MustCompile(`https?://[^\s<>"')]+`)},
}

func excerptFileName(index int) string {
	if index == 0 {
		return "approved-excerpt.txt"
	}
	return fmt.Sprintf("approved-excerpt-%d.txt", index+1)
}

// Scan checks actual payload bytes. Exemptions apply to one finding and file hash.
func Scan(a domain.Artifact) []domain.Finding {
	out := []domain.Finding{}
	for _, f := range a.Files {
		if f.Path == "manifest.json" || RegisteredPublic(f.Path, f.Bytes) {
			continue
		}
		excerpt := false
		for i, slot := range a.Pack.Excerpts {
			if f.Path == excerptFileName(i) && bytes.Equal(f.Bytes, slot.Bytes) {
				excerpt = true
			}
		}
		for _, detector := range detectors {
			for _, span := range detector.pattern.FindAllIndex(f.Bytes, -1) {
				value := string(f.Bytes[span[0]:span[1]])
				if detector.id == "ip.v1" {
					if _, e := netip.ParseAddr(value); e != nil {
						continue
					}
				}
				finding := domain.Finding{ID: domain.ID("finding"), FileID: f.ID, FilePath: f.Path, TargetHash: a.SetHash, DetectorID: detector.id, Start: span[0], End: span[1], ValueSHA: domain.Hash([]byte(value)), Resolution: "blocked", Reason: "UNAPPROVED_PATTERN_VALUE"}
				if excerpt {
					finding.Resolution = "allowed_excerpt"
					finding.Reason = "APPROVED_EXCERPT_BYTES"
				} else {
					for _, fact := range a.Pack.Facts {
						if strings.Contains(fact.Statement, value) {
							finding.Resolution = "allowed_exact"
							finding.Reason = "EXPLICIT_APPROVED_TEXT"
							break
						}
					}
					if detector.id == "ip.v1" && f.Path == "client-config-example.json" {
						for _, asset := range a.Pack.Assets {
							if asset.ID == "config_example" && bytes.Equal(asset.Bytes, f.Bytes) {
								q := tools.ContextRequest{Schema: "context_check_request.v1", FindingID: finding.ID, SetHash: a.SetHash, Detector: "ip.v1", Field: "/upstreams/0/address", Provenance: "make_config_example_v1:generated_config", Product: "vendorstore-lab", RuleActive: true, Config: f.Bytes}
								r := tools.CheckContext(q)
								if tools.ValidateContextResult(q, r) == nil && r.Status == "allowed" {
									finding.Resolution = "allowed_context"
									finding.Reason = r.Reason
								}
							}
						}
					}
				}
				out = append(out, finding)
			}
		}
	}
	return out
}
