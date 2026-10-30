package artifact

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"io/fs"
	"safehandoff.local/poc/fixtures/public"
	"safehandoff.local/poc/internal/domain"
	"sort"
	"strings"
	"time"
)

func AddRepro(a *domain.Artifact, ascii, multi, result []byte) error {
	a.Files = append(a.Files, file("run-result.json", "application/json", result), file("README.md", "text/markdown; charset=utf-8", []byte("# 가상 toyrecord 재현\n\n의도적으로 만든 PoC 결함이며 실제 제품이 아닙니다. Go 1.24 이상 준비 후 다음을 실행하세요.\n\n    cd repro\n    GOTOOLCHAIN=local GOPROXY=off go run ./cmd/repro --inputs ./inputs\n\n고객 입력을 사용하지 않고 공개 계약으로 새 입력을 생성했습니다. 실행 결과의 not_run은 성공을 뜻하지 않습니다.\n")))
	e := fs.WalkDir(public.Target, ".", func(path string, d fs.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if d.IsDir() {
			return nil
		}
		if strings.Contains(path, "/inputs/") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		b, e := public.Target.ReadFile(path)
		if e != nil {
			return e
		}
		a.Files = append(a.Files, file("repro/"+path, "text/plain; charset=utf-8", b))
		return nil
	})
	if e != nil {
		return e
	}
	a.Files = append(a.Files, file("repro/inputs/ascii.json", "application/json", ascii), file("repro/inputs/multibyte.json", "application/json", multi))
	return Rebundle(a)
}
func SafePath(p string) bool {
	return p != "" && !strings.HasPrefix(p, "/") && !strings.Contains(p, "\\") && !strings.Contains(p, "..") && !strings.ContainsAny(p, "\r\n\x00")
}
func Rebundle(a *domain.Artifact) error {
	files := []domain.File{}
	for _, f := range a.Files {
		if f.Path != "manifest.json" {
			if !SafePath(f.Path) {
				return errors.New("UNAPPROVED_REFERENCE")
			}
			files = append(files, f)
		}
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	manifest := []map[string]any{}
	seen := map[string]bool{}
	for _, f := range files {
		if seen[f.Path] {
			return errors.New("UNAPPROVED_REFERENCE")
		}
		seen[f.Path] = true
		manifest = append(manifest, map[string]any{"path": f.Path, "media_type": f.MediaType, "size": f.Size, "sha256": f.SHA})
	}
	b, e := json.MarshalIndent(manifest, "", "  ")
	if e != nil {
		return e
	}
	files = append(files, file("manifest.json", "application/json", append(b, '\n')))
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	a.Files = files
	a.SetHash = SetHash(files)
	var out bytes.Buffer
	zw := zip.NewWriter(&out)
	for _, f := range files {
		h := &zip.FileHeader{Name: f.Path, Method: zip.Deflate}
		h.SetMode(0644)
		h.SetModTime(time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC))
		w, e := zw.CreateHeader(h)
		if e != nil {
			return e
		}
		if _, e = w.Write(f.Bytes); e != nil {
			return e
		}
	}
	if e = zw.Close(); e != nil {
		return e
	}
	a.ZIP = out.Bytes()
	a.ZIPHash = domain.Hash(a.ZIP)
	a.Findings = Scan(*a)
	return nil
}
func RegisteredPublic(path string, b []byte) bool {
	if !strings.HasPrefix(path, "repro/") {
		return false
	}
	original := strings.TrimPrefix(path, "repro/")
	asset, e := public.Target.ReadFile(original)
	return e == nil && domain.Hash(asset) == domain.Hash(b)
}
