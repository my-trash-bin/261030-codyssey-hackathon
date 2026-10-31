// Package envfile loads optional local configuration without replacing exported values.
package envfile

import (
	"errors"
	"os"

	"github.com/joho/godotenv"
)

func Load(path string) error {
	if err := godotenv.Load(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		// Parser errors can contain the original line, including credentials.
		return errors.New("DOTENV_LOAD_FAILED: .env 파일을 읽거나 해석할 수 없습니다")
	}
	return nil
}
