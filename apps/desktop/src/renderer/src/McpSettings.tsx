// Fork-only: the settings panel for the MCP server in @inlark/mcp.
import { cn } from '@inlark/ui'
import { Button } from '@inlark/ui'
import { Check, Copy, Terminal } from '@inlark/ui/icons'
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { friendlyError } from '@inlark/core'
import type { McpMode } from '@inlark/mcp'
import type { McpBridge } from '../../preload/mcp'
import { queryClient } from './cache'
import { SegmentedControl } from './SegmentedControl'

declare global {
  interface Window {
    inlarkMcp?: McpBridge
  }
}

export const McpIcon = Terminal

const section = cn(
  'setting-section my-6.25 mx-0 [&_h4]:text-[11px] [&_h4]:font-medium [&_h4]:mt-0 [&_h4]:mb-3 [&_h4]:mx-0',
  '[&_h4]:text-secondary [&+.setting-section]:border-t [&+.setting-section]:border-solid',
  '[&+.setting-section]:border-t-border [&+.setting-section]:pt-5.5',
)
const row = cn(
  'setting-row flex items-center justify-between my-3.5 mx-0 gap-6 [&_strong]:font-normal [&_p]:text-muted',
  '[&_p]:my-[3px] [&_p]:mx-0 [&_input]:shrink-0 [&>.button]:shrink-0 [&_p]:text-[12px] [&_p]:leading-[1.6]',
  '[&_strong]:text-[13px] max-[700px]:gap-3.5',
)
const modes = [
  { value: 'off', label: 'Off' },
  { value: 'readonly', label: 'Read only' },
  { value: 'on', label: 'Full access' },
] as const satisfies readonly { value: McpMode; label: string }[]
const modeDetail: Record<McpMode, string> = {
  off: 'Assistants can’t reach your mail.',
  readonly: 'Assistants can list, search, and read your mail.',
  on: 'Assistants can also organize mail, and write and send drafts.',
}

function CopyField({
  label,
  value,
  notify,
}: {
  label: string
  value: string
  notify: (message: string, tone?: 'error' | 'info') => void
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2 mt-1.5 min-w-0">
      <code className="flex-1 min-w-0 whitespace-pre-wrap break-all font-mono text-[11px] leading-[1.7] py-1.25 px-2.25 rounded-md border border-solid border-border bg-field text-secondary select-all">
        {value}
      </code>
      <Button
        size="icon"
        variant="ghost"
        aria-label={'Copy ' + label}
        title={copied ? 'Copied' : 'Copy'}
        onClick={() =>
          void navigator.clipboard.writeText(value).then(
            () => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            },
            () => notify('Couldn’t copy. Select the text and copy it instead.', 'error'),
          )
        }
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </Button>
    </div>
  )
}

export function McpSettings({
  notify,
}: {
  notify: (message: string, tone?: 'error' | 'info') => void
}) {
  const bridge = window.inlarkMcp
  // Polls while the panel is open, so connecting a client shows up without reopening it.
  const status = useQuery({
    queryKey: ['mcp'],
    queryFn: () => bridge!.status(),
    enabled: !!bridge,
    refetchInterval: 2000,
  })
  const change = useMutation({
    mutationFn: (mode: McpMode) => bridge!.setMode(mode),
    onSuccess: (next) => queryClient.setQueryData(['mcp'], next),
    onError: (e) => notify(friendlyError(e), 'error'),
  })
  const s = status.data
  const mode = change.isPending && change.variables ? change.variables : s?.mode
  const state = !s
    ? ''
    : s.mode === 'off'
      ? 'Off'
      : s.error
        ? 'Unavailable: ' + s.error
        : !s.listening
          ? 'Starting…'
          : s.clients === 0
            ? 'Waiting for assistants'
            : s.clients === 1
              ? '1 assistant connected'
              : s.clients + ' assistants connected'

  return (
    <>
      <h3 className="m-0 text-[20px] font-[550] tracking-[-0.5px]">MCP server</h3>
      <p className="settings-lead text-muted mt-1.5 mb-6 mx-0 text-[12px] leading-[1.6]">
        Lets AI assistants such as Claude Code work with the accounts connected here, through the
        Model Context Protocol. Everything stays on this device, and assistants can only connect
        while inlark is open.
      </p>
      {!bridge ? (
        <p className="text-muted text-[12px]">
          The MCP server is only available in the desktop app.
        </p>
      ) : (
        <>
          <div className={section}>
            <h4>Access</h4>
            <div className={row}>
              <div>
                <strong>Allow assistants</strong>
                <p>
                  {mode ? modeDetail[mode] : ' '}
                  {s?.locked && ' Set by INLARK_MCP when inlark started.'}
                </p>
              </div>
              <SegmentedControl
                label="MCP access"
                value={mode ?? 'off'}
                options={modes}
                disabled={!s || s.locked || change.isPending}
                onChange={(next) => change.mutate(next)}
              />
            </div>
            <div className={row}>
              <div>
                <strong>Status</strong>
                <p
                  className={cn(s?.error && s.mode !== 'off' && 'text-danger!')}
                  aria-live="polite"
                >
                  {status.isError ? friendlyError(status.error) : state || ' '}
                </p>
              </div>
            </div>
          </div>
          <div className={section}>
            <h4>Connect an assistant</h4>
            {s?.command ? (
              <>
                <div className={cn(row, 'block')}>
                  <strong>Claude Code</strong>
                  <p>Run this once in a terminal.</p>
                  <CopyField
                    notify={notify}
                    label="Claude Code command"
                    value={'claude mcp add inlark -- ' + s.command}
                  />
                </div>
                <div className={cn(row, 'block')}>
                  <strong>Other MCP clients</strong>
                  <p>Add a stdio server that runs this command.</p>
                  <CopyField notify={notify} label="server command" value={s.command} />
                </div>
              </>
            ) : (
              <div className={row}>
                <div>
                  <strong>Command not installed</strong>
                  <p>
                    This build doesn’t include the inlark-mcp command. Run{' '}
                    <code className="font-mono text-[11px]">packages/mcp/bin/inlark-mcp.mjs</code>{' '}
                    from an inlark checkout with Node instead.
                  </p>
                </div>
              </div>
            )}
            {s && (
              <div className={cn(row, 'block')}>
                <strong>Socket</strong>
                <p>Clients reach inlark through this file, which only your user can open.</p>
                <CopyField notify={notify} label="socket path" value={s.socket} />
              </div>
            )}
          </div>
          <div className={section}>
            <h4>Safety</h4>
            <div className={row}>
              <div>
                <strong>You stay in control</strong>
                <p>
                  Assistants can only send saved drafts, which also appear in Drafts, and can’t
                  delete mail permanently. Organizing actions can be undone.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
