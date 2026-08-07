/** Error type for problems the user can fix (bad flags, missing files, ...). */
export class UserError extends Error {
  constructor(message, { hint = '' } = {}) {
    super(message);
    this.name = 'UserError';
    this.hint = hint;
  }
}
