//go:build !unix

package store

import (
	"errors"
	"os"
)

func acquireLock(string) (*os.File, error) {
	return nil, errors.New("UNSUPPORTED_PLATFORM: Linux 또는 macOS가 필요합니다")
}
func releaseLock(*os.File) {}
