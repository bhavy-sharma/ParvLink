import { notFound } from "next/navigation";
import { ChatScreen } from "@/components/chat/chat-screen";
import { requireProfile } from "@/lib/auth/session";
import { fetchMessages, openConversation } from "@/lib/data/chat";
import { conversationSchema } from "@/lib/validation/schemas";

export const metadata = { title: "Chat" };

// On phones, let the on-screen keyboard shrink the page (where the browser
// supports it) so the message box stays above the keyboard.
export const viewport = { interactiveWidget: "resizes-content" };

/**
 * One private conversation. The id in the URL is a conversation id
 * (matches.public_id). Whether the signed-in student may open it is decided by
 * the database (chat_open): anyone who is not one of its two students — or
 * who guesses, edits or shares the URL — gets the same "not found".
 */
export default async function ChatPage({ params }) {
  await requireProfile();
  const parsed = conversationSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const chat = await openConversation(parsed.data.conversation);
  if (!chat) notFound();

  // Only the latest page; older messages are loaded on request.
  const first = await fetchMessages(chat.conversation);

  return (
    <ChatScreen
      key={chat.conversation}
      chat={chat}
      initialMessages={first.messages}
      initialHasEarlier={Boolean(first.hasEarlier)}
      initialLoadFailed={Boolean(first.error)}
    />
  );
}
