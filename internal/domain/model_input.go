package domain

// ModelSource makes original UTF-8 visible to analysis/review without a base64 layer.
type ModelSource struct {
	ID       string `json:"source_version_id"`
	Format   string `json:"format"`
	Content  string `json:"content"`
	Included bool   `json:"included"`
}

func ModelSources(t Task) []ModelSource {
	out := []ModelSource{}
	for _, s := range t.Sources {
		if s.Included {
			out = append(out, ModelSource{ID: s.ID, Format: s.Format, Content: string(s.Raw), Included: true})
		}
	}
	return out
}

type ModelFile struct {
	ID      string `json:"artifact_file_id"`
	Path    string `json:"path"`
	SHA     string `json:"sha256"`
	Content string `json:"content"`
}

func ModelFiles(files []File) []ModelFile {
	out := []ModelFile{}
	for _, f := range files {
		out = append(out, ModelFile{ID: f.ID, Path: f.Path, SHA: f.SHA, Content: string(f.Bytes)})
	}
	return out
}
