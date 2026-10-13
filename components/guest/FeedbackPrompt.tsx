'use client'

import { useEffect, useRef, useState } from 'react'

import {
  FEEDBACK_COMMENT_PROMPT,
  FEEDBACK_LABELS,
  FEEDBACK_MAX_COMMENT,
  FEEDBACK_QUESTION,
  FEEDBACK_YES_THANKS,
  type FeedbackAnswer,
} from '@/lib/guest/feedback'
import { safeGetItem } from '@/lib/guest/safe-storage'
import { trackEvent } from '@/lib/track'
import { cn } from '@/lib/utils'

const ANSWERS: FeedbackAnswer[] = ['yes', 'partly', 'not_really']
// If the visitor has not opened, filtered or downloaded anything, the question still appears (quietly, at the end of the list) after this long.
const DWELL_MS = 15_000

type Saved = { answer: FeedbackAnswer; hasComment: boolean }

// One discreet question at the end of the results. It never opens by itself, never covers anything, never blocks the CSV, and asks for
// nothing but the answer: a comment is optional, and there is no email or account. Answering does not lead anywhere or sell anything.
export default function FeedbackPrompt({ engaged, downloaded }: { engaged: boolean; downloaded: boolean }) {
  const [saved, setSaved] = useState<Saved | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [dwelled, setDwelled] = useState(false)
  const [choice, setChoice] = useState<FeedbackAnswer | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [commentSent, setCommentSent] = useState(false)
  const shownTracked = useRef(false)
  const commentRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/guest/feedback', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data?.feedback?.answer) {
          setSaved(data.feedback as Saved)
          setChoice(data.feedback.answer as FeedbackAnswer)
          setCommentSent(Boolean(data.feedback.hasComment))
        }
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoaded(true))
    const timer = window.setTimeout(() => setDwelled(true), DWELL_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  const visible = loaded && (engaged || dwelled || Boolean(saved))

  useEffect(() => {
    if (!visible || saved || shownTracked.current) return
    shownTracked.current = true
    void trackEvent('trial_feedback_prompt_shown', { metadata: { engaged, downloaded } })
  }, [visible, saved, engaged, downloaded])

  async function send(answer: FeedbackAnswer, text: string | null) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/guest/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer, ...(text ? { comment: text } : {}), downloaded, analyticsSessionId: safeGetItem('local', 'session_id') }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Your feedback could not be saved right now.')
      setSaved(data.feedback as Saved)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your feedback could not be saved right now.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function choose(answer: FeedbackAnswer) {
    if (busy) return
    setChoice(answer)
    setCommentSent(false)
    const ok = await send(answer, null)
    if (ok && answer !== 'yes') window.setTimeout(() => commentRef.current?.focus(), 0)
  }

  async function sendComment() {
    if (!choice || busy || !comment.trim()) return
    const ok = await send(choice, comment)
    if (ok) setCommentSent(true)
  }

  if (!visible) return null

  const answered = saved?.answer ?? null
  return (
    <section aria-labelledby="feedback-question" className="border-t border-white/10 pt-6">
      <h2 id="feedback-question" className="text-sm font-medium text-white/85">{FEEDBACK_QUESTION}</h2>
      <div role="group" aria-labelledby="feedback-question" className="mt-3 flex flex-wrap gap-2">
        {ANSWERS.map((answer) => (
          <button
            key={answer}
            type="button"
            aria-pressed={choice === answer}
            disabled={busy}
            onClick={() => void choose(answer)}
            className={cn(
              'inline-flex min-h-[44px] items-center rounded-full border px-5 text-sm outline-none transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d8c28a] disabled:opacity-60',
              choice === answer ? 'border-[#d8c28a]/70 bg-[#d8c28a]/10 text-[#d8c28a]' : 'border-white/15 text-white/70 hover:border-white/35 hover:text-white'
            )}
          >
            {FEEDBACK_LABELS[answer]}
          </button>
        ))}
      </div>

      {answered === 'yes' ? <p role="status" className="mt-4 text-sm leading-6 text-white/80">{FEEDBACK_YES_THANKS}</p> : null}

      {answered && answered !== 'yes' ? (
        commentSent ? (
          <p role="status" className="mt-4 text-sm leading-6 text-white/80">Thank you. That helps us improve.</p>
        ) : (
          <div className="mt-4 space-y-2">
            <label htmlFor="feedback-comment" className="block text-sm text-white/80">{FEEDBACK_COMMENT_PROMPT}</label>
            <textarea
              id="feedback-comment"
              ref={commentRef}
              value={comment}
              maxLength={FEEDBACK_MAX_COMMENT}
              rows={3}
              onChange={(event) => setComment(event.target.value)}
              className="block w-full rounded-lg border border-white/12 bg-white/[0.04] px-3 py-2.5 text-base text-white placeholder:text-white/35 outline-none transition focus:border-[#d8c28a]/70 sm:text-sm"
              placeholder="Optional"
            />
            <p className="text-xs text-white/50">Optional. No email or account needed. Please don&apos;t include personal details.</p>
            <button
              type="button"
              onClick={() => void sendComment()}
              disabled={busy || !comment.trim()}
              className="inline-flex min-h-[44px] items-center rounded-full border border-[#d8c28a]/50 px-5 text-sm text-[#d8c28a] outline-none transition hover:bg-[#d8c28a]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d8c28a] disabled:opacity-50"
            >
              Send
            </button>
          </div>
        )
      ) : null}

      {error ? <p role="alert" className="mt-3 text-sm text-[#e8b98a]">{error}</p> : null}
    </section>
  )
}
