// Live-update stream for one conversation (Server-Sent Events).
//
// Sends { seq } — the number of the latest stored message — whenever it grows.
// Never message text. The caller must be one of the two students of the
// conversation: that is checked when the stream opens and again on every tick,
// so a block, a suspension or a deleted account ends the stream.
//
// Each stream ends by itself after a while (serverless functions cannot stay
// open for ever); the browser's EventSource reconnects automatically.

import { getCurrentUser } from "@/lib/auth/session";
import { run } from "@/lib/services";
import { contextFor } from "@/lib/services/core";
import { conversationSchema } from "@/lib/validation/schemas";

export const maxDuration = 60;

const TICK_MS = 1500;
const STREAM_MS = 50_000;
const refuse = (status) => new Response(null, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return refuse(401);
  const parsed = conversationSchema.safeParse(await params);
  if (!parsed.success) return refuse(404);
  const conversation = parsed.data.conversation;

  // A fresh context for every look, so a change of standing is seen at once.
  const latest = async () => run(await contextFor(user.id), "chat_latest_seq", { p_conversation: conversation });
  const first = await latest();
  if (first.error) return refuse(404); // not a participant and "does not exist" look the same

  const encoder = new TextEncoder();
  let timer = null;
  const stream = new ReadableStream({
    start(controller) {
      const startedAt = Date.now();
      let seen = first.data;
      let busy = false;
      const send = (text) => controller.enqueue(encoder.encode(text));
      const end = () => {
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      send(`retry: 2000\nevent: ready\ndata: ${JSON.stringify({ seq: seen })}\n\n`);
      timer = setInterval(async () => {
        if (busy) return;
        if (request.signal.aborted || Date.now() - startedAt > STREAM_MS) return end();
        busy = true;
        try {
          const { data, error } = await latest();
          if (error) return end();
          if (data > seen) {
            seen = data;
            send(`data: ${JSON.stringify({ seq: seen })}\n\n`);
          } else {
            send(": keep-alive\n\n");
          }
        } catch {
          end();
        } finally {
          busy = false;
        }
      }, TICK_MS);
      request.signal.addEventListener("abort", end);
    },
    cancel() {
      clearInterval(timer);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
