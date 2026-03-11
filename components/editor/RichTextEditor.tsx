'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect } from 'react'

export default function RichTextEditor({
  content,
  onChange,
}: {
  content: string
  onChange: (html: string) => void
}) {
  const editor = useEditor({
    extensions: [StarterKit],
    content,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'min-h-[140px] max-h-[260px] overflow-y-auto p-4 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none',
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getHTML())
    },
  })

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content)
    }
  }, [content, editor])

  if (!editor) return null

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex gap-2 p-2 rounded-lg bg-white/5 border border-white/10">
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className="editor-btn"
          type="button"
        >
          <b>B</b>
        </button>

        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className="editor-btn italic"
          type="button"
        >
          I
        </button>

        <button
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className="editor-btn"
          type="button"
        >
          • List
        </button>

        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className="editor-btn"
          type="button"
        >
          H2
        </button>
      </div>

      {/* Editor */}
      <EditorContent editor={editor} />
    </div>
  )
}