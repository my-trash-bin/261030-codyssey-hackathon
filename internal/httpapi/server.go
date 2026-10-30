package httpapi

import (
	"bytes"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"html/template"
	"io"
	"net/http"
	"net/url"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/internal/workflow"
	"safehandoff.local/poc/skills"
	"safehandoff.local/poc/web"
	"strings"
	"sync"
)

type Server struct {
	Service  *workflow.Service
	Host     string
	Token    string
	Session  string
	mux      *http.ServeMux
	mutation sync.Mutex
}

func New(s *workflow.Service, host string) *Server {
	v := &Server{Service: s, Host: host, Token: domain.ID("csrf"), Session: domain.ID("session"), mux: http.NewServeMux()}
	v.routes()
	return v
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
	if r.Host != s.Host {
		http.Error(w, "허용되지 않은 Host", 403)
		return
	}
	if o := r.Header.Get("Origin"); o != "" {
		u, e := url.Parse(o)
		if e != nil || u.Host != s.Host || u.Scheme != "http" {
			http.Error(w, "허용되지 않은 Origin", 403)
			return
		}
	}
	mut := r.Method != "GET" && r.Method != "HEAD"
	if mut {
		cookie, e := r.Cookie("safehandoff_session")
		if e != nil || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(s.Session)) != 1 || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CSRF-Token")), []byte(s.Token)) != 1 {
			fail(w, errors.New("CSRF_INVALID"), 403)
			return
		}
		key := r.Header.Get("Idempotency-Key")
		if key == "" || len(key) > 160 {
			fail(w, errors.New("IDEMPOTENCY_KEY_REQUIRED"), 400)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, int64(s.Service.MaxSourceBytes+s.Service.MaxFiles*4096+65536))
		b, e := io.ReadAll(r.Body)
		if e != nil {
			fail(w, errors.New("INPUT_TOO_LARGE"), 413)
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(b))
		hash := domain.Hash(b)
		s.mutation.Lock()
		defer s.mutation.Unlock()
		var previous string
		var status int
		var response []byte
		e = s.Service.Store.DB.QueryRow("SELECT request_hash,response_status,response_json FROM idempotency_keys WHERE method=? AND path=? AND key=?", r.Method, r.URL.Path, key).Scan(&previous, &status, &response)
		if e == nil {
			if previous != hash {
				fail(w, errors.New("IDEMPOTENCY_CONFLICT"), 409)
				return
			}
			if status == 0 {
				fail(w, errors.New("IDEMPOTENCY_INDETERMINATE"), 409)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			w.Write(response)
			return
		}
		if e != sql.ErrNoRows {
			fail(w, e, 500)
			return
		}
		_, e = s.Service.Store.DB.Exec("INSERT INTO idempotency_keys VALUES(?,?,?,?,0,?)", r.Method, r.URL.Path, key, hash, []byte("{}"))
		if e != nil {
			fail(w, e, 500)
			return
		}
		rec := &capture{header: http.Header{}, status: 200}
		s.mux.ServeHTTP(rec, r)
		_, e = s.Service.Store.DB.Exec("UPDATE idempotency_keys SET response_status=?,response_json=? WHERE method=? AND path=? AND key=?", rec.status, rec.body.Bytes(), r.Method, r.URL.Path, key)
		if e != nil {
			fail(w, e, 500)
			return
		}
		for k, vs := range rec.header {
			w.Header()[k] = vs
		}
		w.WriteHeader(rec.status)
		w.Write(rec.body.Bytes())
		return
	}
	s.mux.ServeHTTP(w, r)
}

type capture struct {
	header http.Header
	body   bytes.Buffer
	status int
}

