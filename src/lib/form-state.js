// The shape every Server Action returns to its form (via useActionState).

export const INITIAL_FORM_STATE = Object.freeze({ status: "idle", message: "", fieldErrors: {}, values: {} });

export function formError(message, { fieldErrors = {}, values = {} } = {}) {
  return { status: "error", message, fieldErrors, values };
}

export function formSuccess(message, { values = {} } = {}) {
  return { status: "success", message, fieldErrors: {}, values };
}

export const GENERIC_ERROR = "Something went wrong on our side. Nothing was saved — please try again.";
