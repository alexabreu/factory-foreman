// The one line a command prints when something is ready for the person to
// approve: ask them now, with the harness's own choice UI, and never tell them
// to type or run a command.
export const readyForApproval = (command) => `Ready for approval: ask the person now with your harness's choice UI (approve, request changes, or not yet), never by telling them to run a command; on approve, run ${command}.`