func (c *capture) Header() http.Header         { return c.header }
func (c *capture) WriteHeader(n int)           { c.status = n }
func (c *capture) Write(b []byte) (int, error) { return c.body.Write(b) }
func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{"data": v})
}
func fail(w http.ResponseWriter, e error, status int) {
	code := e.Error()
	if strings.ContainsAny(code, " :\n") || len(code) > 80 {
		code = "INVALID_REQUEST"
	}
	if errors.Is(e, sql.ErrNoRows) {
		status = 404
		code = "NOT_FOUND"
	}
	respondError := map[string]any{"error": map[string]any{"code": code, "message": "요청을 처리하지 못했습니다. 상태와 입력을 확인해 주세요.", "retryable": false}}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(respondError)
}
func decode(r *http.Request, v any) error {
	b, e := io.ReadAll(io.LimitReader(r.Body, 262145))
	if e != nil {
		return e
	}
	return domain.Strict(b, v)
}
func (s *Server) routes() {
	m := s.mux
	m.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, map[string]any{"database": s.Service.Store.DB.Ping() == nil, "provider_mode": s.Service.Provider.Mode()})
	})
	m.HandleFunc("GET /api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, map[string]any{"provider_mode": s.Service.Provider.Mode()})
	})
	m.HandleFunc("GET /api/v1/session", func(w http.ResponseWriter, r *http.Request) {
		http.SetCookie(w, &http.Cookie{Name: "safehandoff_session", Value: s.Session, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
		respond(w, 200, map[string]string{"csrf_token": s.Token})
	})
	m.HandleFunc("POST /api/v1/provider/check", s.providerCheck)
	m.HandleFunc("GET /api/v1/catalog", s.catalog)
	m.HandleFunc("POST /api/v1/catalog/{kind}", s.addCatalog)
	m.HandleFunc("POST /api/v1/tasks", s.create)
	m.HandleFunc("GET /api/v1/tasks", s.list)
	m.HandleFunc("GET /api/v1/tasks/{id}", s.get)
	m.HandleFunc("PATCH /api/v1/tasks/{id}", s.patch)
	m.HandleFunc("POST /api/v1/tasks/{id}/source-batches", s.sources)
	m.HandleFunc("DELETE /api/v1/tasks/{id}/sources/{source}", s.removeSource)
	m.HandleFunc("GET /api/v1/tasks/{id}/sources/{source}", s.source)
	m.HandleFunc("GET /api/v1/tasks/{id}/evidence/{evidence}", s.evidence)
	m.HandleFunc("GET /api/v1/tasks/{id}/candidates", s.candidates)
	m.HandleFunc("POST /api/v1/tasks/{id}/manual-candidates", s.manual)
	m.HandleFunc("POST /api/v1/tasks/{id}/disclosure-previews", s.preview)
	m.HandleFunc("POST /api/v1/tasks/{id}/decision-batches", s.decide)
	m.HandleFunc("POST /api/v1/tasks/{id}/decisions/{decision}/revoke", s.revokeDecision)
	m.HandleFunc("POST /api/v1/tasks/{id}/jobs", s.startJob)
	m.HandleFunc("GET /api/v1/jobs/{job}", s.job)
	m.HandleFunc("POST /api/v1/jobs/{job}/cancel", s.cancelJob)
	m.HandleFunc("GET /api/v1/tasks/{id}/events", s.events)
	m.HandleFunc("GET /api/v1/artifacts/{artifact}", s.getArtifact)
	m.HandleFunc("GET /api/v1/artifacts/{artifact}/files/{file}/preview", s.previewFile)
	m.HandleFunc("PUT /api/v1/artifacts/{artifact}/edit", s.edit)
	m.HandleFunc("POST /api/v1/artifacts/{artifact}/finalize", s.finalize)
	m.HandleFunc("POST /api/v1/artifacts/{artifact}/human-review", s.humanReview)
	m.HandleFunc("GET /api/v1/exports/{export}/archive", s.download)
	m.HandleFunc("GET /api/v1/exports/{export}/files/{file}", s.download)
	m.HandleFunc("GET /api/v1/rules", s.rules)
	m.HandleFunc("POST /api/v1/rules", s.saveRule)
	m.HandleFunc("POST /api/v1/rules/{rule}/versions", s.ruleVersion)
	m.HandleFunc("POST /api/v1/rules/{rule}/revoke", s.revokeRule)
	m.HandleFunc("GET /static/", func(w http.ResponseWriter, r *http.Request) { http.FileServerFS(web.Static).ServeHTTP(w, r) })
	m.HandleFunc("GET /", s.page)
}
func (s *Server) page(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" && r.URL.Path != "/tasks/new" && r.URL.Path != "/history" && !strings.HasPrefix(r.URL.Path, "/tasks/") {
		http.NotFound(w, r)
		return
	}
	t := template.Must(template.ParseFS(web.Templates, "templates/*.html"))
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	t.ExecuteTemplate(w, "app.html", map[string]string{"Mode": s.Service.Provider.Mode()})
}
func (s *Server) catalog(w http.ResponseWriter, r *http.Request) {
	items := []map[string]string{{"id": "project_demo", "kind": "project", "display_name": "가상 시연 프로젝트"}, {"id": "public", "kind": "recipient", "display_name": "공개"}, {"id": "recipient_vendorstore", "kind": "recipient", "display_name": "VendorStore 공급사"}}
	rows, e := s.Service.Store.DB.Query("SELECT id,kind,display_name FROM catalog")
	if e != nil {
		fail(w, e, 500)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id, k, n string
		rows.Scan(&id, &k, &n)
		items = append(items, map[string]string{"id": id, "kind": k, "display_name": n})
	}
	respond(w, 200, map[string]any{"entries": items, "purposes": []string{"oss_issue", "vendor_support", "operations_advice"}, "transforms": []string{"series_direction_only.v1", "series_index_base100.v1"}})
}
func (s *Server) addCatalog(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Name string `json:"display_name"`
	}
	kind := r.PathValue("kind")
	if e := decode(r, &v); e != nil || v.Name == "" || (kind != "projects" && kind != "recipients") {
		fail(w, errors.New("INVALID_REQUEST"), 400)
		return
	}
	kind = strings.TrimSuffix(kind, "s")
	id := domain.ID(kind)
	if _, e := s.Service.Store.DB.Exec("INSERT INTO catalog VALUES(?,?,?)", id, kind, v.Name); e != nil {
		fail(w, e, 500)
		return
	}
	respond(w, 201, map[string]string{"id": id})
}
func (s *Server) create(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Title     string   `json:"internal_title"`
		Project   string   `json:"project_id"`
		Purpose   string   `json:"purpose_id"`
		Recipient string   `json:"recipient_id"`
		Audience  string   `json:"audience"`
		Language  string   `json:"output_language"`
		SkillIDs  []string `json:"skill_ids"`
	}
	if e := decode(r, &v); e != nil {
		fail(w, e, 400)
		return
	}
	if len(v.SkillIDs) > 0 {
		fail(w, errors.New("UNSUPPORTED_SKILL_SELECTION"), 400)
		return
	}
	t, e := s.Service.Create(v.Title, domain.Scope{ProjectID: v.Project, PurposeID: v.Purpose, RecipientID: v.Recipient, Audience: v.Audience}, v.Language)
	if e != nil {
		fail(w, e, 400)
		return
	}
	respond(w, 201, t)
}
func (s *Server) list(w http.ResponseWriter, r *http.Request) {
	ts, e := s.Service.Store.List()
	if e != nil {
		fail(w, e, 500)
		return
	}
	for i := range ts {
		ts[i].Traces = nil
		ts[i].Artifacts = nil
		ts[i].Sources = nil
	}
	respond(w, 200, ts)
}
func (s *Server) get(w http.ResponseWriter, r *http.Request) {
	t, e := s.Service.Store.Get(r.PathValue("id"))
	if e != nil {
		fail(w, e, 404)
		return
	} // Traces are internal; available in DB for evaluation, never exported.
	t.Traces = nil
	for i := range t.Artifacts {
		t.Artifacts[i].ZIP = nil
	}
	respond(w, 200, t)
}

