package domain

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
)

type Locator struct {
	Kind     string `json:"kind"`
	Row      int    `json:"row,omitempty"`
	Column   string `json:"column,omitempty"`
	Pointer  string `json:"pointer,omitempty"`
	ValueSHA string `json:"value_sha256,omitempty"`
}

func CSVCellEvidence(s Source) []Evidence {
	raw := bytes.TrimPrefix(s.Raw, []byte{0xef, 0xbb, 0xbf})
	bom := len(s.Raw) - len(raw)
	r := csv.NewReader(bytes.NewReader(raw))
	header, e := r.Read()
	if e != nil {
		return nil
	}
	out := []Evidence{}
	for row := 0; ; row++ {
		start := int(r.InputOffset()) + bom
		cells, e := r.Read()
		if e == io.EOF {
			break
		}
		if e != nil {
			return nil
		}
		end := int(r.InputOffset()) + bom
		for col, v := range cells {
			out = append(out, Evidence{ID: ID("ev"), SourceVersionID: s.ID, Start: start, End: end, SHA: Hash(s.Raw[start:end]), Locator: Locator{Kind: "csv_cell", Row: row, Column: header[col], ValueSHA: Hash([]byte(v))}})
		}
	}
	return out
}
func JSONPointerEvidence(s Source) []Evidence {
	d := json.NewDecoder(bytes.NewReader(s.Raw))
	d.UseNumber()
	out := []Evidence{}
	var walk func(string) (any, error)
	walk = func(pointer string) (any, error) {
		start := int(d.InputOffset())
		for start < len(s.Raw) && strings.ContainsRune(" \r\n\t:,", rune(s.Raw[start])) {
			start++
		}
		tok, e := d.Token()
		if e != nil {
			return nil, e
		}
		var val any = tok
		if delim, ok := tok.(json.Delim); ok {
			switch delim {
			case '{':
				m := map[string]any{}
				for d.More() {
					key, e := d.Token()
					if e != nil {
						return nil, e
					}
					k := key.(string)
					v, e := walk(pointer + "/" + strings.ReplaceAll(strings.ReplaceAll(k, "~", "~0"), "/", "~1"))
					if e != nil {
						return nil, e
					}
					m[k] = v
				}
				val = m
			case '[':
				a := []any{}
				for d.More() {
					v, e := walk(pointer + "/" + strconv.Itoa(len(a)))
					if e != nil {
						return nil, e
					}
					a = append(a, v)
				}
				val = a
			default:
				return nil, errors.New("SOURCE_PARSE_FAILED")
			}
			if _, e = d.Token(); e != nil {
				return nil, e
			}
		}
		end := int(d.InputOffset())
		out = append(out, Evidence{ID: ID("ev"), SourceVersionID: s.ID, Start: start, End: end, SHA: Hash(s.Raw[start:end]), Locator: Locator{Kind: "json_pointer", Pointer: pointer, ValueSHA: Hash(Canonical(val))}})
		return val, nil
	}
	if _, e := walk(""); e != nil {
		return nil
	}
	return out
}
func CheckLocator(s Source, loc Locator) error {
	switch loc.Kind {
	case "", "byte_range":
		return nil
	case "csv_cell":
		rows, e := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(s.Raw, []byte{0xef, 0xbb, 0xbf}))).ReadAll()
		if e != nil || loc.Row < 0 || loc.Row+1 >= len(rows) {
			return errors.New("BROKEN_EVIDENCE_REFERENCE")
		}
		for col, h := range rows[0] {
			if h == loc.Column && Hash([]byte(rows[loc.Row+1][col])) == loc.ValueSHA {
				return nil
			}
		}
	case "json_pointer":
		var v any
		d := json.NewDecoder(bytes.NewReader(s.Raw))
		d.UseNumber()
		if d.Decode(&v) != nil {
			return errors.New("BROKEN_EVIDENCE_REFERENCE")
		}
		if loc.Pointer != "" {
			if !strings.HasPrefix(loc.Pointer, "/") {
				return errors.New("BROKEN_EVIDENCE_REFERENCE")
			}
			for _, part := range strings.Split(loc.Pointer[1:], "/") {
				part = strings.ReplaceAll(strings.ReplaceAll(part, "~1", "/"), "~0", "~")
				switch x := v.(type) {
				case map[string]any:
					var ok bool
					v, ok = x[part]
					if !ok {
						return errors.New("BROKEN_EVIDENCE_REFERENCE")
					}
				case []any:
					i, e := strconv.Atoi(part)
					if e != nil || i < 0 || i >= len(x) || fmt.Sprint(i) != part {
						return errors.New("BROKEN_EVIDENCE_REFERENCE")
					}
					v = x[i]
				default:
					return errors.New("BROKEN_EVIDENCE_REFERENCE")
				}
			}
		}
		if Hash(Canonical(v)) == loc.ValueSHA {
			return nil
		}
	}
	return errors.New("BROKEN_EVIDENCE_REFERENCE")
}
