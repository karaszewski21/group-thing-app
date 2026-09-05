import { api } from "./client";

export type AccountType = "USER_BALANCE" | "SYSTEM_EMISSION";
export type EntrySide = "DEBIT" | "CREDIT";

export interface AccountResponse {
  id: number;
  code: string;
  name: string;
  account_type: AccountType;
  owner_user_id: number | null;
}

export interface AccountBalanceResponse {
  account: AccountResponse;
  balance: string;
}

export interface CirculationEntryResponse {
  id: number;
  account: AccountResponse;
  amount: string;
  entry_side: EntrySide;
  description: string;
  entry_date: string;
}

export interface CirculationTransactionResponse {
  id: number;
  transaction_number: string;
  transaction_date: string;
  description: string;
  is_posted: boolean;
  entries: CirculationEntryResponse[];
}

export function getAccountBalance(userId: number): Promise<AccountBalanceResponse> {
  return api.get(`/accounts/${userId}/balance`);
}

export function getTransactionsForAccount(
  accountId: number,
): Promise<CirculationTransactionResponse[]> {
  return api.get(`/circulation-transactions?account_id=${accountId}`);
}

export function getTransaction(id: number): Promise<CirculationTransactionResponse> {
  return api.get(`/circulation-transactions/${id}`);
}
