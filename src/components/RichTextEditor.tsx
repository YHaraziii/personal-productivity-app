/**
 * Rich-text description editor: bold, italic, bullet / numbered lists and
 * links. Output is sanitized before it leaves the component, links are
 * validated (http, https and mailto only), and the stored HTML is sanitized
 * again whenever it is displayed (see RichText).
 */
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useId, useState } from 'react'
import { isSafeUrl, normalizeUrl, sanitizeHtml } from '../lib/sanitize'
import { Icon } from './Icon'

interface Props {
  value: string
  onChange: (html: string) => void
  label: string
}

export function RichTextEditor({ value, onChange, label }: Props) {
  const labelId = useId()
  const [linkDraft, setLinkDraft] = useState<string | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: 'https',
          protocols: ['http', 'https', 'mailto'],
          isAllowedUri: (url) => isSafeUrl(url),
          HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
        },
      }),
    ],
    content: sanitizeHtml(value),
    editorProps: {
      attributes: {
        class: 'rich-input',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-labelledby': labelId,
      },
    },
    onUpdate: ({ editor: e }) => onChange(sanitizeHtml(e.getHTML())),
  })

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive('bold') ?? false,
      italic: e?.isActive('italic') ?? false,
      bullet: e?.isActive('bulletList') ?? false,
      ordered: e?.isActive('orderedList') ?? false,
      link: e?.isActive('link') ?? false,
    }),
  })

  // Accept external value resets (e.g. restoring a preserved draft).
  useEffect(() => {
    if (!editor) return
    const clean = sanitizeHtml(value)
    if (clean !== sanitizeHtml(editor.getHTML())) editor.commands.setContent(clean, { emitUpdate: false })
  }, [editor, value])

  if (!editor) return null

  const applyLink = () => {
    if (linkDraft === null) return
    if (linkDraft.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      setLinkDraft(null)
      return
    }
    const url = normalizeUrl(linkDraft)
    if (!url) {
      setLinkError('Enter a web address (https://…) or an e-mail address. Other link types are not allowed.')
      return
    }
    if (editor.state.selection.empty && !active?.link) {
      editor.chain().focus().insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }).run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
    setLinkDraft(null)
    setLinkError(null)
  }

  const tool = (name: Parameters<typeof Icon>[0]['name'], text: string, pressed: boolean, run: () => void) => (
    <button
      type="button"
      className={`tool ${pressed ? 'tool-on' : ''}`}
      aria-label={text}
      title={text}
      aria-pressed={pressed}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      <Icon name={name} />
    </button>
  )

  return (
    <div className="field">
      <span className="field-label" id={labelId}>
        {label}
      </span>
      <div className="rich-editor">
        <div className="rich-toolbar" role="toolbar" aria-label="Formatting">
          {tool('bold', 'Bold', !!active?.bold, () => editor.chain().focus().toggleBold().run())}
          {tool('italic', 'Italic', !!active?.italic, () => editor.chain().focus().toggleItalic().run())}
          {tool('list', 'Bullet list', !!active?.bullet, () => editor.chain().focus().toggleBulletList().run())}
          <button
            type="button"
            className={`tool ${active?.ordered ? 'tool-on' : ''}`}
            aria-label="Numbered list"
            title="Numbered list"
            aria-pressed={!!active?.ordered}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <span aria-hidden="true" className="tool-text">1.</span>
          </button>
          {tool('link', active?.link ? 'Edit link' : 'Add link', !!active?.link, () => {
            setLinkError(null)
            setLinkDraft((editor.getAttributes('link').href as string | undefined) ?? '')
          })}
        </div>
        {linkDraft !== null && (
          <div className="link-row">
            <input
              className="input"
              autoFocus
              aria-label="Link address"
              placeholder="https://example.com (leave empty to remove the link)"
              value={linkDraft}
              onChange={(e) => setLinkDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  applyLink()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  setLinkDraft(null)
                }
              }}
            />
            <button type="button" className="button button-small button-primary" onClick={applyLink}>
              Apply
            </button>
            <button type="button" className="button button-small" onClick={() => setLinkDraft(null)}>
              Cancel
            </button>
            {linkError && (
              <p className="field-error" role="alert">
                {linkError}
              </p>
            )}
          </div>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

/** Display stored rich text. Always re-sanitized: stored data is not trusted. */
export function RichText({ html, className = 'rich-text' }: { html: string; className?: string }) {
  const clean = sanitizeHtml(html)
  if (!clean) return null
  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />
}
