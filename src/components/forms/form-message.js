import { Alert } from "@/components/ui/alert";

/** Shows the result of the last submission, if there is one. */
export function FormMessage({ state, className }) {
  if (!state?.message) return null;
  return (
    <Alert tone={state.status === "success" ? "success" : "error"} className={className}>
      {state.message}
    </Alert>
  );
}
