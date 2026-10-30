package domain

import "time"

type Scope struct {
	ProjectID    string `json:"project_id"`
	PurposeID    string `json:"purpose_id"`
	RecipientID  string `json:"recipient_id"`
	Audience     string `json:"audience"`
	SkillSetHash string `json:"skill_set_hash"`
}
type Source struct {
	ID       string `json:"id"`
	SourceID string `json:"source_id"`
	Version  int    `json:"version"`
	Name     string `json:"display_name"`
	Format   string `json:"format"`
	Slot     string `json:"source_slot"`
	Raw      []byte `json:"raw_bytes"`
	SHA      string `json:"sha256"`
	Included bool   `json:"included"`
}
type Evidence struct {
	ID              string `json:"id"`
	SourceVersionID string `json:"source_version_id"`
	Start           int    `json:"start"`
	End             int    `json:"end"`
	SHA             string `json:"evidence_sha256"`
}
type Candidate struct {
	ID          string   `json:"id"`
	Kind        string   `json:"kind"`
	Statement   string   `json:"statement"`
	Uncertainty string   `json:"uncertainty"`
	EvidenceIDs []string `json:"evidence_ids"`
	Required    bool     `json:"required"`
	Selector    string   `json:"selector"`
	Values      []string `json:"values,omitempty"`
	Origin      string   `json:"origin"`
}
type Representation struct {
	Kind        string         `json:"kind"`
	TransformID string         `json:"transform_id"`
	Parameters  map[string]int `json:"parameters"`
}
type Decision struct {
	RawGrants      []RawGrant     `json:"raw_grants"`
	SupersedesID   string         `json:"supersedes_id"`
	ID             string         `json:"id"`
	CandidateID    string         `json:"candidate_id"`
	Disposition    string         `json:"disposition"`
	Representation Representation `json:"representation"`
	Scope          Scope          `json:"scope"`
	SourceHash     string         `json:"source_set_hash"`
	ProjectionSHA  string         `json:"projection_sha256"`
	ExpiresAt      *time.Time     `json:"expires_at"`
	Revoked        bool           `json:"revoked"`
	RuleID         string         `json:"applied_rule_id"`
	RuleVersion    int            `json:"applied_rule_version"`
}
type Preview struct {
	RawGrants      []RawGrant     `json:"raw_grants"`
	ID             string         `json:"preview_id"`
	Revision       int            `json:"input_revision"`
	CandidateID    string         `json:"candidate_id"`
	Representation Representation `json:"representation"`
	Projection     Projection     `json:"projection"`
	SHA            string         `json:"projection_sha256"`
}
type Projection struct {
	Statement string     `json:"statement"`
	Columns   []string   `json:"columns"`
	Rows      [][]string `json:"rows"`
	Excerpt   []byte     `json:"excerpt,omitempty"`
}
type Rule struct {
	ID             string         `json:"id"`
	Version        int            `json:"version"`
	Scope          Scope          `json:"scope"`
	Selector       string         `json:"selector"`
	Representation Representation `json:"representation"`
	ExpiresAt      *time.Time     `json:"expires_at"`
	Revoked        bool           `json:"revoked"`
}
type Fact struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Statement string `json:"statement"`
}
type Table struct {
	ID      string     `json:"id"`
	Columns []string   `json:"columns"`
	Rows    [][]string `json:"rows"`
}
type Slot struct {
	ID    string `json:"id"`
	Bytes []byte `json:"bytes,omitempty"`
}
type FactPack struct {
	Schema      string   `json:"schema_version"`
	Revision    int      `json:"task_revision"`
	TemplateID  string   `json:"template_id"`
	Audience    string   `json:"audience_type"`
	Language    string   `json:"output_language"`
	Brief       string   `json:"approved_brief"`
	Facts       []Fact   `json:"facts"`
	Required    []string `json:"required_fact_ids"`
	Tables      []Table  `json:"tables"`
	Excerpts    []Slot   `json:"excerpt_slots"`
	Assets      []Slot   `json:"asset_slots"`
	ToolResults []any    `json:"public_tool_results"`
}
type Item struct {
	Text    string   `json:"text"`
	FactIDs []string `json:"fact_ids"`
}
type Block struct {
	ID        string   `json:"block_id,omitempty"`
	Type      string   `json:"type"`
	Level     int      `json:"level,omitempty"`
	Text      string   `json:"text,omitempty"`
	FactIDs   []string `json:"fact_ids,omitempty"`
	Items     []Item   `json:"items,omitempty"`
	TableID   string   `json:"table_id,omitempty"`
	ExcerptID string   `json:"excerpt_id,omitempty"`
	AssetID   string   `json:"asset_id,omitempty"`
}
type Draft struct {
	Schema string  `json:"schema_version"`
	Blocks []Block `json:"blocks"`
}
type File struct {
	ID        string `json:"id"`
	Path      string `json:"path"`
	MediaType string `json:"media_type"`
	Bytes     []byte `json:"bytes"`
	Size      int    `json:"size"`
	SHA       string `json:"sha256"`
}
type Review struct {
	ID             string `json:"id"`
	TargetKind     string `json:"target_kind"`
	TargetHash     string `json:"target_hash"`
	Mode           string `json:"mode"`
	Result         string `json:"result"`
	FallbackReason string `json:"fallback_reason"`
}
type Artifact struct {
	ID           string   `json:"id"`
	Revision     int      `json:"revision"`
	Version      int      `json:"artifact_version"`
	Pack         FactPack `json:"fact_pack"`
	Draft        Draft    `json:"document"`
	DocumentHash string   `json:"document_hash"`
	SetHash      string   `json:"artifact_set_hash"`
	Files        []File   `json:"files"`
	ZIP          []byte   `json:"archive_bytes"`
	ZIPHash      string   `json:"archive_sha256"`
	Status       string   `json:"status"`
	Reviews      []Review `json:"reviews"`
}
type Job struct {
	ID       string     `json:"id"`
	TaskID   string     `json:"task_id"`
	Revision int        `json:"input_revision"`
	Kind     string     `json:"kind"`
	Status   string     `json:"status"`
	Cancel   bool       `json:"cancel_requested"`
	Error    string     `json:"error_code"`
	Started  time.Time  `json:"started_at"`
	Finished *time.Time `json:"finished_at"`
}
type Trace struct {
	JobID     string `json:"job_id"`
	Role      string `json:"role"`
	Mode      string `json:"mode"`
	Request   []byte `json:"request_payload"`
	Response  string `json:"response_payload"`
	Error     string `json:"error_code"`
	ElapsedMS int64  `json:"elapsed_ms"`
}
type Event struct {
	Seq      int    `json:"seq"`
	Revision int    `json:"revision"`
	Type     string `json:"type"`
	State    string `json:"state"`
}
type Task struct {
	ID                string              `json:"id"`
	Title             string              `json:"internal_title"`
	Scope             Scope               `json:"scope"`
	Language          string              `json:"output_language"`
	Revision          int                 `json:"revision"`
	Phase             string              `json:"phase"`
	Mode              string              `json:"provider_mode"`
	Sources           []Source            `json:"sources"`
	Evidence          []Evidence          `json:"evidence"`
	Candidates        []Candidate         `json:"candidates"`
	Decisions         map[string]Decision `json:"decisions"`
	Previews          map[string]Preview  `json:"previews"`
	CurrentJobID      string              `json:"current_job_id"`
	Jobs              []Job               `json:"jobs"`
	Artifacts         []Artifact          `json:"artifacts"`
	CurrentArtifactID string              `json:"current_artifact_id"`
	ExportID          string              `json:"export_id"`
	Events            []Event             `json:"events"`
	Traces            []Trace             `json:"run_traces"`
	Reproduction      ReproResult         `json:"reproduction"`
}
type ReproResult struct {
	Schema string `json:"schema_version"`
	Status string `json:"status"`
	Reason string `json:"reason_code"`
}

func (t *Task) Event(kind string) {
	t.Events = append(t.Events, Event{len(t.Events) + 1, t.Revision, kind, t.Phase})
}
func (t *Task) Invalidate(phase string) {
	t.Revision++
	t.Phase = phase
	t.ExportID = ""
	for i := range t.Artifacts {
		t.Artifacts[i].Status = "stale"
	}
	t.CurrentArtifactID = ""
	t.Event("task.invalidated")
}
func (t *Task) Artifact() *Artifact {
	for i := range t.Artifacts {
		if t.Artifacts[i].ID == t.CurrentArtifactID {
			return &t.Artifacts[i]
		}
	}
	return nil
}
func (t *Task) SourceHash() string {
	var parts []string
	for _, s := range t.Sources {
		if s.Included {
			parts = append(parts, s.ID+":"+s.SHA)
		}
	}
	return Hash(Canonical(parts))
}
