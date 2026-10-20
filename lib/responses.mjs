// Validate successful upload responses before following IDs or reporting success.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
function invalid(context) {
  const error = new Error(`Invalid ${context} response from server; check the existing upload before submitting again.`);
  error.code = 'INVALID_RESPONSE';
  return error;
}
export function uploadSession(value, expectedGameId) {
  if (!object(value) || value.ok === false || !id(value.id) || !id(value.gameId) || (expectedGameId && value.gameId !== expectedGameId)) {
    const error = invalid('upload session');
    if (object(value) && id(value.id)) error.uploadId = value.id;
    throw error;
  }
  return value;
}
export function completedGame(value, { gameId, guest = false } = {}) {
  if (!object(value) || value.ok === false || !id(value.id) || !text(value.slug) ||
      (gameId && value.id !== gameId) || (guest && !text(value.claimToken))) throw invalid('completed game');
  return value;
}
