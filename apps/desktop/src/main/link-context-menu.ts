import { Menu, clipboard, type WebContents } from 'electron'

/** What to put on the clipboard for a link: mail addresses lose the `mailto:` and any query. */
export function copyableLink(url: string): { label: string; text: string } {
  if (!/^mailto:/i.test(url)) return { label: 'Copy Link Address', text: url }
  try {
    const address = decodeURIComponent(url.slice('mailto:'.length).split('?')[0])
    if (address) return { label: 'Copy Email Address', text: address }
  } catch {
    // A malformed escape: fall back to copying the link as written.
  }
  return { label: 'Copy Link Address', text: url }
}

/** Right-clicking a link, in the reader or the composer, offers to copy where it points. */
export function attachLinkContextMenu(contents: WebContents): void {
  contents.on('context-menu', (_event, params) => {
    const url = params.linkURL
    if (!/^(https?|mailto):/i.test(url)) return
    const { label, text } = copyableLink(url)
    Menu.buildFromTemplate([{ label, click: () => clipboard.writeText(text) }]).popup()
  })
}
