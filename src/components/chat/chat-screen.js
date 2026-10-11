"use client";

// One conversation: header, history, live updates and the message box.
//
// Where messages come from, and why they never duplicate or reorder:
//   * the first page arrives with the page (server-rendered);
//   * older pages, catch-ups and the reply to a send all return rows carrying
//     `seq` (their position in the conversation, set by the database);
//   * everything is merged by `seq` (see lib/chat/messages.js), so the same
//     row arriving twice — by any route — is shown once, in order.
//
// The live stream only says "something new was stored"; the text is then fetched
// through loadMessagesAction, which is authorised like any other read.
// Message text lives in component state only — never in browser storage.

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadMessagesAction, sendMessageAction } from "@/app/(student)/chat-actions";
import { ChatSafetyMenu } from "@/components/chat/chat-safety";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ArrowDownIcon, ArrowLeftIcon, SendIcon } from "@/components/ui/icons-extra";
import { eventPaths, ROUTES } from "@/lib/auth/routes";
import { earliestSeq, latestSeq, mergeMessages, newClientId, withoutConfirmed } from "@/lib/chat/messages";
import { CONNECTION, joinConversation } from "@/lib/chat/live";
import { leaveIfSignedOut } from "@/lib/chat/session";
import { cn } from "@/lib/cn";
import { yearLabel } from "@/lib/format";
import { MESSAGE_MAX } from "@/lib/validation/limits";

const NEAR_BOTTOM_PX = 96;
const OFFLINE_POLL_MS = 15000;
// While the live stream is connected the screen relies on its pings. This slow check is
// only a safety net for a ping that never arrives (one small request a minute
// while the tab is visible). Set to 0 to rely on the stream alone.
const LIVE_SAFETY_CHECK_MS = 60000;
const NOT_SENT = "Not sent. Check your connection and try again.";
const HISTORY_FAILED = "We could not load messages. Check your connection and try again.";

