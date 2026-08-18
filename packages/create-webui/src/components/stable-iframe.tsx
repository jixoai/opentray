/**
 * StableIframe — a reload-proof service preview surface (owner round: tab
 * switches must NEVER reload the service page).
 *
 * Tabs (Base UI) unmount inactive panels by default, which destroyed and
 * recreated every <iframe> on each switch — a full page reload per hop. This
 * component removes the iframe from tab lifecycle entirely:
 *
 *  - ONE <iframe> per service port lives for the whole preview lifetime,
 *    mounted in a persistent layer OUTSIDE any TabsContent
 *  - switching tabs only flips CSS visibility (display:none keeps the
 *    browsing context alive; the document, scroll position, and app state
 *    survive every hop)
 *  - navigation is explicit: setting src reloads ONLY when the caller
 *    actually navigated; re-renders with the same url never touch it
 *  - mount/unmount follows the service's presence in iframeTabs (a service
 *    disappearing removes its surface; coming back is a fresh load, matching
 *    a restart of the preview)
 */
import * as React from "react";

export interface StableIframeProps {
  /** Service port — the stable identity of this browsing context. */
  readonly port: number;
  /** Current URL. Changing it navigates; equal values never reload. */
  readonly url: string;
  /** Visible only when this service's tab is active. */
  readonly visible: boolean;
  readonly className?: string;
}

export const StableIframe = React.memo(
  ({ port, url, visible, className }: StableIframeProps): React.JSX.Element => {
    const frameRef = React.useRef<HTMLIFrameElement | null>(null);
    const lastUrlRef = React.useRef<string>(url);

    // Navigate ONLY on a real url change — never on mount-after-hide, never
    // on a re-render with the same url (that is what reloaded the page).
    React.useEffect(() => {
      const frame = frameRef.current;
      if (frame === null) {
        lastUrlRef.current = url;
        return;
      }
      if (lastUrlRef.current === url) {
        return;
      }
      lastUrlRef.current = url;
      frame.src = url;
    }, [url]);

    return (
      <iframe
        ref={frameRef}
        title={`service-${port}`}
        src={url}
        className={className}
        style={{
          width: "100%",
          height: "100%",
          border: 0,
          background: "#fff",
          display: visible ? "block" : "none",
        }}
        sandbox="allow-same-origin allow-scripts allow-forms"
      />
    );
  },
);
StableIframe.displayName = "StableIframe";
