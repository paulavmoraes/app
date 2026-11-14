import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { Member, SessionInfo } from "../shared/types";

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
