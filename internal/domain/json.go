package domain

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
	"unicode/utf8"
)

func ID(prefix string) string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return prefix + "_" + hex.EncodeToString(b)
}
func Hash(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func Canonical(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	var x any
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	if err = d.Decode(&x); err != nil {
		panic(err)
	}
	b, err = json.Marshal(x)
	if err != nil {
		panic(err)
	}
	return b
}

// Strict rejects duplicate keys, case variants, trailing data, excessive nesting and unknown fields.
func Strict(b []byte, dst any) error {
	if len(b) > 262144 || !utf8.Valid(b) {
		return errors.New("INVALID_JSON")
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	if err := tokens(d, 0); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return errors.New("INVALID_JSON")
	}
	var raw any
	d = json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	if err := d.Decode(&raw); err != nil {
		return err
	}
	if err := keys(raw, reflect.TypeOf(dst).Elem()); err != nil {
		return err
	}
	d = json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	return d.Decode(dst)
}
func tokens(d *json.Decoder, depth int) error {
	if depth > 16 {
		return errors.New("JSON_DEPTH")
	}
	t, err := d.Token()
	if err != nil {
		return err
	}
	if s, ok := t.(string); ok && len(s) > 8192 {
		return errors.New("JSON_STRING_LIMIT")
	}
	if delim, ok := t.(json.Delim); ok {
		switch delim {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				k, e := d.Token()
				if e != nil {
					return e
				}
				s, ok := k.(string)
				if !ok || seen[s] {
					return errors.New("DUPLICATE_KEY")
				}
				seen[s] = true
				if e = tokens(d, depth+1); e != nil {
					return e
				}
			}
		case '[':
			for d.More() {
				if e := tokens(d, depth+1); e != nil {
					return e
				}
			}
		default:
			return errors.New("INVALID_JSON")
		}
		_, err = d.Token()
	}
	return err
}
func keys(v any, t reflect.Type) error {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	switch x := v.(type) {
	case map[string]any:
		if t.Kind() == reflect.Map {
			return nil
		}
		if t.Kind() != reflect.Struct {
			return nil
		}
		fields := map[string]reflect.Type{}
		for i := 0; i < t.NumField(); i++ {
			f := t.Field(i)
			name := strings.Split(f.Tag.Get("json"), ",")[0]
			if name == "" {
				name = f.Name
			}
			fields[name] = f.Type
		}
		for k, val := range x {
			ft, ok := fields[k]
			if !ok {
				return fmt.Errorf("UNKNOWN_KEY: %s", k)
			}
			if e := keys(val, ft); e != nil {
				return e
			}
		}
	case []any:
		if t.Kind() == reflect.Slice {
			for _, val := range x {
				if e := keys(val, t.Elem()); e != nil {
					return e
				}
			}
		}
	}
	return nil
}
