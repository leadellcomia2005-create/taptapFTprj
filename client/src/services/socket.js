import { io } from "socket.io-client";
import { getAuthToken } from "./firebase";

let socket;

export async function getSocket() {
  if (socket) return socket;
  const token = await getAuthToken();
  socket = io(import.meta.env.VITE_SOCKET_URL || "http://localhost:8080", {
    transports: ["websocket", "polling"],
    auth: { token },
    autoConnect: true
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
