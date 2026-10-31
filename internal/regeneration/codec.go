package regeneration

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"unicode/utf8"
)

// Decode applies the same transport validation for HTTP and CLI.
func Decode(data []byte, out any) error {
	if len(data) > 2<<20 || !utf8.Valid(data) {
		return errors.New("INVALID_JSON")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	if err := jsonValue(decoder, 0); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return errors.New("INVALID_JSON")
	}
	decoder = json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	return decoder.Decode(out)
}
func jsonValue(decoder *json.Decoder, depth int) error {
	if depth > 32 {
		return errors.New("JSON_DEPTH")
	}
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delimiter, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	switch delimiter {
	case '{':
		seen := map[string]bool{}
		for decoder.More() {
			key, err := decoder.Token()
			if err != nil {
				return err
			}
			name, ok := key.(string)
			if !ok || seen[name] {
				return errors.New("DUPLICATE_JSON_KEY")
			}
			seen[name] = true
			if err := jsonValue(decoder, depth+1); err != nil {
				return err
			}
		}
	case '[':
		for decoder.More() {
			if err := jsonValue(decoder, depth+1); err != nil {
				return err
			}
		}
	default:
		return errors.New("INVALID_JSON")
	}
	_, err = decoder.Token()
	return err
}
