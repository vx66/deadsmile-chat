"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";
import type { AdminUserRecord, ChatMessage, ChatUser } from "../lib/chat-store";

type SessionPayload = {
  user: ChatUser | null;
  members: ChatUser[];
  error?: string;
};

type AdminPayload = {
  users: AdminUserRecord[];
  messages: ChatMessage[];
  stats: { total: number; online: number; banned: number; countries: number };
  error?: string;
};

type DirectConversation = {
  user: ChatUser;
  unreadCount: number;
  latestMessage: {
    id: string;
    body: string;
    imageUrl: string | null;
    senderId: string;
    createdAt: string;
  } | null;
};

function initials(name: string) {
  return name.split(/[ ._-]/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

function Avatar({ user, size = "md" }: { user: Pick<ChatUser, "name" | "avatarUrl" | "role">; size?: "sm" | "md" | "lg" }) {
  const tone = Array.from(user.name).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4;
  return (
    <span className={`irc-avatar irc-avatar-${size} irc-avatar-tone-${tone}`} aria-label={`Avatar de ${user.name}`}>
      {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.name)}
      <span className="irc-presence" />
    </span>
  );
}

function FullEmojiPicker({ title, onSelect, onClose }: { title: string; onSelect: (emoji: string) => void; onClose: () => void }) {
  return (
    <div className="irc-emoji-picker">
      <header>
        <span>{title}</span>
        <button type="button" onClick={onClose} aria-label="Cerrar selector de emojis">×</button>
      </header>
      <EmojiPicker
        theme={Theme.DARK}
        emojiStyle={EmojiStyle.NATIVE}
        width="100%"
        height={390}
        lazyLoadEmojis
        autoFocusSearch={false}
        searchPlaceholder="Buscar emoji..."
        searchClearButtonLabel="Limpiar búsqueda"
        previewConfig={{ showPreview: false }}
        onEmojiClick={(item) => onSelect(item.emoji)}
      />
    </div>
  );
}

function locationLabel(record: AdminUserRecord) {
  const primary = [record.city, record.regionCode ?? record.region, record.country].filter(Boolean).join(", ");
  return primary || "Sin geolocalización disponible";
}

function formatDate(value: string) {
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

export default function ChatApp() {
  const [user, setUser] = useState<ChatUser | null>(null);
  const [members, setMembers] = useState<ChatUser[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [publicUnread, setPublicUnread] = useState(0);
  const [activeDirectUser, setActiveDirectUser] = useState<ChatUser | null>(null);
  const [directTabs, setDirectTabs] = useState<ChatUser[]>([]);
  const [directConversations, setDirectConversations] = useState<DirectConversation[]>([]);
  const [directInboxOpen, setDirectInboxOpen] = useState(false);
  const [directMessages, setDirectMessages] = useState<ChatMessage[]>([]);
  const [directMessage, setDirectMessage] = useState("");
  const [directReplyingTo, setDirectReplyingTo] = useState<ChatMessage | null>(null);
  const [directSending, setDirectSending] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [accountMode, setAccountMode] = useState<"signup" | "login" | null>(null);
  const [accountName, setAccountName] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [message, setMessage] = useState("");
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [booting, setBooting] = useState(true);
  const [joining, setJoining] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [toast, setToast] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [adminLogin, setAdminLogin] = useState(false);
  const [adminUsername, setAdminUsername] = useState("xergno");
  const [adminPassword, setAdminPassword] = useState("");
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [adminData, setAdminData] = useState<AdminPayload | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminSearch, setAdminSearch] = useState("");
  const [dashboardTab, setDashboardTab] = useState<"users" | "messages">("users");
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editScope, setEditScope] = useState<"self" | "admin" | "direct">("self");
  const [savingEdit, setSavingEdit] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const directEndRef = useRef<HTMLDivElement>(null);
  const directInput = useRef<HTMLTextAreaElement>(null);
  const activeDirectUserIdRef = useRef<string | null>(null);
  const publicMessagesReadyRef = useRef(false);
  const publicMessageIdsRef = useRef<Set<string>>(new Set());
  const baseDocumentTitleRef = useRef("Dead Smile Chat");
  const directUnreadRef = useRef<Record<string, number>>({});
  const directLatestMessageRef = useRef<Record<string, string>>({});
  const directInboxReadyRef = useRef(false);
  const userId = user?.id;
  const directUserId = activeDirectUser?.id;

  useEffect(() => {
    activeDirectUserIdRef.current = directUserId ?? null;
  }, [directUserId]);

  const refreshSession = useCallback(async () => {
    const response = await fetch("/api/session", { cache: "no-store" });
    const data = (await response.json()) as SessionPayload;
    if (!response.ok) throw new Error(data.error ?? "La señal no responde.");
    setUser(data.user);
    setMembers(data.members ?? []);
    return data;
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (active) await refreshSession();
      } catch (error) {
        if (active) setJoinError(error instanceof Error ? error.message : "La conexión falló.");
      } finally {
        if (active) setBooting(false);
      }
    })();
    return () => { active = false; };
  }, [refreshSession]);

  const fetchMessages = useCallback(async (quiet = false) => {
    try {
      const response = await fetch("/api/messages?room=lobby", { cache: "no-store" });
      if (response.status === 401) {
        setUser(null);
        setMessages([]);
        setPublicUnread(0);
        publicMessagesReadyRef.current = false;
        publicMessageIdsRef.current = new Set();
        if (!quiet) setToast("Tu sesión fue cerrada por el sistema.");
        return;
      }
      const data = (await response.json()) as { messages?: ChatMessage[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "No se pudo leer el canal.");
      const nextMessages = data.messages ?? [];
      if (publicMessagesReadyRef.current) {
        const incomingCount = nextMessages.filter((item) =>
          item.type === "user" && item.user.id !== userId && !publicMessageIdsRef.current.has(item.id),
        ).length;
        const channelIsNotVisible = document.visibilityState !== "visible" || activeDirectUserIdRef.current !== null;
        if (incomingCount > 0 && channelIsNotVisible) {
          setPublicUnread((count) => count + incomingCount);
        }
      } else {
        publicMessagesReadyRef.current = true;
      }
      publicMessageIdsRef.current = new Set(nextMessages.map((item) => item.id));
      setMessages(nextMessages);
    } catch (error) {
      if (!quiet) setToast(error instanceof Error ? error.message : "Interferencia en el canal.");
    }
  }, [userId]);

  const fetchDirectMessages = useCallback(async (otherUserId: string, quiet = false) => {
    try {
      const response = await fetch(`/api/direct-messages?userId=${encodeURIComponent(otherUserId)}`, { cache: "no-store" });
      const data = (await response.json()) as { messages?: ChatMessage[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "No se pudo leer el canal privado.");
      setDirectMessages(data.messages ?? []);
      const conversationIsVisible = document.visibilityState === "visible" && activeDirectUserIdRef.current === otherUserId;
      if (conversationIsVisible) {
        await fetch("/api/direct-messages", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "mark_read", userId: otherUserId }),
        });
        setDirectConversations((items) => items.map((item) => item.user.id === otherUserId ? { ...item, unreadCount: 0 } : item));
        directUnreadRef.current[otherUserId] = 0;
      }
    } catch (error) {
      if (!quiet) setToast(error instanceof Error ? error.message : "Interferencia en el canal privado.");
    }
  }, []);

  const fetchDirectInbox = useCallback(async (quiet = false) => {
    try {
      const response = await fetch("/api/direct-messages", { cache: "no-store" });
      const data = (await response.json()) as { conversations?: DirectConversation[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "No se pudo leer la bandeja privada.");
      const conversations = data.conversations ?? [];
      const newlyUnread = conversations.filter((item) => {
        const latestIncomingChanged = item.latestMessage?.senderId !== userId
          && item.latestMessage?.id !== directLatestMessageRef.current[item.user.id];
        const unreadIncreased = item.unreadCount > (directUnreadRef.current[item.user.id] ?? 0);
        return item.unreadCount > 0 && (!directInboxReadyRef.current || unreadIncreased || latestIncomingChanged);
      });
      setDirectConversations(conversations);
      setDirectTabs((current) => {
        const openIds = new Set(current.map((item) => item.id));
        const incoming = newlyUnread
          .filter((item) => !openIds.has(item.user.id))
          .map((item) => item.user);
        return incoming.length ? [...current, ...incoming] : current;
      });

      const incoming = newlyUnread.find((item) => activeDirectUserIdRef.current !== item.user.id);
      if (incoming) {
        setToast(`NUEVO PRIVADO // ${incoming.user.name}: ${incoming.latestMessage?.body || "[imagen]"}`);
      }
      directUnreadRef.current = Object.fromEntries(conversations.map((item) => [item.user.id, item.unreadCount]));
      directLatestMessageRef.current = Object.fromEntries(conversations.flatMap((item) =>
        item.latestMessage ? [[item.user.id, item.latestMessage.id]] : [],
      ));
      directInboxReadyRef.current = true;
    } catch (error) {
      if (!quiet) setToast(error instanceof Error ? error.message : "Interferencia en la bandeja privada.");
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const initialFetch = window.setTimeout(() => void fetchMessages(), 0);
    const inboxFetch = window.setTimeout(() => void fetchDirectInbox(), 0);
    const messageTimer = window.setInterval(() => void fetchMessages(true), 2800);
    const inboxTimer = window.setInterval(() => void fetchDirectInbox(true), 2800);
    const memberTimer = window.setInterval(() => void refreshSession().catch(() => undefined), 12000);
    return () => {
      window.clearTimeout(initialFetch);
      window.clearTimeout(inboxFetch);
      window.clearInterval(messageTimer);
      window.clearInterval(inboxTimer);
      window.clearInterval(memberTimer);
    };
  }, [fetchDirectInbox, fetchMessages, refreshSession, userId]);

  useEffect(() => {
    if (!userId) return;
    const markOnline = () => {
      void fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join" }),
        keepalive: true,
      });
    };
    const markOffline = () => {
      const body = new Blob([JSON.stringify({ action: "leave" })], { type: "application/json" });
      navigator.sendBeacon("/api/presence", body);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        markOnline();
        const activePrivateId = activeDirectUserIdRef.current;
        if (activePrivateId) void fetchDirectMessages(activePrivateId, true);
        else setPublicUnread(0);
      }
    };
    window.addEventListener("pagehide", markOffline);
    window.addEventListener("pageshow", markOnline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("pagehide", markOffline);
      window.removeEventListener("pageshow", markOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchDirectMessages, userId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  useEffect(() => {
    if (!userId || !directUserId) return;
    const initialFetch = window.setTimeout(() => void fetchDirectMessages(directUserId), 0);
    const timer = window.setInterval(() => void fetchDirectMessages(directUserId, true), 2800);
    return () => {
      window.clearTimeout(initialFetch);
      window.clearInterval(timer);
    };
  }, [directUserId, fetchDirectMessages, userId]);

  useEffect(() => {
    directEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [directMessages.length]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function joinGuest(event: FormEvent) {
    event.preventDefault();
    setJoining(true);
    setJoinError("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "guest", name: guestName }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Acceso rechazado.");
      await refreshSession();
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : "Acceso rechazado.");
    } finally {
      setJoining(false);
    }
  }

  async function joinAdmin(event: FormEvent) {
    event.preventDefault();
    setJoining(true);
    setJoinError("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "admin", username: adminUsername, password: adminPassword }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Acceso administrativo rechazado.");
      setAdminPassword("");
      await refreshSession();
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : "Acceso administrativo rechazado.");
    } finally {
      setJoining(false);
    }
  }

  async function joinRegistered(event: FormEvent) {
    event.preventDefault();
    if (!accountMode) return;
    setJoining(true);
    setJoinError("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "registered",
          action: accountMode,
          name: accountMode === "signup" ? accountName : undefined,
          email: accountEmail,
          password: accountPassword,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "No se pudo abrir la cuenta.");
      setAccountPassword("");
      await refreshSession();
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : "Acceso rechazado.");
    } finally {
      setJoining(false);
    }
  }

  async function sendMessage(event?: FormEvent, imageUrl?: string) {
    event?.preventDefault();
    const text = message.trim();
    if ((!text && !imageUrl) || sending) return;
    setSending(true);
    setEmojiOpen(false);
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: "lobby", body: text, imageUrl, replyToId: replyingTo?.id }),
      });
      const data = (await response.json()) as { message?: ChatMessage; error?: string };
      if (!response.ok) throw new Error(data.error ?? "El mensaje fue bloqueado.");
      setMessage("");
      setReplyingTo(null);
      if (data.message) setMessages((items) => [...items.filter((item) => item.id !== data.message?.id), data.message!]);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "No se pudo enviar.");
    } finally {
      setSending(false);
    }
  }

  async function sendDirectMessage(event?: FormEvent, imageUrl?: string) {
    event?.preventDefault();
    const text = directMessage.trim();
    if (!activeDirectUser || ((!text && !imageUrl) || directSending)) return;
    setDirectSending(true);
    setEmojiOpen(false);
    try {
      const response = await fetch("/api/direct-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId: activeDirectUser.id, body: text, imageUrl, replyToId: directReplyingTo?.id }),
      });
      const data = (await response.json()) as { message?: ChatMessage; error?: string };
      if (!response.ok) throw new Error(data.error ?? "El mensaje privado fue bloqueado.");
      setDirectMessage("");
      setDirectReplyingTo(null);
      if (data.message) setDirectMessages((items) => [...items.filter((item) => item.id !== data.message?.id), data.message!]);
      await fetchDirectInbox(true);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "No se pudo enviar el mensaje privado.");
    } finally {
      setDirectSending(false);
    }
  }

  async function uploadFile(file: File, kind: "chat" | "avatar") {
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("kind", kind);
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error ?? "La subida falló.");
      if (kind === "chat") {
        if (activeDirectUser) await sendDirectMessage(undefined, data.url);
        else await sendMessage(undefined, data.url);
      } else {
        setUser((current) => current ? { ...current, avatarUrl: data.url! } : current);
        setMembers((items) => items.map((item) => item.id === user?.id ? { ...item, avatarUrl: data.url! } : item));
        setToast("Avatar actualizado.");
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "No se pudo subir la imagen.");
    } finally {
      setUploading(false);
      if (imageInput.current) imageInput.current.value = "";
      if (avatarInput.current) avatarInput.current.value = "";
    }
  }

  const loadDashboard = useCallback(async () => {
    setAdminLoading(true);
    try {
      const response = await fetch("/api/admin", { cache: "no-store" });
      const data = (await response.json()) as AdminPayload;
      if (!response.ok) throw new Error(data.error ?? "No se pudo abrir el dashboard.");
      setAdminData(data);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "No se pudo abrir el dashboard.");
    } finally {
      setAdminLoading(false);
    }
  }, []);

  async function openDashboard() {
    setDashboardOpen(true);
    setProfileOpen(false);
    await loadDashboard();
  }

  async function moderate(action: "kick" | "ban" | "block_ip" | "restore", userId: string) {
    setAdminLoading(true);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userId }),
      });
      const data = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Orden rechazada.");
      setToast(data.message ?? "Orden ejecutada.");
      await Promise.all([loadDashboard(), refreshSession()]);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Orden rechazada.");
    } finally {
      setAdminLoading(false);
    }
  }

  async function moderateMessage(
    action: "clear_chat" | "delete_message" | "edit_message" | "toggle_pin",
    messageId?: string,
    body?: string,
  ) {
    setAdminLoading(true);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, messageId, body }),
      });
      const data = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Orden rechazada.");
      setToast(data.message ?? "Mensaje actualizado.");
      await Promise.all([loadDashboard(), fetchMessages(true)]);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Orden rechazada.");
    } finally {
      setAdminLoading(false);
    }
  }

  function editAdminMessage(item: ChatMessage) {
    openMessageEditor(item, "admin");
  }

  function deleteAdminMessage(item: ChatMessage) {
    if (window.confirm(`¿Eliminar el mensaje de ${item.user.name}?`)) void moderateMessage("delete_message", item.id);
  }

  function startReply(item: ChatMessage) {
    setReplyingTo(item);
    window.setTimeout(() => messageInput.current?.focus(), 0);
  }

  function openDirectChannel(member: ChatUser) {
    if (member.id === userId) return;
    setDirectTabs((items) => items.some((item) => item.id === member.id) ? items : [...items, member]);
    setActiveDirectUser(member);
    setDirectMessages([]);
    setDirectMessage("");
    setDirectReplyingTo(null);
    setEmojiOpen(false);
    setPeopleOpen(false);
    setDirectInboxOpen(false);
  }

  function showDeadchat() {
    setActiveDirectUser(null);
    setDirectMessages([]);
    setDirectMessage("");
    setDirectReplyingTo(null);
    setEmojiOpen(false);
    setDirectInboxOpen(false);
    if (document.visibilityState === "visible") setPublicUnread(0);
  }

  function closeDirectTab(memberId: string) {
    setDirectTabs((items) => items.filter((item) => item.id !== memberId));
    if (activeDirectUser?.id === memberId) showDeadchat();
  }

  function closeDirectChannel() {
    showDeadchat();
  }

  function editOwnMessage(item: ChatMessage) {
    openMessageEditor(item, "self");
  }

  function openMessageEditor(item: ChatMessage, scope: "self" | "admin" | "direct") {
    setEditingMessage(item);
    setEditDraft(item.body);
    setEditScope(scope);
  }

  function closeMessageEditor() {
    if (savingEdit) return;
    setEditingMessage(null);
    setEditDraft("");
  }

  async function saveMessageEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingMessage || !editDraft.trim() || savingEdit) return;
    setSavingEdit(true);
    try {
      const adminEdit = editScope === "admin";
      const directEdit = editScope === "direct";
      const response = await fetch(adminEdit ? "/api/admin" : directEdit ? "/api/direct-messages" : "/api/messages", {
        method: adminEdit ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adminEdit
          ? { action: "edit_message", messageId: editingMessage.id, body: editDraft }
          : { messageId: editingMessage.id, body: editDraft }),
      });
      const data = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "No se pudo editar el mensaje.");
      setToast(data.message ?? "Mensaje editado.");
      setEditingMessage(null);
      setEditDraft("");
      if (adminEdit) await Promise.all([fetchMessages(true), loadDashboard()]);
      else if (directEdit && directUserId) await fetchDirectMessages(directUserId, true);
      else await fetchMessages(true);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "No se pudo editar el mensaje.");
    } finally {
      setSavingEdit(false);
    }
  }

  function clearChat() {
    if (window.confirm("¿Eliminar TODO el historial de #deadchat? Esta acción no se puede deshacer.")) {
      void moderateMessage("clear_chat");
    }
  }

  async function signOut() {
    await fetch("/api/session", { method: "DELETE" });
    setUser(null);
    setProfileOpen(false);
    setDashboardOpen(false);
    setMessages([]);
    setPublicUnread(0);
    publicMessagesReadyRef.current = false;
    publicMessageIdsRef.current = new Set();
    closeDirectChannel();
    setDirectTabs([]);
    setDirectConversations([]);
    directUnreadRef.current = {};
    directLatestMessageRef.current = {};
    directInboxReadyRef.current = false;
  }

  const filteredAdminUsers = useMemo(() => {
    const query = adminSearch.trim().toLocaleLowerCase();
    if (!query) return adminData?.users ?? [];
    return (adminData?.users ?? []).filter((item) => [
      item.name, item.email, item.ipAddress, item.city, item.region, item.country, item.organization,
    ].some((value) => value?.toLocaleLowerCase().includes(query)));
  }, [adminData, adminSearch]);

  const pinnedMessages = useMemo(() => messages.filter((item) => item.type === "user" && item.isPinned), [messages]);
  const totalDirectUnread = useMemo(
    () => directConversations.reduce((total, item) => total + item.unreadCount, 0),
    [directConversations],
  );
  const totalUnread = publicUnread + totalDirectUnread;

  useEffect(() => {
    baseDocumentTitleRef.current = document.title.replace(/^\(\d+\)\s*/, "") || "Dead Smile Chat";
    return () => { document.title = baseDocumentTitleRef.current; };
  }, []);

  useEffect(() => {
    document.title = user && totalUnread > 0
      ? `(${totalUnread}) ${baseDocumentTitleRef.current}`
      : baseDocumentTitleRef.current;
  }, [totalUnread, user]);

  if (booting) {
    return (
      <main className="irc-boot">
        <div className="irc-boot-face">:)</div>
        <p><span /> ESTABLECIENDO ENLACE</p>
        <div className="irc-boot-track"><i /></div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="irc-gateway">
        <div className="terminal-login-stage">
          <aside className="terminal-login-visual" aria-label="Transmision glitch de Dead Smile Chat">
            <img src="/dead-smile-login-glitch.png" alt="Retrato anime con glitch cyberpunk y senal CRT" />
            <div className="terminal-visual-hud"><span>CAM_404 // DENPA FEED</span><b>NO SIGNAL IS SAFE</b></div>
            <div className="terminal-visual-readout"><span>REC ●</span><span>23:59:59</span><span>AKIBA NODE</span></div>
          </aside>
          <section className="terminal-login" aria-labelledby="access-title">
          <div className="terminal-login-kicker"><i /> 秋葉原電気街 // DEAD SMILE NETWORK</div>
          <div className="terminal-login-face" aria-hidden="true">:)</div>
          <h1>DEAD SMILE <em>CHAT</em></h1>
          <p className="terminal-login-copy">Un canal público. Personas reales. Mensajes, imágenes y emojis.</p>
          <div className="terminal-command"><span>root@deadsmile:~$</span> connect --channel #deadchat</div>
          {adminLogin ? (
            <form onSubmit={joinAdmin} className="terminal-form">
              <h2 id="access-title">Acceso <em>root</em></h2>
              <label htmlFor="admin-user">usuario</label>
              <div className="terminal-input"><span>&gt;</span><input id="admin-user" value={adminUsername} onChange={(event) => setAdminUsername(event.target.value)} autoComplete="username" /></div>
              <label htmlFor="admin-pass">contraseña</label>
              <div className="terminal-input"><span>&gt;</span><input id="admin-pass" type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} autoComplete="current-password" autoFocus /></div>
              {joinError && <p className="gateway-error" role="alert">{joinError}</p>}
              <button className="terminal-primary" type="submit" disabled={joining || !adminPassword}>{joining ? "AUTENTICANDO..." : "ABRIR CONSOLA ROOT"}</button>
              <button className="terminal-link" type="button" onClick={() => { setAdminLogin(false); setJoinError(""); }}>← Volver como invitado</button>
            </form>
          ) : accountMode ? (
            <form onSubmit={joinRegistered} className="terminal-form">
              <h2 id="access-title">{accountMode === "signup" ? "Registrar" : "Abrir"} <em>identidad</em></h2>
              {accountMode === "signup" && (
                <>
                  <label htmlFor="account-name">nombre / alias</label>
                  <div className="terminal-input"><span>&gt;</span><input id="account-name" value={accountName} onChange={(event) => setAccountName(event.target.value)} minLength={2} maxLength={22} autoComplete="nickname" required /></div>
                </>
              )}
              <label htmlFor="account-email">correo</label>
              <div className="terminal-input"><span>&gt;</span><input id="account-email" type="email" value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} autoComplete="email" required autoFocus /></div>
              <label htmlFor="account-password">contraseña</label>
              <div className="terminal-input"><span>&gt;</span><input id="account-password" type="password" value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} minLength={10} maxLength={128} autoComplete={accountMode === "signup" ? "new-password" : "current-password"} required /></div>
              {joinError && <p className="gateway-error" role="alert">{joinError}</p>}
              <button className="terminal-primary" type="submit" disabled={joining || accountPassword.length < 10 || !accountEmail.trim() || (accountMode === "signup" && accountName.trim().length < 2)}>{joining ? "AUTENTICANDO..." : accountMode === "signup" ? "CREAR IDENTIDAD" : "INICIAR SESIÓN"}</button>
              <button className="terminal-link" type="button" onClick={() => { setAccountMode(accountMode === "signup" ? "login" : "signup"); setJoinError(""); }}>{accountMode === "signup" ? "Ya tengo una cuenta" : "Crear una cuenta nueva"}</button>
              <button className="terminal-link" type="button" onClick={() => { setAccountMode(null); setJoinError(""); }}>← Volver como invitado</button>
            </form>
          ) : (
            <form onSubmit={joinGuest} className="terminal-form">
              <h2 id="access-title">Escribe tu <em>nick</em></h2>
              <label htmlFor="guest-name">nombre / alias</label>
              <div className="terminal-input"><span>&gt;</span><input id="guest-name" value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="tu_nickname" minLength={2} maxLength={22} autoComplete="nickname" autoFocus /><small>{guestName.length}/22</small></div>
              {joinError && <p className="gateway-error" role="alert">{joinError}</p>}
              <button className="terminal-primary" type="submit" disabled={joining || guestName.trim().length < 2}>{joining ? "CONECTANDO..." : "ENTRAR A #DEADCHAT"}</button>
              <div className="terminal-options">
                <button type="button" onClick={() => { setAccountMode("signup"); setJoinError(""); }}>Registrar identidad</button>
                <button type="button" onClick={() => { setAccountMode("login"); setJoinError(""); }}>Abrir cuenta</button>
                <button type="button" onClick={() => { setAdminLogin(true); setJoinError(""); }}>Acceso admin</button>
              </div>
            </form>
          )}
          <footer className="terminal-login-footer"><span><i /> ONLINE</span><span>SIN VOZ</span><span>SOLO #DEADCHAT</span></footer>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="irc-shell">
      <header className="irc-topbar">
        <a className="irc-wordmark" href="#deadchat" aria-label="Dead Smile Chat" onClick={closeDirectChannel}><span>:)</span><strong>DEAD SMILE</strong><small>CHAT // 電波</small></a>
        <div className="irc-channel-title"><b>{activeDirectUser ? `@${activeDirectUser.name}` : "#deadchat"}</b><span>{activeDirectUser ? "canal privado · cifrado entre dos personas" : "canal abierto · conversación general"}</span><small>{activeDirectUser ? "PRIVATE LINK / 暗号通信" : "秋葉原電気街 / NODE 404"}</small></div>
        <div className="irc-top-actions">
          <span className="irc-online"><i /> {members.length} online</span>
          <button className="people-toggle" onClick={() => setPeopleOpen((open) => !open)}>◎ Personas</button>
          {user.role === "admin" && <button className="admin-trigger" onClick={() => void openDashboard()}>⌘ Dashboard</button>}
          <button className="irc-user-chip" onClick={() => setProfileOpen((open) => !open)}><Avatar user={user} size="sm" /><span>{user.name}</span><i>⌄</i></button>
        </div>
        {profileOpen && (
          <div className="irc-profile-menu">
            <div><Avatar user={user} size="lg" /><span><strong>{user.name}</strong><small>{user.role === "admin" ? "ADMINISTRADOR" : user.accountType === "registered" ? "REGISTRADO" : "INVITADO"}</small></span></div>
            <button onClick={() => avatarInput.current?.click()} disabled={uploading}>Cambiar avatar <span>▧</span></button>
            {user.role === "admin" && <button onClick={() => void openDashboard()}>Abrir dashboard <span>⌘</span></button>}
            <button onClick={signOut}>Desconectar <span>↪</span></button>
          </div>
        )}
      </header>

      <section className="irc-workspace">
        <section className="irc-chat" id="deadchat">
          <nav className="channel-tabs" aria-label="Canales abiertos">
            <button type="button" className={`channel-tab deadchat-tab ${!activeDirectUser ? "active" : ""}`} onClick={showDeadchat}>
              <span>#</span><b>deadchat</b>
            </button>
            <div className="direct-tab-strip">
              {directTabs.map((tab) => {
                const conversation = directConversations.find((item) => item.user.id === tab.id);
                return (
                  <div key={tab.id} className={`channel-tab direct-tab ${activeDirectUser?.id === tab.id ? "active" : ""}`}>
                    <button type="button" className="channel-tab-open" onClick={() => openDirectChannel(tab)} title={`Abrir privado con ${tab.name}`}>
                      <span>@</span><b>{tab.name}</b>
                      {!!conversation?.unreadCount && <i>{conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}</i>}
                    </button>
                    <button type="button" className="channel-tab-close" onClick={() => closeDirectTab(tab.id)} aria-label={`Cerrar privado con ${tab.name}`}>×</button>
                  </div>
                );
              })}
            </div>
            <div className="direct-inbox">
              <button type="button" className={`direct-inbox-trigger ${directInboxOpen ? "active" : ""}`} onClick={() => setDirectInboxOpen((open) => !open)} aria-expanded={directInboxOpen}>
                PRIVADOS{totalDirectUnread > 0 && <i>{totalDirectUnread > 99 ? "99+" : totalDirectUnread}</i>}
              </button>
              {directInboxOpen && (
                <section className="direct-inbox-menu" aria-label="Conversaciones privadas">
                  <header><span>BANDEJA PRIVADA</span><b>{directConversations.length.toString().padStart(2, "0")}</b></header>
                  <div>
                    {!directConversations.length && <p>No tienes conversaciones privadas todavía.</p>}
                    {directConversations.map((conversation) => (
                      <button type="button" key={conversation.user.id} onClick={() => openDirectChannel(conversation.user)}>
                        <Avatar user={conversation.user} size="sm" />
                        <span><strong>{conversation.user.name}</strong><small>{conversation.latestMessage?.senderId === user.id ? "Tú: " : ""}{conversation.latestMessage?.body || (conversation.latestMessage?.imageUrl ? "[imagen]" : "Sin mensajes")}</small></span>
                        {conversation.unreadCount > 0 ? <i>{conversation.unreadCount}</i> : <time>{conversation.latestMessage ? new Date(conversation.latestMessage.createdAt).toLocaleDateString([], { day: "2-digit", month: "2-digit" }) : ""}</time>}
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </nav>
          <div className="irc-feed" aria-live="polite">
            <div className="irc-welcome">
              <div className="akiba-marquee" aria-hidden="true"><span>秋葉原電気街</span><b>DENPA LINK::ONLINE</b><span>信号 / 404</span></div>
              <span className="welcome-code">CHANNEL / 001</span>
              <h2>Bienvenido a <em>#deadchat</em></h2>
              <p>Este es el único canal de Dead Smile Chat. Habla, comparte imágenes o deja una señal.</p>
              <div><span>Creado</span><b>01 AGO 2026</b><span>Protocolo</span><b>IRC/NEXT</b></div>
            </div>
            <div className="irc-day"><span>HOY</span></div>
            {pinnedMessages.length > 0 && (
              <section className="pinned-strip" aria-label="Mensajes fijados">
                <strong>⌁ FIJADOS</strong>
                {pinnedMessages.slice(-3).map((item) => <p key={item.id}><b>{item.user.name}:</b> {item.body}</p>)}
              </section>
            )}
            {!messages.length && <div className="irc-empty"><i>***</i><span>Aún no hay mensajes. Sé la primera persona en romper el silencio.</span></div>}
            {messages.map((item, index) => {
              if (item.type === "system") {
                return <div key={item.id} className="irc-system-event"><time>{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><b>***</b><span>{item.body}</span></div>;
              }
              const previous = messages[index - 1];
              const grouped = previous?.type === "user" && previous.user.id === item.user.id && new Date(item.createdAt).getTime() - new Date(previous.createdAt).getTime() < 300_000;
              return (
                <article key={item.id} className={`irc-message ${grouped ? "grouped" : ""}`}>
                  {!grouped ? <Avatar user={item.user} /> : <time>{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>}
                  <div>
                    {!grouped && <header><strong>{item.user.name}</strong>{item.user.role === "admin" && <b>ADMIN</b>}{item.isPinned && <span className="message-pin">⌁ FIJADO</span>}<time>{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>{item.editedAt && <small className="edited-note">editado</small>}</header>}
                    {item.replyTo && <div className="message-reply-preview"><b>↳ {item.replyTo.userName}</b><span>{item.replyTo.body}</span></div>}
                    {item.body && <p>{item.body}</p>}
                    {item.imageUrl && <a className="irc-image" href={item.imageUrl} target="_blank" rel="noreferrer"><img src={item.imageUrl} alt={`Imagen compartida por ${item.user.name}`} /></a>}
                    <div className="message-inline-actions" aria-label="Opciones del mensaje">
                      <button type="button" className="action-reply" data-label="返信" title="Responder" aria-label="Responder" onClick={() => startReply(item)}>⤺</button>
                      {item.user.id === user.id && <button type="button" className="action-edit" data-label="編集" title="Editar" aria-label="Editar" onClick={() => editOwnMessage(item)}>✐</button>}
                      {user.role === "admin" && <button type="button" className="action-delete" data-label="削除" title="Eliminar" aria-label="Eliminar" onClick={() => deleteAdminMessage(item)}>⌫</button>}
                    </div>
                  </div>
                </article>
              );
            })}
            <div ref={endRef} />
          </div>

          <form className="irc-composer" onSubmit={(event) => void sendMessage(event)}>
            {replyingTo && <div className="reply-composer-bar"><span>RESPONDIENDO A <b>{replyingTo.user.name}</b><small>{replyingTo.body || "[imagen]"}</small></span><button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancelar respuesta">×</button></div>}
            <button type="button" className="composer-add" onClick={() => imageInput.current?.click()} disabled={uploading} title="Subir imagen">{uploading ? "…" : "+"}</button>
            <textarea ref={messageInput} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={`Mensaje como ${user.name}...`} aria-label="Mensaje" rows={1} maxLength={2000} />
            <button type="button" className="composer-emoji" onClick={() => setEmojiOpen((open) => !open)} aria-label="Abrir emojis">☺</button>
            <button type="submit" className="composer-send" disabled={sending || !message.trim()} aria-label="Enviar mensaje">ENVIAR ↗</button>
            <small>ENTER envía · SHIFT+ENTER crea una línea</small>
            {emojiOpen && !activeDirectUser && (
              <FullEmojiPicker
                title="EMOJIS // UNICODE"
                onClose={() => setEmojiOpen(false)}
                onSelect={(emoji) => {
                  setMessage((value) => `${value}${emoji}`);
                  window.setTimeout(() => messageInput.current?.focus(), 0);
                }}
              />
            )}
          </form>

          {activeDirectUser && (
            <section className="direct-channel" aria-label={`Canal privado con ${activeDirectUser.name}`}>
              <header className="direct-channel-head">
                <button type="button" className="direct-back" onClick={closeDirectChannel}>← <span>#deadchat</span></button>
                <Avatar user={activeDirectUser} size="lg" />
                <div><small>PRIVATE CHANNEL // 暗号通信</small><h2>@{activeDirectUser.name}</h2><p>Solo tú y {activeDirectUser.name} pueden leer esta conversación.</p></div>
                <span className={`direct-status ${members.some((member) => member.id === activeDirectUser.id) ? "online" : "offline"}`}><i />{members.some((member) => member.id === activeDirectUser.id) ? "ONLINE" : "OFFLINE"}</span>
              </header>
              <div className="direct-feed" aria-live="polite">
                {!directMessages.length && <div className="direct-empty"><b>私信 / PRIVATE LINK</b><span>Aún no hay mensajes privados con {activeDirectUser.name}.</span><small>Inicia una transmisión segura desde el compositor.</small></div>}
                {directMessages.map((item, index) => {
                  const previous = directMessages[index - 1];
                  const grouped = previous?.user.id === item.user.id && new Date(item.createdAt).getTime() - new Date(previous.createdAt).getTime() < 300_000;
                  return (
                    <article key={item.id} className={`irc-message direct-message ${grouped ? "grouped" : ""} ${item.user.id === user.id ? "mine" : "theirs"}`}>
                      {!grouped ? <Avatar user={item.user} /> : <time>{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>}
                      <div>
                        {!grouped && <header><strong>{item.user.id === user.id ? "TÚ" : item.user.name}</strong><time>{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>{item.editedAt && <small className="edited-note">editado</small>}</header>}
                        {item.replyTo && <div className="message-reply-preview"><b>↳ {item.replyTo.userName}</b><span>{item.replyTo.body}</span></div>}
                        {item.body && <p>{item.body}</p>}
                        {item.imageUrl && <a className="irc-image" href={item.imageUrl} target="_blank" rel="noreferrer"><img src={item.imageUrl} alt={`Imagen privada compartida por ${item.user.name}`} /></a>}
                        <div className="message-inline-actions" aria-label="Opciones del mensaje privado">
                          <button type="button" className="action-reply" data-label="返信" title="Responder" aria-label="Responder mensaje privado" onClick={() => { setDirectReplyingTo(item); window.setTimeout(() => directInput.current?.focus(), 0); }}>⤺</button>
                          {item.user.id === user.id && <button type="button" className="action-edit" data-label="編集" title="Editar" aria-label="Editar mensaje privado" onClick={() => openMessageEditor(item, "direct")}>✐</button>}
                        </div>
                      </div>
                    </article>
                  );
                })}
                <div ref={directEndRef} />
              </div>
              <form className="irc-composer direct-composer" onSubmit={(event) => void sendDirectMessage(event)}>
                {directReplyingTo && <div className="reply-composer-bar"><span>RESPONDIENDO A <b>{directReplyingTo.user.name}</b><small>{directReplyingTo.body || "[imagen]"}</small></span><button type="button" onClick={() => setDirectReplyingTo(null)} aria-label="Cancelar respuesta privada">×</button></div>}
                <button type="button" className="composer-add" onClick={() => imageInput.current?.click()} disabled={uploading} title="Subir imagen privada">{uploading ? "…" : "+"}</button>
                <textarea ref={directInput} value={directMessage} onChange={(event) => setDirectMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendDirectMessage(); } }} placeholder={`Mensaje privado para ${activeDirectUser.name}...`} aria-label="Mensaje privado" rows={1} maxLength={2000} />
                <button type="button" className="composer-emoji" onClick={() => setEmojiOpen((open) => !open)} aria-label="Abrir emojis">☺</button>
                <button type="submit" className="composer-send" disabled={directSending || !directMessage.trim()} aria-label="Enviar mensaje privado">ENVIAR ↗</button>
                <small>CANAL PRIVADO · ENTER envía · SHIFT+ENTER crea una línea</small>
                {emojiOpen && (
                  <FullEmojiPicker
                    title="EMOJIS // 私信"
                    onClose={() => setEmojiOpen(false)}
                    onSelect={(emoji) => {
                      setDirectMessage((value) => `${value}${emoji}`);
                      window.setTimeout(() => directInput.current?.focus(), 0);
                    }}
                  />
                )}
              </form>
            </section>
          )}
        </section>

        <aside className={`irc-people ${peopleOpen ? "open" : ""}`}>
          <header><span>PERSONAS <small>接続者</small></span><b>{members.length.toString().padStart(2, "0")}</b><button onClick={() => setPeopleOpen(false)}>×</button></header>
          <div className="people-note"><i /> Conectados durante el último minuto</div>
          <div className="people-list">
            {members.map((member) => <button type="button" key={member.id} className={`person ${activeDirectUser?.id === member.id ? "active" : ""}`} onClick={() => openDirectChannel(member)} disabled={member.id === user.id} title={member.id === user.id ? "Tu identidad" : `Mensaje privado a ${member.name}`}><Avatar user={member} /><span><strong>{member.name}</strong><small>{member.id === user.id ? "TÚ / ONLINE" : member.role === "admin" ? "ADMIN · ABRIR PRIVADO" : "ONLINE · ABRIR PRIVADO"}</small></span><i className="person-dm">{member.id === user.id ? "自" : "私"}</i></button>)}
            {!members.length && <p>No hay otras personas conectadas.</p>}
          </div>
          <footer><span>LAT</span><b>21ms</b><span>ENC</span><b>AES-256</b></footer>
        </aside>
      </section>

      <footer className="irc-statusbar"><span><i /> DENPA ONLINE</span><span>nick: <b>{user.name}</b></span><span>canal: <b>{activeDirectUser ? `@${activeDirectUser.name}` : "#deadchat"}</b></span><span className="status-spacer" /><span>{activeDirectUser ? "PRIVATE LINK::ENCRYPTED" : "秋葉原 NODE::404"}</span></footer>

      <input ref={imageInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => event.target.files?.[0] && void uploadFile(event.target.files[0], "chat")} />
      <input ref={avatarInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => event.target.files?.[0] && void uploadFile(event.target.files[0], "avatar")} />

      {dashboardOpen && user.role === "admin" && (
        <section className="admin-dashboard" aria-label="Dashboard administrativo">
          <header className="dashboard-head">
            <div><span>DEAD SMILE / ROOT CONSOLE</span><h2>Dashboard de <em>xergno</em></h2><p>Usuarios, conexiones y geolocalización IP</p></div>
            <button onClick={() => setDashboardOpen(false)}>CERRAR ×</button>
          </header>
          <div className="dashboard-stats">
            <article><span>USUARIOS REGISTRADOS</span><strong>{adminData?.stats.total ?? "—"}</strong><small>histórico completo</small></article>
            <article><span>ONLINE AHORA</span><strong>{adminData?.stats.online ?? "—"}</strong><small>actividad en 60 segundos</small></article>
            <article><span>IPS BLOQUEADAS</span><strong>{adminData?.stats.banned ?? "—"}</strong><small>acceso denegado</small></article>
            <article><span>PAÍSES</span><strong>{adminData?.stats.countries ?? "—"}</strong><small>según geolocalización IP</small></article>
          </div>
          <div className="dashboard-toolbar">
            <div className="dashboard-tabs">
              <button className={dashboardTab === "users" ? "active" : ""} onClick={() => setDashboardTab("users")}>USUARIOS</button>
              <button className={dashboardTab === "messages" ? "active" : ""} onClick={() => setDashboardTab("messages")}>MENSAJES</button>
            </div>
            {dashboardTab === "users" ? <label><span>⌕</span><input value={adminSearch} onChange={(event) => setAdminSearch(event.target.value)} placeholder="Buscar usuario, IP, ciudad o red..." /></label> : <button className="clear-chat-action" onClick={clearChat} disabled={adminLoading}>ELIMINAR TODO EL CHAT</button>}
            <button onClick={() => void loadDashboard()} disabled={adminLoading}>{adminLoading ? "ACTUALIZANDO..." : "↻ ACTUALIZAR"}</button>
          </div>
          <div className="dashboard-table-wrap">
            {dashboardTab === "users" ? <table className="dashboard-table">
              <thead><tr><th>USUARIO</th><th>ESTADO</th><th>DIRECCIÓN IP</th><th>LOCALIZACIÓN</th><th>RED / NODO</th><th>ACTIVIDAD</th><th>MODERACIÓN</th></tr></thead>
              <tbody>
                {filteredAdminUsers.map((record) => (
                  <tr key={record.id}>
                    <td><div className="dashboard-user"><Avatar user={record} /><span><strong>{record.name}</strong><small>{record.email ?? record.accountType.toUpperCase()}</small></span></div></td>
                    <td><span className={`state ${record.status === "active" ? record.isOnline ? "state-active" : "state-offline" : `state-${record.status}`}`}>{record.status === "active" ? record.isOnline ? "ONLINE" : "OFFLINE" : record.status === "kicked" ? "EXPULSADO" : "BANEADO"}</span></td>
                    <td><code>{record.ipAddress}</code><small>{record.ipTag}</small></td>
                    <td><strong>{locationLabel(record)}</strong><small>{[record.postalCode && `CP ${record.postalCode}`, record.timezone, record.continent].filter(Boolean).join(" · ") || "Datos no proporcionados"}</small>{record.latitude && record.longitude && <code>{record.latitude}, {record.longitude}</code>}</td>
                    <td><strong>{record.organization ?? "Red desconocida"}</strong><small>{[record.asn && `AS${record.asn}`, record.colo && `PoP ${record.colo}`].filter(Boolean).join(" · ") || "Sin ASN / nodo"}</small></td>
                    <td><span>Primera: {formatDate(record.firstSeen)}</span><small>Última: {formatDate(record.lastSeen)}</small></td>
                    <td>{record.role === "admin" ? <span className="protected-user">PROTEGIDO</span> : record.status !== "active" ? <button className="restore-action" onClick={() => void moderate("restore", record.id)}>RESTAURAR</button> : <div className="row-actions"><button title="Expulsar" onClick={() => void moderate("kick", record.id)}>↪</button><button title="Banear" onClick={() => void moderate("ban", record.id)}>⊘</button><button title="Bloquear IP" className="danger" onClick={() => void moderate("block_ip", record.id)}>⌁</button></div>}</td>
                  </tr>
                ))}
                {!filteredAdminUsers.length && <tr><td colSpan={7} className="empty-table">No hay usuarios que coincidan con la búsqueda.</td></tr>}
              </tbody>
            </table> : <table className="dashboard-table dashboard-message-table">
              <thead><tr><th>AUTOR</th><th>MENSAJE</th><th>ESTADO</th><th>FECHA</th><th>ACCIONES</th></tr></thead>
              <tbody>
                {(adminData?.messages ?? []).map((item) => (
                  <tr key={item.id}>
                    <td><div className="dashboard-user"><Avatar user={item.user} /><span><strong>{item.user.name}</strong><small>{item.user.role === "admin" ? "ADMIN" : "USUARIO"}</small></span></div></td>
                    <td><strong className="dashboard-message-body">{item.body || "[imagen]"}</strong>{item.imageUrl && <a className="dashboard-image-link" href={item.imageUrl} target="_blank" rel="noreferrer">ABRIR IMAGEN ↗</a>}</td>
                    <td><span className={`message-state ${item.type === "system" ? "system" : item.isPinned ? "pinned" : "normal"}`}>{item.type === "system" ? "SISTEMA" : item.isPinned ? "FIJADO" : item.editedAt ? "EDITADO" : "PUBLICADO"}</span></td>
                    <td><span>{formatDate(item.createdAt)}</span>{item.editedAt && <small>Editado: {formatDate(item.editedAt)}</small>}</td>
                    <td>{item.type === "system" ? <div className="message-actions"><button className="danger" onClick={() => deleteAdminMessage(item)}>ELIMINAR</button></div> : <div className="message-actions"><button onClick={() => void moderateMessage("toggle_pin", item.id)}>{item.isPinned ? "DESFIJAR" : "FIJAR"}</button><button onClick={() => editAdminMessage(item)}>EDITAR</button><button className="danger" onClick={() => deleteAdminMessage(item)}>ELIMINAR</button></div>}</td>
                  </tr>
                ))}
                {!adminData?.messages.length && <tr><td colSpan={5} className="empty-table">El canal no contiene mensajes.</td></tr>}
              </tbody>
            </table>}
          </div>
          <footer className="dashboard-foot"><span><i /> DATOS EN TIEMPO REAL</span><span>La geolocalización IP es aproximada y no identifica una dirección física exacta.</span><b>ADMIN / XERGNO</b></footer>
        </section>
      )}

      {editingMessage && (
        <div className="edit-message-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeMessageEditor(); }}>
          <section className="edit-message-modal" role="dialog" aria-modal="true" aria-labelledby="edit-message-title">
            <div className="edit-modal-signal"><span>編集端末</span><b>MESSAGE PATCH // {editScope === "admin" ? "ROOT" : "USER"}</b><i /></div>
            <header>
              <Avatar user={editingMessage.user} />
              <div><small>EDITANDO TRANSMISIÓN DE</small><h2 id="edit-message-title">{editingMessage.user.name}</h2></div>
              <button type="button" onClick={closeMessageEditor} disabled={savingEdit} aria-label="Cerrar editor">×</button>
            </header>
            <form onSubmit={(event) => void saveMessageEdit(event)}>
              <label htmlFor="edit-message-body">CONTENIDO DEL MENSAJE</label>
              <div className="edit-textarea-shell">
                <span>&gt;_</span>
                <textarea id="edit-message-body" value={editDraft} onChange={(event) => setEditDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") closeMessageEditor(); }} rows={6} maxLength={2000} autoFocus />
                <small>{editDraft.length}/2000</small>
              </div>
              <p>{editScope === "admin" ? "Edición administrativa registrada por xergno." : "Solo tú puedes modificar este mensaje. La marca “editado” será visible."}</p>
              <footer>
                <button type="button" className="edit-cancel" onClick={closeMessageEditor} disabled={savingEdit}>CANCELAR</button>
                <button type="submit" className="edit-save" disabled={savingEdit || !editDraft.trim()}>{savingEdit ? "GUARDANDO..." : "GUARDAR CAMBIOS ↗"}</button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {toast && <div className="irc-toast" role="status"><i />{toast}</div>}
    </main>
  );
}
