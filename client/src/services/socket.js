import { io } from "socket.io-client";
import { getAuthToken } from "./authSession";

let socket;

export async function getSocket() {
  if (socket) return socket;
  const token = await getAuthToken();
  if (!token) throw new Error("Sign in before connecting to realtime services.");
  socket = io(import.meta.env.VITE_SOCKET_URL || "http://localhost:8080", {
    transports: ["websocket", "polling"],
    auth: { token },
    autoConnect: true
  });
  return socket;
}

export async function joinOrderRoom(orderId) {
  const activeSocket = await getSocket();
  return new Promise((resolve, reject) => {
    activeSocket.timeout(5_000).emit("order:join", orderId, (error, response) => {
      if (error) return reject(new Error("The order channel did not respond."));
      if (!response?.ok) return reject(new Error(response?.error || "Order channel access denied."));
      return resolve();
    });
  });
}

export async function sendRiderLocation(orderId, location) {
  const activeSocket = await getSocket();
  return new Promise((resolve, reject) => {
    activeSocket.timeout(5_000).emit("rider:location", { orderId, ...location }, (error, response) => {
      if (error) return reject(new Error("The GPS channel did not respond."));
      if (!response?.ok) return reject(new Error(response?.error || "GPS update rejected."));
      return resolve();
    });
  });
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
