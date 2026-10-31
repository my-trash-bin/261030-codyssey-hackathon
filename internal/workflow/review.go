package workflow

import (
	"errors"
	"fmt"
	"safehandoff.local/poc/internal/artifact"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/internal/llm"
	"strings"
)

func validateReview(r llm.Review, d domain.Draft, p domain.FactPack, c []domain.Candidate, files []domain.File) error {
	if r.Schema != "review.v1" {
		return errors.New("SCHEMA_INVALID")
	}
	if r.Result == "pass" {
		if len(r.Issues) > 0 {
			return errors.New("SCHEMA_INVALID")
		}
		return nil
	}
	if r.Result != "needs_changes" && r.Result != "needs_decision" && r.Result != "error" {
		return errors.New("SCHEMA_INVALID")
	}
	if len(r.Issues) == 0 {
		return errors.New("REVIEW_UNRESOLVED")
	}
	reasons := map[string]bool{}
	for _, s := range strings.Split("UNAPPROVED_DISCLOSURE UNSUPPORTED_CAUSAL_CLAIM MISSING_REQUIRED_FACT SOURCE_CONFLICT UNCERTAINTY_REMOVED INCORRECT_PROJECTION UNAPPROVED_REFERENCE NEEDS_DISCLOSURE_DECISION", " ") {
		reasons[s] = true
	}
	for _, i := range r.Issues {
		if !reasons[i.Reason] {
			return errors.New("SCHEMA_INVALID")
		}
		found := i.Target.Kind == "document" && i.Target.BlockID == "" && i.Target.FileID == ""
		if i.Target.Kind == "block" {
			for _, b := range d.Blocks {
				found = found || b.ID != "" && b.ID == i.Target.BlockID
			}
		}
		if i.Target.Kind == "file" {
			for _, f := range files {
				found = found || f.ID == i.Target.FileID
			}
		}
		if !found {
			return errors.New("REFERENCE_INVALID")
		}
		for _, id := range i.Facts {
			ok := false
			for _, f := range p.Facts {
				ok = ok || id == f.ID
			}
			if !ok {
				return errors.New("REFERENCE_INVALID")
			}
		}
		for _, id := range i.Candidates {
			ok := false
			for _, v := range c {
				ok = ok || id == v.ID
			}
			if !ok {
				return errors.New("REFERENCE_INVALID")
			}
		}
		if i.Action == nil {
			return errors.New("REVIEW_UNRESOLVED")
		}
		switch *i.Action {
		case "delete":
			if i.Target.Kind != "block" || len(i.Facts)+len(i.Candidates) > 0 {
				return errors.New("REFERENCE_INVALID")
			}
		case "rewrite_from_facts":
			if len(i.Facts) == 0 || len(i.Candidates) > 0 || i.Target.Kind == "file" {
				return errors.New("REFERENCE_INVALID")
			}
		case "request_decision":
			if len(i.Candidates) == 0 || len(i.Facts) > 0 || r.Result != "needs_decision" {
				return errors.New("REFERENCE_INVALID")
			}
		default:
			return fmt.Errorf("SCHEMA_INVALID")
		}
	}
	return nil
}

func reviewFiles(files []domain.File) []domain.ModelFile {
	result := domain.ModelFiles(files)
	for i, f := range files {
		if artifact.RegisteredPublic(f.Path, f.Bytes) {
			result[i].Content = ""
			result[i].Registered = true
		}
	}
	return result
}
