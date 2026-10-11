// Live updates for one chat screen, over Server-Sent Events.
//
// What travels over this connection: a content-free "new message" ping
// ({ seq }) per stored message. Message text is NEVER sent over it; on a ping
// the screen fetches the new messages through the same authorised Server Action
// it uses for history.
//
// Who may listen: the stream is an ordinary same-site request, so it carries
// the httpOnly session cookie. The route checks on connect, and again on every
// tick, that the caller is one of the two students of the conversation. No
// token is handed to page scripts for this.

import { chatPath } from "@/lib/auth/routes";

export const CONNECTION = Object.freeze({ connecting: "connecting", live: "live", offline: "offline" });

// The server ends each stream after a while and the browser reconnects by
// itself; that normal hand-over must not be shown as "offline".
const GRACE_MS = 5000;
const RETRY_MS = 15000;

/**
 * Listens to one conversation.
 *   onPing()          a message was stored in this conversation
 *   onStatus(status)  CONNECTION.live when connected, CONNECTION.offline when it stays down
 * Returns a function that closes the connection.
 */
export function joinConversation({ conversation, onPing, onStatus }) {
  let closed = false;
  let source = null;
  let offlineTimer = null;
  let retryTimer = null;

  const clearTimers = () => {
    clearTimeout(offlineTimer);
    clearTimeout(retryTimer);
    offlineTimer = null;
    retryTimer = null;
  };

  const connect = () => {
    if (closed) return;
    source = new EventSource(`${chatPath(conversation)}/events`);
    source.addEventListener("ready", () => {
      if (closed) return;
      clearTimers();
      onStatus(CONNECTION.live);
    });
    source.addEventListener("message", () => {
      if (!closed) onPing();
    });
    source.addEventListener("error", () => {
      if (closed) return;
      // Report "offline" only if the connection has not come back shortly.
      offlineTimer ??= setTimeout(() => {
        offlineTimer = null;
        if (!closed) onStatus(CONNECTION.offline);
      }, GRACE_MS);
      // The browser retries by itself unless the server refused the request
      // (signed out, no longer a participant). Then try again later, slowly.
      if (source.readyState === EventSource.CLOSED) {
        source.close();
        retryTimer ??= setTimeout(() => {
          retryTimer = null;
          connect();
        }, RETRY_MS);
      }
    });
  };
  connect();

  return () => {
    closed = true;
    clearTimers();
    source?.close();
  };
}
