import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { websiteStoreConfig } from "../config/appConfig";
import { api } from "../services/api";
import { sendSupportMessage, subscribeSupportMessages } from "../services/firebase/operations";
import type { AppUser, MenuItem } from "../types/domain";
import { assistantSourceLabel } from "../utils/display";

type AssistantMessage = {
  id: string;
  from: "bot" | "user";
  text: string;
  source?: string;
  createdAt: number;
};

type RequestStatus = "idle" | "sending" | "error";

type CustomerAssistantProps = {
  user: Pick<AppUser, "uid" | "name">;
  menu: MenuItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const suggestions = [
  "What meals are available?",
  "What are your store hours?",
  "Do you deliver to my barangay?",
  "Where is my order?"
];

const messageId = (prefix: string): string => `${prefix}-${Date.now()}-${crypto.randomUUID()}`;

export default function CustomerAssistant({ user, menu, open, onOpenChange }: CustomerAssistantProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<AssistantMessage[]>([{
    id: "welcome",
    from: "bot",
    text: "Hi! Ask about menu items, store details, delivery, payment, or your order.",
    createdAt: Date.now()
  }]);
  const [requestStatus, setRequestStatus] = useState<RequestStatus>("idle");
  const [failedMessage, setFailedMessage] = useState("");
  const receivedSupportReplies = useRef(new Set<string>());
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    return subscribeSupportMessages((supportMessages) => {
      const newReplies = supportMessages.filter((message) =>
        message.senderRole === "staff" && !receivedSupportReplies.current.has(message.id)
      );
      if (newReplies.length === 0) return;
      newReplies.forEach((message) => receivedSupportReplies.current.add(message.id));
      setMessages((current) => [
        ...current,
        ...newReplies.map((message): AssistantMessage => ({
          id: message.id,
          from: "bot",
          text: message.text,
          source: `Staff support - ${message.senderName}`,
          createdAt: message.createdAt
        }))
      ]);
    }, user.uid);
  }, [open, user.uid]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, open, requestStatus]);

  const requestAnswer = async (message: string, { saveSupportMessage = true } = {}) => {
    setRequestStatus("sending");
    setFailedMessage("");
    if (saveSupportMessage) {
      setMessages((current) => [...current, {
        id: messageId("user"),
        from: "user",
        text: message,
        createdAt: Date.now()
      }]);
      void sendSupportMessage(message, user, {
        customerId: user.uid,
        customerName: user.name,
        conversationId: user.uid
      }).catch(() => {});
    }

    try {
      const response = await api.assistant(message, user.uid, {
        menu: menu.map(({ name, description, allergens, category, price, stock, unavailable }) => ({
          name,
          description: description || "",
          allergens: allergens || [],
          category,
          price,
          stock: Number(stock || 0),
          unavailable: Boolean(unavailable)
        })),
        store: {
          hours: websiteStoreConfig.hours.map((entry) => `${entry.label}: ${entry.closed ? "Closed" : `${entry.opens}-${entry.closes}`}`).join("; "),
          serviceArea: `${websiteStoreConfig.serviceAreaLabel}. ${websiteStoreConfig.serviceAreaDetail}`,
          orderOptions: Object.entries(websiteStoreConfig.serviceAvailability).filter(([, available]) => available).map(([option]) => option),
          paymentMethods: websiteStoreConfig.paymentMethods,
          prepTime: `${websiteStoreConfig.prepTimeMinutes.min}-${websiteStoreConfig.prepTimeMinutes.max} minutes`
        }
      });
      setMessages((current) => [...current, {
        id: messageId("reply"),
        from: "bot",
        text: response.text,
        source: response.source,
        createdAt: Date.now()
      }]);
      setRequestStatus("idle");
    } catch {
      setFailedMessage(message);
      setRequestStatus("error");
    }
  };

  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || requestStatus === "sending") return;
    setInput("");
    void requestAnswer(message);
  };

  if (!open) return null;
  return (
    <aside className="assistant-panel" id="assistant-panel" role="dialog" aria-label="TapTap customer support">
      <header>
        <div><strong>TapTap Assistant</strong><small>Menu, store, delivery, and order help</small></div>
        <button aria-label="Close customer support" onClick={() => onOpenChange(false)}><X size={18} strokeWidth={2.5} aria-hidden="true" /></button>
      </header>
      <div className="assistant-messages" aria-live="polite">
        {messages.map((message) => {
          const sourceLabel = assistantSourceLabel(message.source);
          return (
            <div key={message.id} className={message.from}>
              <span>{message.text}</span>
              {sourceLabel && <small>{sourceLabel}</small>}
              <time>{new Date(message.createdAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</time>
            </div>
          );
        })}
        {requestStatus === "sending" && <div className="bot assistant-typing" role="status"><span>Checking the latest information...</span></div>}
        {requestStatus === "error" && (
          <div className="bot assistant-error" role="alert">
            <span>I could not retrieve an answer. Please retry or try again later.</span>
            <button type="button" onClick={() => void requestAnswer(failedMessage, { saveSupportMessage: false })}>Retry</button>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="assistant-suggestions" aria-label="Suggested questions">
        {suggestions.map((suggestion) => (
          <button type="button" key={suggestion} disabled={requestStatus === "sending"} onClick={() => void requestAnswer(suggestion)}>{suggestion}</button>
        ))}
      </div>
      <form onSubmit={send}>
        <label className="visually-hidden" htmlFor="assistant-message">Message customer support</label>
        <input id="assistant-message" maxLength={500} disabled={requestStatus === "sending"} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask a question..." />
        <button type="submit" disabled={!input.trim() || requestStatus === "sending"}>{requestStatus === "sending" ? "Sending" : "Send"}</button>
      </form>
    </aside>
  );
}