export function ChatScreen({ chat, initialMessages, initialHasEarlier, initialLoadFailed }) {
  const { conversation, partner } = chat;
  const name = partner.first_name;
  const paths = eventPaths(chat.event_slug);

  const [messages, setMessages] = useState(initialMessages);
  const [pending, setPending] = useState([]); // drafts on their way: { clientId, body, status: "sending" | "failed", error }
  const [hasEarlier, setHasEarlier] = useState(initialHasEarlier);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [historyError, setHistoryError] = useState(initialLoadFailed ? HISTORY_FAILED : "");
  const [connection, setConnection] = useState(CONNECTION.connecting);
  const [unavailable, setUnavailable] = useState(false); // learnt from a refused send
  const [unseen, setUnseen] = useState(false);
  const [draft, setDraft] = useState("");

  const canSend = chat.can_send && !unavailable;

  const scrollerRef = useRef(null);
  const inputRef = useRef(null);
  const messagesRef = useRef(initialMessages); // the list as of the latest merge (state lags a render behind)
  const syncedRef = useRef(latestSeq(initialMessages)); // we hold every message up to this seq
  const atBottomRef = useRef(true);
  const keepOffsetRef = useRef(null); // distance from the bottom to restore after older messages are added
  const firstPageMissingRef = useRef(initialLoadFailed); // the page arrived without its messages
  const syncingRef = useRef(false);
  const syncAgainRef = useRef(false);

  /** Merges rows into the list. `own` = the reply to this student's own send. */
  const apply = useCallback((incoming, { own = false } = {}) => {
    const before = messagesRef.current;
    const next = mergeMessages(before, incoming);
    if (next === before) return;
    const grewAtEnd = latestSeq(next) > latestSeq(before);
    messagesRef.current = next;
    setMessages(next);
    setPending((drafts) => withoutConfirmed(drafts, next));
    if (own) atBottomRef.current = true;
    else if (grewAtEnd && !atBottomRef.current) setUnseen(true);
  }, []);

  /** Fetches everything newer than what we hold. Calls made while one is running are folded into one more pass. */
  const catchUp = useCallback(async () => {
    if (syncingRef.current) {
      syncAgainRef.current = true;
      return;
    }
    syncingRef.current = true;
    try {
      do {
        syncAgainRef.current = false;
        // Normally "everything newer than what we hold"; if the first page never arrived, the latest page instead.
        const firstPage = firstPageMissingRef.current;
        const query = firstPage ? { conversation } : { conversation, after: syncedRef.current };
        const result = await loadMessagesAction(query).catch(() => null);
        if (!result?.ok) {
          if ((!result || result.code === "not_authenticated") && (await leaveIfSignedOut())) return;
          setHistoryError(result?.error ?? HISTORY_FAILED);
          return;
        }
        setHistoryError("");
        if (firstPage) {
          firstPageMissingRef.current = false;
          setHasEarlier(Boolean(result.hasEarlier));
          syncedRef.current = Math.max(syncedRef.current, latestSeq(result.messages));
          apply(result.messages);
        } else if (result.messages.length > 0) {
          syncedRef.current = Math.max(syncedRef.current, latestSeq(result.messages));
          apply(result.messages);
          if (result.messages.length >= 100) syncAgainRef.current = true; // a full page: there may be more
        }
      } while (syncAgainRef.current);
    } finally {
      syncingRef.current = false;
    }
  }, [conversation, apply]);

  // --- live updates -------------------------------------------------------------
  // Joined while this screen is shown; left (stream closed) as soon as it is not,
  // so a previously opened conversation can never keep delivering here.
  useEffect(() => {
    return joinConversation({
      conversation,
      onPing: catchUp,
      onStatus: (status) => {
        setConnection(status);
        if (status === CONNECTION.live) catchUp(); // anything missed while joining or reconnecting
      },
    });
  }, [conversation, catchUp]);

  // Without the live stream, check every 15 seconds; with it, only the slow safety net. Also check when the tab is looked at again.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") catchUp();
    };
    document.addEventListener("visibilitychange", onVisible);
    const every = connection === CONNECTION.live ? LIVE_SAFETY_CHECK_MS : OFFLINE_POLL_MS;
    const timer = every > 0 ? setInterval(onVisible, every) : null;
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearInterval(timer);
    };
  }, [connection, catchUp]);

  // --- scrolling ----------------------------------------------------------------
  // Open at the newest message. Afterwards follow new messages only if the
  // reader is already at the bottom; never yank them away from older history.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (keepOffsetRef.current !== null) {
      scroller.scrollTop = scroller.scrollHeight - keepOffsetRef.current;
      keepOffsetRef.current = null;
    } else if (atBottomRef.current) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [messages, pending]);

  // Grow the message box with its text, up to a limit (then it scrolls).
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight + 2, 160)}px`;
  }, [draft]);

  function onScroll(event) {
    const scroller = event.currentTarget;
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_BOTTOM_PX;
    atBottomRef.current = atBottom;
    if (atBottom) setUnseen(false);
  }

  function jumpToLatest() {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    atBottomRef.current = true;
    scroller.scrollTop = scroller.scrollHeight;
    setUnseen(false);
  }

  async function loadEarlier() {
    const before = earliestSeq(messagesRef.current);
    if (before === null || loadingEarlier) return;
    setLoadingEarlier(true);
    const result = await loadMessagesAction({ conversation, before }).catch(() => null);
    setLoadingEarlier(false);
    if (!result?.ok) {
      if ((!result || result.code === "not_authenticated") && (await leaveIfSignedOut())) return;
      setHistoryError(result?.error ?? HISTORY_FAILED);
      return;
    }
    setHistoryError("");
    setHasEarlier(Boolean(result.hasEarlier));
    const scroller = scrollerRef.current;
    if (scroller) keepOffsetRef.current = scroller.scrollHeight - scroller.scrollTop;
    apply(result.messages);
  }

  // --- sending ------------------------------------------------------------------
  async function deliver({ clientId, body }) {
    const result = await sendMessageAction({ conversation, body, clientId }).catch(() => null);
    if (result?.ok) {
      apply([result.message], { own: true });
      setPending((drafts) => drafts.filter((item) => item.clientId !== clientId));
      // Our message may have been stored after one we have not fetched yet.
      if (result.message.seq > syncedRef.current + 1) catchUp();
      else syncedRef.current = Math.max(syncedRef.current, result.message.seq);
      return;
    }
    if ((!result || result.code === "not_authenticated") && (await leaveIfSignedOut())) return;
    if (result?.code === "messaging_unavailable" || result?.code === "conversation_not_found") setUnavailable(true);
    setPending((drafts) => drafts.map((item) => (item.clientId === clientId ? { ...item, status: "failed", error: result?.error ?? NOT_SENT } : item)));
  }

  function submit(event) {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || [...body].length > MESSAGE_MAX || !canSend) return;
    // The id travels with this message through every retry, so it is stored once.
    const item = { clientId: newClientId(), body, status: "sending", error: "" };
    atBottomRef.current = true;
    setUnseen(false);
    setPending((drafts) => [...drafts, item]);
    setDraft("");
    inputRef.current?.focus();
    deliver(item);
  }

  function retry(item) {
    setPending((drafts) => drafts.map((entry) => (entry.clientId === item.clientId ? { ...entry, status: "sending", error: "" } : entry)));
    deliver(item);
  }

  function discard(item) {
    setPending((drafts) => drafts.filter((entry) => entry.clientId !== item.clientId));
  }

  function onKeyDown(event) {
    // Enter sends on a keyboard; on touch screens Enter makes a new line (there is a Send button).
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    if (window.matchMedia?.("(pointer: coarse)").matches) return;
    event.preventDefault();
    submit();
  }

  const length = [...draft].length;
  const tooLong = length > MESSAGE_MAX;
  const isEmpty = messages.length === 0 && pending.length === 0;

  return (
    <section
      aria-label={`Chat with ${name}`}
      className={cn(
        "flex min-h-[22rem] flex-col overflow-hidden border-line bg-surface",
        // Phones: edge to edge, from under the top bar to the bottom of the screen.
        "max-sm:-mx-4 max-sm:-mb-28 max-sm:-mt-8 max-sm:h-[calc(100dvh-4rem)] max-sm:border-b",
        "sm:h-[calc(100dvh-10.5rem)] sm:rounded-panel sm:border",
      )}
    >
      {/* --- header ------------------------------------------------------------------- */}
      <header className="flex items-center gap-2 border-b border-line px-2 py-2.5 sm:gap-3 sm:px-4">
        <Link
          href={ROUTES.matches}
          aria-label="Back to my matches"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink hover:bg-brand-soft"
        >
          <ArrowLeftIcon />
        </Link>
        <Avatar src={partner.has_photo ? paths.photo(partner.handle) : null} name={name} size="sm" className="size-11 text-lg" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-lg font-bold leading-tight">{name}</h1>
          <p className="truncate text-sm text-ink-muted">
            <Link href={paths.partners} className="font-semibold text-brand underline">
              {chat.event_title}
            </Link>
            <span className="max-sm:hidden">
              {" · "}
              {partner.course}
              {partner.study_year ? `, ${yearLabel(partner.study_year).toLowerCase()}` : ""}
            </span>
          </p>
        </div>
        <ChatSafetyMenu conversation={conversation} name={name} showBlock={!chat.blocked_by_me} />
      </header>

      {connection === CONNECTION.offline ? (
        <p role="status" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-marigold/50 bg-marigold-soft px-4 py-2 text-sm text-marigold-ink">
          <span>Live updates are paused. New messages may take a little longer to appear.</span>
          <button type="button" onClick={catchUp} className="font-semibold underline">
            Reload messages
          </button>
        </p>
      ) : null}

      {/* --- history ------------------------------------------------------------------ */}
      <div className="relative min-h-0 flex-1">
        <div ref={scrollerRef} onScroll={onScroll} className="h-full overflow-y-auto overscroll-contain bg-paper/60 px-3 py-4 sm:px-5" data-testid="chat-scroller">
          {hasEarlier ? (
            <div className="mb-4 flex justify-center">
              <Button variant="secondary" size="sm" onClick={loadEarlier} disabled={loadingEarlier} aria-busy={loadingEarlier || undefined}>
                {loadingEarlier ? "Loading…" : "Load earlier messages"}
              </Button>
            </div>
          ) : !isEmpty ? (
            <p className="mb-4 text-center text-xs text-ink-muted">This is the start of your conversation with {name}.</p>
          ) : null}

          {historyError ? (
            <p role="alert" className="mx-auto mb-4 flex max-w-md flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-field border border-danger/30 bg-danger-soft px-4 py-2.5 text-center text-sm text-danger">
              <span>{historyError}</span>
              <button type="button" onClick={catchUp} className="font-semibold underline">
                Try again
              </button>
            </p>
          ) : null}

          {isEmpty && !historyError ? (
            <div className="flex h-full min-h-40 flex-col items-center justify-center px-4 text-center">
              <p className="font-display text-xl font-semibold">You and {name} matched</p>
              <p className="mt-1.5 max-w-sm text-sm text-ink-muted">
                {canSend ? `No messages yet. Say hello and plan ${chat.event_title} together.` : "No messages were exchanged in this conversation."}
              </p>
            </div>
          ) : null}

          <ol role="log" aria-label="Messages" aria-live="polite" className="space-y-1.5">
            {messages.map((message, index) => {
              const previous = messages[index - 1];
              const newDay = !previous || previous.day_label !== message.day_label;
              const newSpeaker = newDay || previous.mine !== message.mine;
              return (
                <li key={message.seq} data-seq={message.seq} data-mine={message.mine ? "true" : "false"} className={cn(newSpeaker && !newDay && "pt-2")}>
                  {newDay ? (
                    <p className="my-3 flex items-center gap-3 text-xs font-semibold text-ink-muted before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
                      {message.day_label}
                    </p>
                  ) : null}
                  <Bubble mine={message.mine} author={message.mine ? "You" : name} body={message.body}>
                    <time dateTime={message.created_at}>{message.time_label}</time>
                  </Bubble>
                </li>
              );
            })}
            {pending.map((item) => (
              <li key={item.clientId} data-pending={item.status} className="pt-0.5">
                <Bubble mine author="You" body={item.body} faded={item.status === "sending"} failed={item.status === "failed"}>
                  {item.status === "sending" ? (
                    "Sending…"
                  ) : (
                    <span role="alert" className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 font-semibold text-danger">
                      <span>{item.error}</span>
                      {canSend ? (
                        <button type="button" onClick={() => retry(item)} className="underline">
                          Try again
                        </button>
                      ) : null}
                      <button type="button" onClick={() => discard(item)} className="underline">
                        Discard
                      </button>
                    </span>
                  )}
                </Bubble>
              </li>
            ))}
          </ol>
        </div>

        {unseen ? (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white shadow-panel"
          >
            <ArrowDownIcon className="size-4" />
            New messages
          </button>
        ) : null}
      </div>

      {/* --- message box -------------------------------------------------------------- */}
      <footer className="border-t border-line bg-surface px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-4">
        {canSend ? (
          <form onSubmit={submit} className="flex items-end gap-2">
            <label htmlFor={`message-${conversation}`} className="sr-only">
              Message to {name}
            </label>
            <textarea
              ref={inputRef}
              id={`message-${conversation}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              maxLength={MESSAGE_MAX + 200}
              placeholder="Write a message"
              autoComplete="off"
              enterKeyHint="send"
              aria-invalid={tooLong || undefined}
              aria-describedby={`message-help-${conversation}`}
              className={cn(
                "max-h-40 min-h-11 w-full flex-1 resize-none rounded-[1.375rem] border bg-surface px-4 py-2.5 leading-snug text-ink placeholder:text-ink-muted/70",
                "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand",
                tooLong ? "border-danger" : "border-line-strong",
              )}
            />
            <Button type="submit" disabled={!draft.trim() || tooLong} className="size-11 shrink-0 px-0 sm:w-auto sm:px-5" aria-label="Send message">
              <SendIcon className="size-6 sm:hidden" strokeWidth="2.2" />
              <span className="max-sm:hidden">Send</span>
            </Button>
          </form>
        ) : (
          <div role="status" className="rounded-field bg-paper px-4 py-3 text-sm text-ink-muted">
            <p className="font-semibold text-ink">Messaging is unavailable in this conversation.</p>
            <p>
              You can still read the messages above.
              {chat.blocked_by_me ? (
                <>
                  {" "}
                  You blocked {name}; you can unblock them from{" "}
                  <Link href={ROUTES.matches} className="font-semibold text-brand underline">
                    your Matches page
                  </Link>
                  .
                </>
              ) : null}
            </p>
          </div>
        )}
        <div id={`message-help-${conversation}`} className="mt-2 text-xs text-ink-muted">
          {canSend && length > MESSAGE_MAX - 200 ? (
            <p className={cn("mb-1 text-right font-semibold", tooLong && "text-danger")} aria-live="polite">
              {length} / {MESSAGE_MAX}
              {tooLong ? " — too long to send" : ""}
            </p>
          ) : null}
          <details>
            <summary className="cursor-pointer">
              Stay safe: do not share passwords, OTPs, bank or payment details, or your home address with someone you do not know well.
            </summary>
            <p className="mt-1.5">
              Only you and {name} can open this conversation. Messages are stored on Campus Partner Finder’s servers so that both of you can read them
              later; they are not end-to-end encrypted. If either of you reports the conversation, that person can choose to share recent messages
              with moderators. Messages cannot be edited or deleted after sending.
            </p>
          </details>
        </div>
      </footer>
    </section>
  );
}

/** One message. The text is rendered as plain text (React escapes it); line breaks are kept by CSS. */
function Bubble({ mine, author, body, faded = false, failed = false, children }) {
  return (
    <div className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2 sm:max-w-[70%]",
          mine ? "rounded-br-md" : "rounded-bl-md border border-line bg-surface text-ink",
          mine && (failed ? "bg-danger-soft text-ink ring-1 ring-danger/40" : "bg-brand text-white"),
          faded && "opacity-70",
        )}
      >
        <span className="sr-only">{author}: </span>
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{body}</p>
      </div>
      <p className="mt-0.5 px-1 text-[0.6875rem] text-ink-muted">{children}</p>
    </div>
  );
}
