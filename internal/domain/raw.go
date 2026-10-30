package domain

import "time"

type ByteRange struct {
	Start int `json:"start"`
	End   int `json:"end"`
}
type RawGrant struct {
	SourceVersionID string      `json:"source_version_id"`
	SourceSHA       string      `json:"source_sha256"`
	Range           ByteRange   `json:"byte_range"`
	Hidden          []ByteRange `json:"hidden_ranges"`
	RenderedSHA     string      `json:"rendered_sha256"`
	Scope           Scope       `json:"scope"`
	ExpiresAt       *time.Time  `json:"expires_at"`
}

func WriterPack(p FactPack) FactPack {
	p.Excerpts = append([]Slot{}, p.Excerpts...)
	for i := range p.Excerpts {
		p.Excerpts[i].Bytes = nil
	}
	return p
}
