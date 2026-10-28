export class TokenStatsError extends Error {
  constructor(code, message) { super(message); this.code = code }
}
