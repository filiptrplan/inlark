import { cn } from '@inlark/ui'
import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from '@inlark/ui/icons'
import type { Message } from '@inlark/core'
import { ShortcutHint } from './shortcuts'
import { copyVerificationCode, verificationCode } from './verification-code'

/** A recent message's sign-in code, copyable before the reader has to dig it out of the body. */
export function VerificationCodeChip({ message }: { message: Message }) {
  const code = verificationCode(message)
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  if (!code) return null
  const copy = () => {
    window.clearTimeout(timer.current)
    void copyVerificationCode(code).then(
      () => setStatus('copied'),
      () => setStatus('failed'),
    )
    timer.current = window.setTimeout(() => setStatus('idle'), 1500)
  }
  return (
    <div className="verification-code mb-4.5">
      <button
        type="button"
        className={cn(
          'verification-code-chip inline-flex items-center gap-3 py-2 pr-2.5 pl-3.5 rounded-xl border border-solid',
          'border-border-strong bg-surface text-left transition-[background,border-color] duration-120 ease-[ease]',
          'hover:bg-hover hover:border-foreground/22',
        )}
        onClick={copy}
        title="Copy verification code"
      >
        <span className="text-[11px] text-muted">Verification code</span>
        <span className="select-text font-mono text-[18px] font-medium tracking-[0.12em] tabular-nums text-foreground">
          {code}
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-[11px]',
            status === 'copied' ? 'text-success' : 'text-secondary',
          )}
        >
          {status === 'copied' ? <Check size={13} /> : <Copy size={13} />}
          {status === 'copied' ? 'Copied' : 'Copy'}
          {status === 'idle' && <ShortcutHint id="copyCode" />}
        </span>
      </button>
      <span className="sr-only" role="status">
        {status === 'copied'
          ? 'Copied verification code'
          : status === 'failed'
            ? 'Could not copy. Select the code instead.'
            : ''}
      </span>
      {status === 'failed' && (
        <span className="ml-3 text-[11px] text-danger" aria-hidden="true">
          Couldn’t copy, select the code instead
        </span>
      )}
    </div>
  )
}
