package envfile

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadAndEnvironmentPrecedence(t *testing.T) {
	const local = "SAFEHANDOFF_TEST_DOTENV_LOCAL"
	const exported = "SAFEHANDOFF_TEST_DOTENV_EXPORTED"
	const empty = "SAFEHANDOFF_TEST_DOTENV_EMPTY"
	t.Setenv(local, "")
	if err := os.Unsetenv(local); err != nil {
		t.Fatal(err)
	}
	t.Setenv(exported, "shell-value")
	t.Setenv(empty, "")
	path := filepath.Join(t.TempDir(), ".env")
	contents := "# local values\r\nexport " + local + "='quoted local value'\r\n" + exported + "=file-value\r\n" + empty + "=file-value\r\n"
	if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
		t.Fatal(err)
	}
	if err := Load(path); err != nil {
		t.Fatal(err)
	}
	if os.Getenv(local) != "quoted local value" || os.Getenv(exported) != "shell-value" || os.Getenv(empty) != "" {
		t.Fatal("dotenv loading or exported-value precedence failed")
	}
}

func TestMissingFileIsOptionalAndInvalidFileDoesNotLeak(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	if err := Load(path); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("SECRET='sensitive-sentinel"), 0600); err != nil {
		t.Fatal(err)
	}
	err := Load(path)
	if err == nil || strings.Contains(err.Error(), "sensitive-sentinel") || !strings.Contains(err.Error(), "DOTENV_LOAD_FAILED") {
		t.Fatal("invalid dotenv must fail with a safe diagnostic")
	}
}
