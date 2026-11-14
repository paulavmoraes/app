import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { AwayDTO, InboxDTO, Member, SessionInfo, SwapDTO } from "../shared/types";

export const useSession = () => useQuery({ queryKey: ["session"], queryFn: () => api.get<SessionInfo>("/session") });

export const useMembers = () =>
  useQuery({ queryKey: ["members"], queryFn: () => api.get<Member[]>("/members"), staleTime: 60_000 });

export function useMemberMap() {
  const { data } = useMembers();
  return new Map((data ?? []).map((m) => [m.id, m]));
}

export function useMe(): Member {
  const { data } = useSession();
  return data!.me!;
}

/** Pending swap requests I sent or received. */
export const useSwaps = () => useQuery({ queryKey: ["swaps"], queryFn: () => api.get<SwapDTO[]>("/swaps") });

/** Current and upcoming away periods of everyone. */
export const useAway = () => useQuery({ queryKey: ["away"], queryFn: () => api.get<AwayDTO[]>("/away") });

/** The notifications inbox; refreshed every minute for the tab badge. */
export const useInbox = () => useQuery({ queryKey: ["inbox"], queryFn: () => api.get<InboxDTO>("/notifications"), refetchInterval: 60_000 });
