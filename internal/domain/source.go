package domain

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"unicode/utf8"
)

func ValidateSource(format string, b []byte) error {

	if !utf8.Valid(b) {
		return errors.New("SOURCE_PARSE_FAILED")
	}
	switch format {
	case "txt", "log", "md":
	case "csv":
		r := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(b, []byte{0xef, 0xbb, 0xbf})))
		rows, e := r.ReadAll()
		if e != nil || len(rows) < 1 {
			return errors.New("SOURCE_PARSE_FAILED")
		}
		seen := map[string]bool{}
		for _, h := range rows[0] {
			if strings.TrimSpace(h) == "" || seen[h] {
				return errors.New("SOURCE_PARSE_FAILED")
			}
			seen[h] = true
		}
	case "json":
		d := json.NewDecoder(bytes.NewReader(b))
		if e := tokens(d, 0); e != nil {
			return e
		}
		if _, e := d.Token(); e != io.EOF {
			return errors.New("SOURCE_PARSE_FAILED")
		}
	default:
		return errors.New("UNSUPPORTED_SOURCE_TYPE")
	}
	return nil
}
func EvidenceFor(s Source) []Evidence {
	if s.Format == "csv" {
		return CSVCellEvidence(s)
	}
	if s.Format == "json" {
		return JSONPointerEvidence(s)
	}
	out := []Evidence{}
	start := 0
	for _, line := range bytes.SplitAfter(s.Raw, []byte("\n")) {
		if len(line) > 0 {
			out = append(out, Evidence{Locator: Locator{Kind: "byte_range"}, ID: ID("ev"), SourceVersionID: s.ID, Start: start, End: start + len(line), SHA: Hash(line)})
		}
		start += len(line)
	}
	return out
}
func ValidateEvidence(t Task, ids []string) error {
	if len(ids) == 0 {
		return errors.New("BROKEN_EVIDENCE_REFERENCE")
	}
	for _, id := range ids {
		found := false
		for _, ev := range t.Evidence {
			if ev.ID != id {
				continue
			}
			for _, s := range t.Sources {
				if s.ID == ev.SourceVersionID && s.Included && Hash(s.Raw) == s.SHA && ev.Start >= 0 && ev.End <= len(s.Raw) && ev.Start < ev.End && utf8.Valid(s.Raw[:ev.Start]) && utf8.Valid(s.Raw[:ev.End]) && Hash(s.Raw[ev.Start:ev.End]) == ev.SHA {
					found = CheckLocator(s, ev.Locator) == nil
				}
			}
		}
		if !found {
			return errors.New("BROKEN_EVIDENCE_REFERENCE")
		}
	}
	return nil
}
