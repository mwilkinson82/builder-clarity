export function planRoomOperationFingerprint(action: string, payload: unknown) {
  return JSON.stringify([action, payload]);
}

export function retainPlanRoomOperationKey(
  retained: Map<string, string>,
  requestFingerprint: string,
) {
  const existing = retained.get(requestFingerprint);
  if (existing) return existing;
  const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const operationKey = `plan-room:${nonce}`;
  retained.set(requestFingerprint, operationKey);
  return operationKey;
}

export function releasePlanRoomOperationKey(retained: Map<string, string>, operationKey: string) {
  for (const [fingerprint, retainedKey] of retained) {
    if (retainedKey === operationKey) retained.delete(fingerprint);
  }
}
