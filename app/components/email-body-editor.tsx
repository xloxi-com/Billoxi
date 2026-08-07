import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { normalizeBodyForEditor } from "../email-templates";

type EmailBodyEditorProps = {
  label?: string;
  value: string;
  onChange: (html: string) => void;
};

export type EmailBodyEditorHandle = {
  insertText: (text: string) => void;
  focus: () => void;
};

type ToolbarCommand =
  | "bold"
  | "italic"
  | "underline"
  | "justifyLeft"
  | "justifyCenter"
  | "justifyRight"
  | "insertUnorderedList"
  | "insertOrderedList"
  | "removeFormat";

function runCommand(command: ToolbarCommand, value?: string) {
  document.execCommand(command, false, value);
}

function setFontSize(size: "small" | "normal" | "large") {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

  const px = size === "small" ? "13px" : size === "large" ? "18px" : "15px";
  document.execCommand("styleWithCSS", false, "true");
  document.execCommand("fontSize", false, "3");
  document.querySelectorAll('font[size="3"]').forEach((font) => {
    const span = document.createElement("span");
    span.style.fontSize = px;
    span.innerHTML = font.innerHTML;
    font.replaceWith(span);
  });
}

function insertPlainText(text: string) {
  if (document.queryCommandSupported?.("insertText")) {
    document.execCommand("insertText", false, text);
    return;
  }
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Lightweight rich-text body editor (bold / align / size / lists). */
export const EmailBodyEditor = forwardRef<
  EmailBodyEditorHandle,
  EmailBodyEditorProps
>(function EmailBodyEditor({ label = "Body", value, onChange }, ref) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef(value);
  const readyRef = useRef(false);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const html = normalizeBodyForEditor(value);
    if (!readyRef.current) {
      el.innerHTML = html;
      lastEmitted.current = el.innerHTML;
      readyRef.current = true;
      return;
    }
    if (value === lastEmitted.current) return;
    if (el.innerHTML === value || el.innerHTML === html) return;
    el.innerHTML = html;
    lastEmitted.current = el.innerHTML;
  }, [value]);

  const emitChange = () => {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    lastEmitted.current = html;
    onChange(html);
  };

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    insertText: (text: string) => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      insertPlainText(text);
      emitChange();
    },
  }));

  const apply = (command: ToolbarCommand) => {
    editorRef.current?.focus();
    runCommand(command);
    emitChange();
  };

  return (
    <div className="email-body-editor">
      <div className="email-body-editor__label">{label}</div>
      <div
        className="email-body-editor__toolbar"
        role="toolbar"
        aria-label="Body formatting"
      >
        <button
          type="button"
          className="email-body-editor__btn"
          title="Bold"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply("bold")}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          className="email-body-editor__btn"
          title="Italic"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply("italic")}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          className="email-body-editor__btn"
          title="Underline"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply("underline")}
        >
          <span style={{ textDecoration: "underline" }}>U</span>
        </button>
        <span className="email-body-editor__sep" />
        <button
          type="button"
          className="email-body-editor__btn"
          title="Align left"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply("justifyLeft")}
        >
          Left
        </button>
        <button
          type="button"
          className="email-body-editor__btn"
          title="Align center"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply("justifyCenter")}
        >
          Center
        </button>
        <button
          type="button"
          className="email-body-editor__btn"
          title="Align right"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply("justifyRight")}
        >
          Right
        </button>
        <span className="email-body-editor__sep" />
        <button
          type="button"
          className="email-body-editor__btn"
          title="Small text"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            editorRef.current?.focus();
            setFontSize("small");
            emitChange();
          }}
        >
          A−
        </button>
        <button
          type="button"
          className="email-body-editor__btn"
          title="Normal text"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            editorRef.current?.focus();
            setFontSize("normal");
            emitChange();
          }}
        >
          A
        </button>
        <button
          type="button"
          className="email-body-editor__btn"
          title="Large text"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            editorRef.current?.focus();
            setFontSize("large");
            emitChange();
          }}
        >
          A+
        </button>
        <span className="email-body-editor__sep" />
        <button
          type="button"
          className="email-body-editor__btn"
          title="Bullet list"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply("insertUnorderedList")}
        >
          • List
        </button>
        <button
          type="button"
          className="email-body-editor__btn"
          title="Numbered list"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply("insertOrderedList")}
        >
          1. List
        </button>
        <button
          type="button"
          className="email-body-editor__btn"
          title="Clear formatting"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply("removeFormat")}
        >
          Clear
        </button>
      </div>
      <div
        ref={editorRef}
        className="email-body-editor__surface"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        onInput={emitChange}
        onBlur={emitChange}
      />
    </div>
  );
});
