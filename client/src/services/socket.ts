import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "./authSession";
import type { DeliveryLocation, EntityId } from "../types/domain";

type SocketAck = {
  ok?: boolean;
  error?: string;
};

export type RiderLocationPayload = Partial<DeliveryLocation> & {
  orderId: EntityId;
};

let socket: Socket | null;

const socketBaseUrl = (): string => import.meta.env.VITE_SOCKET_URL ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:8080");

export async function getSocket(): Promise<Socket> {
  if (socket) return socket;
  const token = await getAuthToken();
  if (!token) throw new Error("Sign in before live updates can start.");
  socket = io(socketBaseUrl(), {
    transports: ["websocket", "polling"],
    auth: { token },
    autoConnect: true
  });
  return socket;
}

export async function joinOrderRoom(orderId: EntityId): Promise<void> {
  const activeSocket = await getSocket();
  return new Promise((resolve, reject) => {
    activeSocket.timeout(5_000).emit("order:join", orderId, (error: Error | null, response: SocketAck) => {
      if (error) return reject(new Error("The order channel did not respond."));
      if (!response?.ok) return reject(new Error(response?.error || "Order channel access denied."));
      return resolve();
    });
  });
}

export async function sendRiderLocation(orderId: EntityId, location: Partial<DeliveryLocation>): Promise<void> {
  const activeSocket = await getSocket();
  return new Promise((resolve, reject) => {
    activeSocket.timeout(5_000).emit("rider:location", { orderId, ...location }, (error: Error | null, response: SocketAck) => {
      if (error) return reject(new Error("The GPS channel did not respond."));
      if (!response?.ok) return reject(new Error(response?.error || "GPS update rejected."));
      return resolve();
    });
  });
}

export async function subscribeSocketRiderLocation(orderId: EntityId, callback: (payload: RiderLocationPayload) => void): Promise<() => void> {
  const activeSocket = await getSocket();
  const handler = (payload: RiderLocationPayload) => {
    if (payload?.orderId === orderId) callback(payload);
  };
  const join = () => joinOrderRoom(orderId).catch(() => {});
  activeSocket.on("rider:location", handler);
  activeSocket.on("connect", join);
  join();
  return () => {
    activeSocket.off("rider:location", handler);
    activeSocket.off("connect", join);
  };
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
