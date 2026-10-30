package artifact

import (
	"errors"
	"regexp"
	"safehandoff.local/poc/internal/domain"
	"strings"
)

var observationFile = regexp.MustCompile(`^observations-[2-9][0-9]*\.csv$`)
var number = regexp.MustCompile(`[0-9]+(?:\.[0-9]+)?`)

// Numeric claims must occur in the facts cited by that block. This is a hard
// supplement to semantic review, not a substitute for checking causality.
func CheckClaims(d domain.Draft, p domain.FactPack) error {
	check := func(text string, ids []string) error {
		allowed := map[string]bool{}
		for _, id := range ids {
			for _, f := range p.Facts {
				if f.ID == id {
					for _, n := range number.FindAllString(f.Statement, -1) {
						allowed[n] = true
					}
				}
			}
		}
		for _, n := range number.FindAllString(text, -1) {
			if !allowed[n] {
				return errors.New("UNAPPROVED_DISCLOSURE")
			}
		}
		for _, pattern := range []string{"http://", "https://", "/srv/", "/home/", "/var/"} {
			if strings.Contains(text, pattern) {
				return errors.New("UNAPPROVED_REFERENCE")
			}
		}
		return nil
	}
	for _, b := range d.Blocks {
		if b.Type == "paragraph" || b.Type == "heading" {
			if e := check(b.Text, b.FactIDs); e != nil {
				return e
			}
		}
		for _, it := range b.Items {
			if e := check(it.Text, it.FactIDs); e != nil {
				return e
			}
		}
	}
	return nil
}
