/** Preserve the reader's semantic position through density reflow, including
 * a mounted chat hidden behind Settings. No gateway or view identity changes. */
export function bindTranscriptAppearance(body: HTMLElement, input: HTMLTextAreaElement) {
  type Anchor = { target: Element | Range; offset: number; bottom: boolean };
  let anchor: Anchor | undefined;
  let pending = false;
  const capture = () => {
    if (pending || !body.clientHeight) return;
    const box = body.getBoundingClientRect();
    const blocks = [...body.querySelectorAll('p, li, pre, .bubble-user, .toolcard, .replycard')];
    let target: Element | Range | undefined = blocks.find(el => {
      const r = el.getBoundingClientRect(); return r.top >= box.top && r.top < box.bottom;
    });
    if (!target) {
      // A single long paragraph can occupy the entire viewport. Anchor a text
      // caret instead of its offscreen beginning, when the browser supports it.
      const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
      const caret = doc.caretRangeFromPoint?.(box.left + 24, box.top + 12);
      if (caret && body.contains(caret.startContainer)) target = caret;
      else target = blocks.find(el => el.getBoundingClientRect().bottom > box.top);
    }
    if (target) anchor = { target, offset: target.getBoundingClientRect().top - box.top, bottom: body.scrollHeight - body.scrollTop - body.clientHeight < 3 };
  };
  const restore = () => {
    if (!pending || !body.clientHeight) return;
    // Re-measure multiline drafts at the new type size before restoring history.
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
    if (anchor) {
      const node = anchor.target instanceof Range ? anchor.target.startContainer : anchor.target;
      if (body.contains(node)) {
        body.scrollTop = anchor.bottom ? body.scrollHeight : body.scrollTop + anchor.target.getBoundingClientRect().top - body.getBoundingClientRect().top - anchor.offset;
      }
    }
    pending = false;
    body.dispatchEvent(new Event('scroll'));
  };
  const change = () => { pending = true; restore(); };
  const observer = new ResizeObserver(restore);
  observer.observe(body);
  body.addEventListener('scroll', capture);
  document.addEventListener('hermes-appearance-before', capture);
  document.addEventListener('hermes-appearance-change', change);
  capture();
  return () => {
    observer.disconnect(); body.removeEventListener('scroll', capture);
    document.removeEventListener('hermes-appearance-before', capture);
    document.removeEventListener('hermes-appearance-change', change);
  };
}

export interface TranscriptAnchor { scale: string; block: number; offset: number }
const BLOCKS = 'p, li, pre, .bubble-user, .toolcard, .replycard';
export function captureTranscriptAnchor(body: HTMLElement): TranscriptAnchor | undefined {
  if (!body.clientHeight) return undefined;
  const box = body.getBoundingClientRect(), blocks = [...body.querySelectorAll(BLOCKS)];
  let block = blocks.findIndex(el => { const r=el.getBoundingClientRect(); return r.top>=box.top && r.top<box.bottom; });
  if (block<0) block=blocks.findIndex(el=>el.getBoundingClientRect().bottom>box.top);
  if (block<0) return undefined;
  return { scale: document.documentElement.dataset.uiScale || '100', block, offset: blocks[block].getBoundingClientRect().top-box.top };
}
export function restoreTranscriptScroll(body: HTMLElement, saved: { top: number; atBottom: boolean; anchor?: TranscriptAnchor }) {
  if (saved.atBottom) { body.scrollTop=body.scrollHeight; return; }
  body.scrollTop=saved.top;
  const anchor=saved.anchor;
  if (!anchor || anchor.scale===(document.documentElement.dataset.uiScale || '100')) return;
  const block=body.querySelectorAll(BLOCKS)[anchor.block];
  if (block) body.scrollTop+=block.getBoundingClientRect().top-body.getBoundingClientRect().top-anchor.offset;
}
