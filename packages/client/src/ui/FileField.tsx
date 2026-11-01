import { useState } from 'react';
import type { ChangeEvent, JSX, RefObject } from 'react';

/**
 * 파일 선택 컨트롤. 기본 파일 입력을 그대로 보이지 않고, 입력과 같은 상자 안에
 * 작은 버튼과 고른 파일 이름을 보여 준다. 실제 입력은 라벨 안에 두어 키보드와 스크린 리더 동작을 지킨다.
 */
export type FileFieldProps = {
  id: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  multiple?: boolean;
  accept?: string;
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
  emptyLabel?: string;
  /** 훅이 선택을 들고 있을 때 넘긴다. 화면을 다시 그려도 실제 선택과 표시가 어긋나지 않는다. */
  selectedNames?: readonly string[];
  onFiles: (files: File[]) => void;
};

export function FileField(props: FileFieldProps): JSX.Element {
  const [names, setNames] = useState<string[]>([]);
  const shown = props.selectedNames ?? names;
  const summary = shown.length === 0
    ? (props.emptyLabel ?? '선택한 파일 없음')
    : shown.length === 1
      ? shown[0]!
      : `${shown[0]!} 외 ${shown.length - 1}개`;

  return (
    <div
      className="file-field"
      data-invalid={props.invalid ? 'true' : undefined}
      data-disabled={props.disabled ? 'true' : undefined}
    >
      <label className="file-field__trigger">
        <span className="button button--small file-field__button" aria-hidden="true">파일 선택</span>
        <input
          ref={props.inputRef}
          id={props.id}
          className="file-field__input"
          type="file"
          multiple={props.multiple}
          accept={props.accept}
          disabled={props.disabled}
          aria-describedby={props.describedBy}
          aria-invalid={props.invalid ? 'true' : undefined}
          onChange={(event: ChangeEvent<HTMLInputElement>): void => {
            const files = Array.from(event.currentTarget.files ?? []);
            setNames(files.map(file => file.name));
            props.onFiles(files);
          }}
        />
      </label>
      <span className="file-field__name">{summary}</span>
    </div>
  );
}
