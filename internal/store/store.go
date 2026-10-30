// Package store persists a task aggregate and immutable revision snapshots in one transaction.
package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	_ "modernc.org/sqlite"
	"os"
	"path/filepath"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/migrations"
	"sync"
)

type Store struct {
	DB   *sql.DB
	Mu   sync.Mutex
	lock *os.File
}

func Open(dir string) (*Store, error) {
	if e := os.MkdirAll(dir, 0700); e != nil {
		return nil, e
	}
	if e := os.Chmod(dir, 0700); e != nil {
		return nil, e
	}
	lock, e := acquireLock(dir)
	if e != nil {
		return nil, e
	}
	success := false
	defer func() {
		if !success {
			releaseLock(lock)
		}
	}()
	path := filepath.Join(dir, "safehandoff.db")
	f, e := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	f.Close()
	os.Chmod(path, 0600)
	db, e := sql.Open("sqlite", path)
	if e != nil {
		return nil, e
	}
	db.SetMaxOpenConns(1)
	if _, e = db.Exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;" + migrations.Initial); e != nil {
		db.Close()
		return nil, e
	}
	s := &Store{DB: db, lock: lock}
	defer func() {
		if !success {
			db.Close()
		}
	}()
	tasks, e := s.List()
	if e != nil {
		return nil, e
	}
	for _, t := range tasks {
		changed := false
		for i := range t.Jobs {
			if t.Jobs[i].Status == "running" || t.Jobs[i].Status == "queued" {
				t.Jobs[i].Status = "failed"
				t.Jobs[i].Error = "INTERRUPTED"
				changed = true
			}
		}
		if changed {
			t.Phase = "needs_attention"
			t.Event("job.failed")
			if e = s.Save(t, t.Revision); e != nil {
				return nil, e
			}
		}
	}
	success = true
	return s, nil
}
func (s *Store) Close() error { e := s.DB.Close(); releaseLock(s.lock); return e }
func (s *Store) Get(id string) (domain.Task, error) {
	var b []byte
	var t domain.Task
	e := s.DB.QueryRow("SELECT payload_json FROM tasks WHERE id=?", id).Scan(&b)
	if e != nil {
		return t, e
	}
	e = json.Unmarshal(b, &t)
	return t, e
}
func (s *Store) List() ([]domain.Task, error) {
	rows, e := s.DB.Query("SELECT payload_json FROM tasks ORDER BY rowid DESC")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []domain.Task{}
	for rows.Next() {
		var b []byte
		var t domain.Task
		if e = rows.Scan(&b); e != nil {
			return nil, e
		}
		if e = json.Unmarshal(b, &t); e != nil {
			return nil, e
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
func (s *Store) Save(t domain.Task, expected int) error { return s.SaveWithRules(t, expected, nil) }
func (s *Store) SaveWithRules(t domain.Task, expected int, rules []domain.Rule) error {
	tx, e := s.DB.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	b := domain.Canonical(t)
	for _, rule := range rules {
		if _, e = tx.Exec("INSERT INTO rules VALUES(?,?,?)", rule.ID, rule.Version, domain.Canonical(rule)); e != nil {
			return e
		}
	}
	if expected == 0 {
		_, e = tx.Exec("INSERT INTO tasks VALUES(?,?,?,?)", t.ID, t.Revision, t.Phase, b)
	} else {
		var r sql.Result
		r, e = tx.Exec("UPDATE tasks SET revision=?,phase=?,payload_json=? WHERE id=? AND revision=?", t.Revision, t.Phase, b, t.ID, expected)
		if e == nil {
			n, _ := r.RowsAffected()
			if n != 1 {
				return errors.New("REVISION_CONFLICT")
			}
		}
	}
	if e != nil {
		return e
	}
	_, e = tx.Exec("INSERT OR IGNORE INTO task_snapshots VALUES(?,?,?)", t.ID, t.Revision, b)
	if e != nil {
		return e
	}
	return tx.Commit()
}
func (s *Store) Rules() ([]domain.Rule, error) {
	rows, e := s.DB.Query("SELECT payload_json FROM rules ORDER BY id,version")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []domain.Rule{}
	for rows.Next() {
		var b []byte
		var r domain.Rule
		if e = rows.Scan(&b); e != nil {
			return nil, e
		}
		if e = json.Unmarshal(b, &r); e != nil {
			return nil, e
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
func (s *Store) PutRule(r domain.Rule) error {
	_, e := s.DB.Exec("INSERT INTO rules VALUES(?,?,?) ON CONFLICT(id,version) DO UPDATE SET payload_json=excluded.payload_json", r.ID, r.Version, domain.Canonical(r))
	return e
}
func (s *Store) FindArtifact(id string) (domain.Task, error) {
	ts, e := s.List()
	if e != nil {
		return domain.Task{}, e
	}
	for _, t := range ts {
		for _, a := range t.Artifacts {
			if a.ID == id {
				return t, nil
			}
		}
	}
	return domain.Task{}, sql.ErrNoRows
}
func (s *Store) FindExport(id string) (domain.Task, error) {
	ts, e := s.List()
	if e != nil {
		return domain.Task{}, e
	}
	for _, t := range ts {
		if t.ExportID == id {
			return t, nil
		}
	}
	return domain.Task{}, sql.ErrNoRows
}
