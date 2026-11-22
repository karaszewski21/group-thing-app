import { useQuery } from "@tanstack/react-query";
import { getAttendanceRules, type AttendanceRules } from "../api/points";
import { extractProblemMessage } from "../api/problem";
import { POINTS_KEY } from "./usePointsConfig";

const ATTENDANCE_RULES_KEY = [POINTS_KEY, "attendance-rules"] as const;

interface UseAttendanceRulesResult {
  data: AttendanceRules | null;
  loading: boolean;
  error: string | null;
}

/** The allowed attendance levels and the minimum present, for the add-term form. */
export function useAttendanceRules(): UseAttendanceRulesResult {
  const query = useQuery({ queryKey: ATTENDANCE_RULES_KEY, queryFn: getAttendanceRules });
  return {
    data: query.data ?? null,
    loading: query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
  };
}
