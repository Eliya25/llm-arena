import Link from "next/link";
import {
  MessageScreen,
  messageScreenActionClass,
} from "@/components/message-screen";

export default function NotFound() {
  return (
    <MessageScreen
      title="This page doesn't exist"
      description="The thread or page you're looking for isn't here — it may have been removed, or the link may be wrong."
      action={
        <Link href="/arena" className={messageScreenActionClass}>
          Back to the arena
        </Link>
      }
    />
  );
}
