import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { ExpenseForm, ReceiptForm, PaymentForm, TransferForm, CapitalForm, WagePayForm, ApplyCreditForm } from "./forms/money";
import { IndentForm, POForm, GRNForm, BillForm, WOForm, VariationForm, BillGrnForm } from "./forms/docs";
import { ProjectForm, PartyForm, EmployeeForm, TeamForm, AccountForm, SimpleForm } from "./forms/masters";

export type FormKind = "expense" | "receipt" | "payment" | "transfer" | "capital" | "wagepay" | "applycredit"
  | "indent" | "po" | "grn" | "bill" | "billgrn" | "wo" | "variation" | "project" | "party" | "employee" | "team" | "account" | "simple";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Props = Record<string, any>;
const Ctx = createContext<{ openForm: (k: FormKind, p?: Props) => void } | null>(null);

export function FormHost({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ kind: FormKind | null; props: Props }>({ kind: null, props: {} });
  const openForm = useCallback((kind: FormKind, props: Props = {}) => setState({ kind, props }), []);
  const close = useCallback(() => setState(s => ({ ...s, kind: null })), []);
  const k = state.kind, p = state.props;
  const common = { onClose: close };
  return (
    <Ctx.Provider value={{ openForm }}>
      {children}
      <ExpenseForm open={k === "expense"} {...common} {...p} />
      <ReceiptForm open={k === "receipt"} {...common} {...p} />
      <PaymentForm open={k === "payment"} {...common} {...p} />
      <TransferForm open={k === "transfer"} {...common} />
      <CapitalForm open={k === "capital"} {...common} {...p} />
      <WagePayForm open={k === "wagepay"} {...common} {...p} />
      <ApplyCreditForm open={k === "applycredit"} {...common} txn={p.txn ?? null} />
      <IndentForm open={k === "indent"} {...common} {...p} />
      <POForm open={k === "po"} {...common} {...p} />
      <GRNForm open={k === "grn"} {...common} {...p} />
      <BillForm open={k === "bill"} {...common} {...p} />
      <BillGrnForm open={k === "billgrn"} {...common} grn={p.grn ?? null} />
      <WOForm open={k === "wo"} {...common} {...p} />
      <VariationForm open={k === "variation"} {...common} projectId={p.projectId ?? ""} initial={p.initial} />
      <ProjectForm open={k === "project"} {...common} {...p} />
      <PartyForm open={k === "party"} {...common} {...p} />
      <EmployeeForm open={k === "employee"} {...common} {...p} />
      <TeamForm open={k === "team"} {...common} {...p} />
      <AccountForm open={k === "account"} {...common} {...p} />
      <SimpleForm open={k === "simple"} {...common} table={p.table ?? "expense_categories"} title={p.title ?? ""} initial={p.initial} />
    </Ctx.Provider>
  );
}

export function useForms() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useForms outside FormHost");
  return v;
}
