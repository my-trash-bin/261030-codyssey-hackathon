// Package skills embeds fixed product packs; runtime uploads cannot register tools.
package skills

import (
	"embed"
	"io/fs"
	"safehandoff.local/poc/internal/domain"
	"strings"
)

//go:embed vendorstore-support/* vendorstore-support/references/* toyrecord-repro/* toyrecord-repro/references/*
var Files embed.FS

func Hash() string {
	digests := map[string]string{}
	fs.WalkDir(Files, ".", func(path string, d fs.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if !d.IsDir() {
			b, err := Files.ReadFile(path)
			if err != nil {
				return err
			}
			digests[path] = domain.Hash(b)
		}
		return nil
	})
	return domain.Hash(domain.Canonical(digests))
}
func RoleDocs(purpose, role string) string {
	pack := ""
	if purpose == "vendor_support" {
		pack = "vendorstore-support"
	}
	if purpose == "oss_issue" {
		pack = "toyrecord-repro"
	}
	if pack == "" {
		return ""
	}
	name := "SKILL.md"
	if role == "writer" {
		name = "references/public-writing.md"
	}
	if role == "reviewer" {
		name = "references/reviewer-checks.md"
	}
	path := pack + "/" + name
	if !fs.ValidPath(path) || strings.Contains(path, "\\") {
		panic("invalid embedded pack path")
	}
	b, e := Files.ReadFile(path)
	if e != nil {
		panic(e)
	}
	return string(b)
}
