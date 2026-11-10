// A refusal is an expected "not yet": the command names what is missing and
// exits with code 2. Anything else that goes wrong exits with code 1.
export class Refusal extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'Refusal'
    this.details = details
  }
}

export const refuse = (message, details) => { throw new Refusal(message, details) }
