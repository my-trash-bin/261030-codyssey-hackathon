package policy

import (
	"errors"
	"safehandoff.local/poc/internal/domain"
	"time"
)

// NextRule updates one criterion's version without changing earlier decisions.
func NextRule(existing []domain.Rule, scope domain.Scope, selector string, representation domain.Representation, expiry *time.Time) (domain.Rule, error) {
	latest := map[string]domain.Rule{}
	for _, r := range existing {
		if r.Scope == scope && r.Selector == selector {
			if prior, ok := latest[r.ID]; !ok || r.Version > prior.Version {
				latest[r.ID] = r
			}
		}
	}
	if len(latest) > 1 {
		return domain.Rule{}, errors.New("RULE_CONFLICT")
	}
	rule := domain.Rule{ID: domain.ID("rule"), Version: 1, Scope: scope, Selector: selector, Representation: representation, ExpiresAt: expiry}
	for _, prior := range latest {
		rule.ID = prior.ID
		rule.Version = prior.Version + 1
	}
	return rule, nil
}

// AutomaticRule never falls back to old versions or picks among overlapping IDs.
func AutomaticRule(existing []domain.Rule, scope domain.Scope, selector string, now time.Time) (domain.Rule, bool) {
	latest := map[string]domain.Rule{}
	for _, r := range existing {
		if r.Scope == scope && r.Selector == selector {
			if prior, ok := latest[r.ID]; !ok || r.Version > prior.Version {
				latest[r.ID] = r
			}
		}
	}
	if len(latest) != 1 {
		return domain.Rule{}, false
	}
	for _, r := range latest {
		if !r.Revoked && (r.ExpiresAt == nil || now.Before(*r.ExpiresAt)) {
			return r, true
		}
	}
	return domain.Rule{}, false
}
