//go:build unix

package store

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

// The lock must precede interrupted-job recovery; a second process cannot recover
// jobs that are still running in the owning process.
func acquireLock(dir string) (*os.File, error) {
	f, e := os.OpenFile(filepath.Join(dir, "safehandoff.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	if e = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); e != nil {
		f.Close()
		return nil, fmt.Errorf("DATA_DIR_IN_USE: %w", e)
	}
	return f, nil
}
func releaseLock(f *os.File) {
	if f != nil {
		syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		f.Close()
	}
}