type revision struct {
	Revision int `json:"expected_revision"`
}

func (s *Server) patch(w http.ResponseWriter, r *http.Request) {
	var v struct {
		SkillIDs  *[]string `json:"skill_ids"`
		Revision  int       `json:"expected_revision"`
		Title     *string   `json:"internal_title"`
		Recipient *string   `json:"recipient_id"`
		Audience  *string   `json:"audience"`
		Purpose   *string   `json:"purpose_id"`
		Language  *string   `json:"output_language"`
	}
	if e := decode(r, &v); e != nil {
		fail(w, e, 400)
		return
	}
	s.Service.Store.Mu.Lock()
	defer s.Service.Store.Mu.Unlock()
	t, e := s.Service.Store.Get(r.PathValue("id"))
	if e != nil {
		fail(w, e, 404)
		return
	}
	if t.Revision != v.Revision {
		fail(w, errors.New("REVISION_CONFLICT"), 409)
		return
	}
	if v.Title != nil {
		t.Title = *v.Title
	}
	if v.Recipient != nil {
		if *v.Recipient == "" {
			fail(w, errors.New("INVALID_REQUEST"), 400)
			return
		}
		t.Scope.RecipientID = *v.Recipient
	}
	if v.Audience != nil {
		if *v.Audience != "public" && *v.Audience != "named_external" {
			fail(w, errors.New("INVALID_REQUEST"), 400)
			return
		}
		t.Scope.Audience = *v.Audience
	}
	phase := "needs_decisions"
	if v.SkillIDs != nil {
		if len(*v.SkillIDs) != 0 {
			fail(w, errors.New("UNSUPPORTED_SKILL_SELECTION"), 400)
			return
		}
		t.Scope.SkillSetHash = skills.Hash()
		phase = "needs_analysis"
	}
	if v.Purpose != nil {
		if *v.Purpose != "oss_issue" && *v.Purpose != "vendor_support" && *v.Purpose != "operations_advice" {
			fail(w, errors.New("INVALID_REQUEST"), 400)
			return
		}
		t.Scope.PurposeID = *v.Purpose
		phase = "needs_analysis"
	}
	if v.Language != nil {
		if *v.Language != "ko" && *v.Language != "en" {
			fail(w, errors.New("INVALID_REQUEST"), 400)
			return
		}
		t.Language = *v.Language
	}
	t.Invalidate(phase)
	if e = s.Service.Store.Save(t, v.Revision); e != nil {
		fail(w, e, 409)
		return
	}
	respond(w, 200, t)
}

func (s *Server) providerCheck(w http.ResponseWriter, r *http.Request) {
	var v struct{}
	if e := decode(r, &v); e != nil {
		fail(w, e, 400)
		return
	}
	t, e := s.Service.Create("모델 연결 검사", domain.Scope{ProjectID: "project_demo", PurposeID: "operations_advice", RecipientID: "public", Audience: "public"}, "ko")
	if e != nil {
		fail(w, e, 500)
		return
	}
	j, e := s.Service.Start(t.ID, t.Revision, "provider_check")
	if e != nil {
		fail(w, e, 409)
		return
	}
	respond(w, 202, j)
}
