import { useEffect, useRef, useState, type FormEvent } from "react";
import { Headphones, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { websiteStoreConfig } from "../config/appConfig";
import { api } from "../services/api";
import { requestSupportStaff, sendSupportMessage, subscribeSupportConversation, subscribeSupportMessages } from "../services/firebase/operations";
import type { AppUser, MenuItem, SupportConversation } from "../types/domain";
import { assistantSourceLabel } from "../utils/display";

type AssistantMessage = {
  id: string;
  from: "bot" | "user";
  text: string;
  source?: string;
  sources?: string[];
  rating?: "helpful" | "unhelpful";
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
  const [conversation, setConversation] = useState<SupportConversation>({
    customerId: user.uid,
    mode: "assistant",
    assignedStaffId: null,
    assignedStaffName: null,
    updatedAt: 0
  });
  const conversationRef = useRef(conversation);
  const receivedSupportReplies = useRef(new Set<string>());
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    return subscribeSupportConversation((nextConversation) => {
      conversationRef.current = nextConversation;
      setConversation(nextConversation);
      if (["waiting", "staff"].includes(nextConversation.mode)) setRequestStatus("idle");
    }, user.uid);
  }, [open, user.uid]);

  useEffect(() => {
    if (!open) return undefined;
    return subscribeSupportMessages((supportMessages) => {
      const newReplies = supportMessages.filter((message) =>
        ["staff", "owner"].includes(message.senderRole) && !receivedSupportReplies.current.has(message.id)
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
      try {
        await sendSupportMessage(message, user, {
          customerId: user.uid,
          customerName: user.name,
          conversationId: user.uid
        });
      } catch {
        setFailedMessage(message);
        setRequestStatus("error");
        return;
      }
    }

    if (conversationRef.current.mode !== "assistant") {
      setRequestStatus("idle");
      return;
    }

    try {
      const history = messages
        .filter((entry) => entry.id !== "welcome" && !String(entry.source || "").startsWith("Staff support"))
        .slice(-6)
        .map((entry) => ({ role: entry.from === "user" ? "user" as const : "assistant" as const, text: entry.text.slice(0, 500) }));
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
      }, history);
      if (!response.status) {
        setMessages((current) => [...current, {
          id: response.messageId || messageId("reply"),
          from: "bot",
          text: response.text,
          source: response.source,
          sources: response.sources,
          createdAt: Date.now()
        }]);
      }
      setRequestStatus("idle");
    } catch {
      setFailedMessage(message);
      setRequestStatus("error");
    }
  };

  const askForStaff = async () => {
    if (conversationRef.current.mode !== "assistant" || requestStatus === "sending") return;
    setRequestStatus("sending");
    try {
      const result = await requestSupportStaff(user.uid, { ...user, role: "customer" }, "Customer requested human support");
      conversationRef.current = result.conversation;
      setConversation(result.conversation);
      setRequestStatus("idle");
    } catch {
      setFailedMessage("");
      setRequestStatus("error");
    }
  };

  const rateMessage = async (message: AssistantMessage, rating: "helpful" | "unhelpful") => {
    const previous = message.rating;
    setMessages((current) => current.map((entry) => entry.id === message.id
      ? { ...entry, rating: previous === rating ? undefined : rating }
      : entry));
    try {
      if (previous === rating) await api.removeAssistantMessageRating(message.id);
      else await api.rateAssistantMessage(message.id, rating, ["local", "groq", "openai"].includes(String(message.source)) ? message.source as "local" | "groq" | "openai" : "assistant");
    } catch {
      setMessages((current) => current.map((entry) => entry.id === message.id ? { ...entry, rating: previous } : entry));
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
        <div><strong>{conversation.mode === "staff" ? "Customer support" : "TapTap Assistant"}</strong><small>{conversation.mode === "staff" ? "A support team member is handling this conversation" : "Menu, store, delivery, and order help"}</small></div>
        <button aria-label="Close customer support" onClick={() => onOpenChange(false)}><X size={18} strokeWidth={2.5} aria-hidden="true" /></button>
      </header>
      <div className={`assistant-mode-status ${conversation.mode}`} role="status">
        {conversation.mode === "staff"
          ? `${conversation.assignedStaffName || "A support team member"} is handling your conversation. The assistant is paused.`
          : conversation.mode === "waiting"
            ? "The support team has been notified. The assistant is paused while you wait."
            : "Assistant replies are active."}
      </div>
      <div className="assistant-messages" aria-live="polite">
        {messages.map((message) => {
          const sourceLabel = assistantSourceLabel(message.source);
          return (
            <div key={message.id} className={message.from}>
              <span>{message.text}</span>
              {sourceLabel && <small>{sourceLabel}</small>}
              {message.sources?.length ? <div className="assistant-sources" aria-label="Answer sources">{message.sources.map((source) => <span key={source}>{source}</span>)}</div> : null}
              <time>{new Date(message.createdAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</time>
              {message.from === "bot" && message.id !== "welcome" && !String(message.source || "").startsWith("Staff support") && (
                <div className="assistant-feedback" aria-label="Rate this answer">
                  <button type="button" className={message.rating === "helpful" ? "active" : ""} aria-label="Helpful answer" aria-pressed={message.rating === "helpful"} onClick={() => void rateMessage(message, "helpful")}><ThumbsUp size={15} aria-hidden="true" /></button>
                  <button type="button" className={message.rating === "unhelpful" ? "active" : ""} aria-label="Unhelpful answer" aria-pressed={message.rating === "unhelpful"} onClick={() => void rateMessage(message, "unhelpful")}><ThumbsDown size={15} aria-hidden="true" /></button>
                  {message.rating && <small>Feedback saved</small>}
                </div>
              )}
            </div>
          );
        })}
        {requestStatus === "sending" && <div className="bot assistant-typing" role="status"><span>Checking the latest information...</span></div>}
        {requestStatus === "error" && (
          <div className="bot assistant-error" role="alert">
            <span>I could not retrieve an answer. Please retry or try again later.</span>
            {failedMessage && <button type="button" onClick={() => void requestAnswer(failedMessage, { saveSupportMessage: false })}>Retry</button>}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      {conversation.mode === "assistant" && <div className="assistant-human-action"><button type="button" onClick={() => void askForStaff()} disabled={requestStatus === "sending"}><Headphones size={16} aria-hidden="true" />Talk to staff</button></div>}
      {conversation.mode === "assistant" && <div className="assistant-suggestions" aria-label="Suggested questions">
        {suggestions.map((suggestion) => (
          <button type="button" key={suggestion} disabled={requestStatus === "sending"} onClick={() => void requestAnswer(suggestion)}>{suggestion}</button>
        ))}
      </div>}
      <form onSubmit={send}>
        <label className="visually-hidden" htmlFor="assistant-message">Message customer support</label>
        <input id="assistant-message" maxLength={500} disabled={requestStatus === "sending"} value={input} onChange={(event) => setInput(event.target.value)} placeholder={conversation.mode === "assistant" ? "Ask a question..." : "Message the support team..."} />
        <button type="submit" disabled={!input.trim() || requestStatus === "sending"}>{requestStatus === "sending" ? "Sending" : "Send"}</button>
      </form>
    </aside>
  );
}
